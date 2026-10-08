import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { capturePane, frameContaining as waitForText, shellQuote as quote } from "./tui-helpers";

// Both terminal transports launch the same offline CLI in a retained owned home.
// No inherited credentials, SDK settings, tmux config or Herdr connection enter it.
async function createStartupProcess(name: string, cliArgs: string[] = []) {
  const home = await mkdtemp(join(tmpdir(), "bruv-startup-"));
  const agentDir = join(home, ".bruv", "agent");
  const artifactDir = join(resolve(import.meta.dir, "../artifacts/tui"), name + "-" + basename(home));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    TMPDIR: join(home, "tmp"),
    BRUV_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_DIR: agentDir,
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    HERDR_ENV: "0",
    OPENAI_API_KEY: "offline-test-placeholder",
  };
  for (const dir of [
    agentDir,
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME,
    env.TMPDIR,
    artifactDir,
  ]) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(
    join(artifactDir, "fixture.json"),
    JSON.stringify({ home, agentDir, worktree: resolve(import.meta.dir, "..") }, null, 2),
  );
  const launch = [
    resolve(import.meta.dir, "../dist/bruv"),
    "--offline",
    "--no-approve",
    "--no-session",
    "--provider",
    "openai",
    "--model",
    "gpt-4o",
    ...cliArgs,
  ]
    .map(quote)
    .join(" ");
  const socket = join(home, "tmux.sock");
  async function tmux(...args: string[]) {
    const child = Bun.spawn(["tmux", "-S", socket, "-f", "/dev/null", ...args], {
      cwd: home,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  }
  return {
    agentDir,
    artifactDir,
    tmux,
    startPty() {
      return Bun.spawn(["script", "-q", "-e", "-c", "stty rows 40 cols 120; exec " + launch, "/dev/null"], {
        cwd: home,
        env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    },
    startTmux(session: string) {
      return tmux("new-session", "-d", "-s", session, "-x", "120", "-y", "40", "-c", home, launch);
    },
  };
}

test("quiet startup hides Pi promotion and skill inventory without disabling skills or warnings", async () => {
  const startup = await createStartupProcess("quiet-startup");
  const { agentDir, artifactDir, tmux } = startup;
  const session = "startup";
  const capture = (history = false) => capturePane(tmux, session, history);

  const frameContaining = (text: string, history = false) =>
    waitForText(async () => (await capture(history)).stdout, text);

  let startupFrame = "";
  let autocompleteFrame = "";
  try {
    await mkdir(join(agentDir, "skills", "quiet-fixture"), { recursive: true });
    await mkdir(join(agentDir, "skills", "malformed-fixture"), { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ quietStartup: false, enableSkillCommands: true }),
    );
    await writeFile(
      join(agentDir, "skills", "quiet-fixture", "SKILL.md"),
      "---\nname: quiet-fixture\ndescription: Deterministic quiet-startup fixture\n---\n\n# Fixture\n",
    );
    await writeFile(
      join(agentDir, "skills", "malformed-fixture", "SKILL.md"),
      "---\nname: malformed-fixture\n---\n\n# Missing description\n",
    );

    expect((await startup.startTmux(session)).code).toBe(0);

    startupFrame = await frameContaining("description is required", true);
    expect(startupFrame).toContain("[Skill conflicts]");
    expect(startupFrame).not.toContain("[Skills]");
    expect(startupFrame).not.toContain("Pi can explain its own features");
    expect(startupFrame).not.toContain("Ask it how to use or extend Pi");
    expect(startupFrame).toContain("");

    // Startup paints before all command bindings are ready.
    await Bun.sleep(500);
    await tmux("send-keys", "-t", session, "-l", "/skill:quiet");
    autocompleteFrame = await frameContaining("skill:quiet-fixture");
    expect(autocompleteFrame).toContain("Deterministic quiet-startup fixture");
  } finally {
    try {
      await mkdir(artifactDir, { recursive: true });
      if (!startupFrame) startupFrame = (await capture(true).catch(() => ({ stdout: "" }))).stdout;
      await writeFile(join(artifactDir, "startup.txt"), startupFrame);
      await writeFile(join(artifactDir, "autocomplete.txt"), autocompleteFrame).catch(() => {});
      await writeFile(
        join(artifactDir, "evidence.json"),
        JSON.stringify(
          {
            promotionHidden: !startupFrame.includes("Pi can explain its own features"),
            skillInventoryHidden: !startupFrame.includes("[Skills]"),
            diagnosticVisible: startupFrame.includes("description is required"),
            skillCommandVisible: autocompleteFrame.includes("skill:quiet-fixture"),
          },
          null,
          2,
        ),
      );
    } finally {
      await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    }
  }
}, 15_000);

// tmux answers Pi's terminal-color queries before its first scheduled paint.
// A plain PTY does not: Pi's real 100ms color wait exposes the startup editor.
for (const mode of ["default fullscreen", "regular"] as const) {
  test.skipIf(process.platform !== "linux")(
    `first PTY paint is compact before terminal colors and session_start (${mode})`,
    async () => {
      const startup = await createStartupProcess(
        "first-paint-" + mode.replaceAll(" ", "-"),
        mode === "regular" ? ["--tui-mode", "regular"] : [],
      );
      const { artifactDir } = startup;
      const child = startup.startPty();
      const output = new Response(child.stdout).text();
      const errors = new Response(child.stderr).text();
      let stream = "";
      try {
        await Bun.sleep(1000);
        child.stdin.write("\x04");
        child.stdin.end();
        expect(await child.exited).toBe(0);
        const raw = await output;
        expect(raw.includes("\x1b[?1049h")).toBe(mode === "default fullscreen");
        stream = Bun.stripANSI(raw);
        expect(await errors).toBe("");
        expect(stream).toContain("\uF460");
        expect(stream).not.toMatch(/\u2500{3,}/);
      } finally {
        child.kill();
        await mkdir(artifactDir, { recursive: true });
        await writeFile(join(artifactDir, "startup-stream.txt"), stream || Bun.stripANSI(await output));
      }
    },
    10_000,
  );
}
