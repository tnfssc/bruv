import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

test("quiet startup hides Pi promotion and skill inventory without disabling skills or warnings", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-startup-pty-"));
  const agentDir = join(home, ".bruv", "agent");
  const socket = `bruv-startup-${process.pid}-${Date.now()}`;
  const session = "startup";
  const artifactDir = join(
    resolve(import.meta.dir, "../artifacts/tui"),
    `quiet-startup-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const capture = (history = false) => tmux("capture-pane", "-p", "-t", session, ...(history ? ["-S", "-"] : []));

  async function frameContaining(text: string, history = false): Promise<string> {
    let frame = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      frame = (await capture(history)).stdout;
      if (frame.includes(text)) return frame;
      await Bun.sleep(50);
    }
    throw new Error(`Missing ${text} in frame:\n${frame}`);
  }

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

    const binary = resolve(import.meta.dir, "../dist/bruv");
    const launch = [
      "env",
      "HOME=" + home,
      "BRUV_CODING_AGENT_DIR=" + agentDir,
      "OPENAI_API_KEY=offline-test-placeholder",
      binary,
      "--offline",
      "--no-approve",
      "--no-session",
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");

    expect((await tmux("new-session", "-d", "-s", session, "-x", "120", "-y", "40", "-c", home, launch)).code).toBe(0);

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
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);

// tmux answers Pi's terminal-color queries before its first scheduled paint.
// A plain PTY does not: Pi's real 100ms color wait exposes the startup editor.
for (const mode of ["default fullscreen", "regular"] as const) {
  test.skipIf(process.platform !== "linux")(
    `first PTY paint is compact before terminal colors and session_start (${mode})`,
    async () => {
      const home = await mkdtemp(join(tmpdir(), "bruv-first-paint-"));
      const artifactDir = join(
        resolve(import.meta.dir, "../artifacts/tui"),
        `first-paint-${mode.replaceAll(" ", "-")}-` + new Date().toISOString().replaceAll(":", "-"),
      );
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      const launch = [
        "env",
        "HOME=" + home,
        "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv", "agent"),
        "HERDR_ENV=0",
        "OPENAI_API_KEY=offline-test-placeholder",
        resolve(import.meta.dir, "../dist/bruv"),
        "--offline",
        "--no-approve",
        "--no-session",
        "--provider",
        "openai",
        "--model",
        "gpt-4o",
        ...(mode === "regular" ? ["--tui-mode", "regular"] : []),
      ]
        .map(quote)
        .join(" ");
      const child = Bun.spawn(["script", "-q", "-e", "-c", "stty rows 40 cols 120; exec " + launch, "/dev/null"], {
        cwd: home,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, TERM: "xterm-256color", HERDR_ENV: "0" },
      });
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
        await rm(home, { recursive: true, force: true });
      }
    },
    10_000,
  );
}
