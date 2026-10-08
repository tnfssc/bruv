import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";
import { waitForLiveTuiStartup } from "./live-tui-startup";
import { capturePane, frameContaining as waitForText, shellQuote as quote } from "./tui-helpers";

type PickerTmux = (...args: string[]) => ReturnType<typeof run>;

// Own the offline process, socket and retained filesystem independently of the UI journey.
async function withPickerTerminal(width: number, exercise: (tmux: PickerTmux) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "bruv-picker-tui-"));
  const root = resolve(import.meta.dir, "..");
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    PI_CODING_AGENT_DIR: join(home, "sdk"),
    TMPDIR: join(home, "tmp"),
    TERM: "xterm-256color",
    PI_OFFLINE: "1",
    BRUV_SUBAGENT_DEPTH: "0",
    OPENAI_API_KEY: "offline-placeholder",
  };
  for (const dir of [env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.PI_CODING_AGENT_DIR, env.TMPDIR]) await mkdir(dir);
  const config = join(home, "tmux.conf");
  const binary = Bun.which("tmux") ?? "/usr/bin/tmux";
  const tmux: PickerTmux = (...args) =>
    run([binary, "-S", join(home, "tmux.sock"), "-f", config, ...args], { env, cwd: root });

  try {
    const { version } = await Bun.file(join(root, "package.json")).json();
    const themeDir = join(home, ".bruv/runtime", version, "dist/modes/interactive");
    await mkdir(themeDir, { recursive: true });
    await symlink(join(home, ".bruv/runtime", version, "theme"), join(themeDir, "theme"));
    const launch = [
      process.execPath,
      join(root, "src/cli.ts"),
      "--offline",
      "--no-session",
      "--no-extensions",
      "-e",
      join(root, "tests/fixtures/live-picker-tui.ts"),
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(quote)
      .join(" ");
    await writeFile(
      config,
      (await readFile(join(root, "scripts/tmux.conf"), "utf8")) + "\nset -g default-shell /bin/sh\n",
    );
    expect(
      (await tmux("new-session", "-d", "-s", "picker", "-x", String(width), "-y", "40", "-c", root, launch)).code,
    ).toBe(0);
    await waitForLiveTuiStartup(
      async () => (await capturePane(tmux, "picker")).stdout,
      (key) => tmux("send-keys", "-t", "picker", key),
      "PICKER FIXTURE LOADED",
    );
    await exercise(tmux);
  } finally {
    await tmux("kill-server");
    // Retain this mkdtemp-owned HOME/config/SDK for inspection, including on failure.
  }
}

// Real source CLI and Pi renderer; fake only credentials/config and forbidden I/O.
for (const width of [80, 120])
  test("Live picker real terminal " + width + " columns", async () => {
    await withPickerTerminal(width, async (tmux) => {
      const frame = async () => (await capturePane(tmux, "picker")).stdout;
      const until = (text: string | string[]) => waitForText(frame, text, 100, 80);
      const send = async (text: string, expected: string) => {
        await tmux("send-keys", "-t", "picker", "-l", text);
        await Bun.sleep(120);
        await tmux("send-keys", "-t", "picker", "Enter");
        await Bun.sleep(250);
        if (!(await frame()).includes(expected)) await tmux("send-keys", "-t", "picker", "Enter");
      };
      await send("/livepicker model", "Live voice model");
      const modelLabels = [
        "gemini-3.8-live · Google Gemini · API key needed (OAuth) (selected)",
        "gemini-3.8-live-extended-thinking · Google Gemini · API key needed (OAuth)",
        "gpt-realtime-2.1 · OpenAI · key configured",
        "gpt-realtime-2.1-mini · OpenAI · key configured",
        "gpt-live-1 · OpenAI · key configured",
      ];
      const navigation = "↑↓ navigate  enter select  escape/ctrl+c cancel";
      const rendered = await until(["Live voice model", ...modelLabels, navigation]);
      for (const label of modelLabels) expect(rendered).toContain(label);
      expect(rendered).toContain("Live voice model");
      expect(rendered).not.toContain("/questions unavailable");
      console.log("PICKER " + width + " cols\n" + rendered);
      for (let i = 0; i < 4; i++) await tmux("send-keys", "-t", "picker", "Down");
      await tmux("send-keys", "-t", "picker", "Enter");
      await until("Live voice: OpenAI · gpt-live-1");
      await send("/livepicker model", "Live voice model");
      const reselection = await until(["gpt-live-1 · OpenAI · key configured (selected)", navigation]);
      expect(reselection).toContain("gemini-3.8-live-extended-thinking · Google Gemini · API key needed (OAuth)");
      console.log("RESELECTED " + width + " cols\n" + reselection);
      await tmux("send-keys", "-t", "picker", "Escape");
      await Bun.sleep(500);
      await send("/livepicker provider", "Configure Live provider credentials");
      const provider = await until(["Configure Live provider credentials", "Google Gemini", "OpenAI", navigation]);
      expect(provider).toContain("Google Gemini");
      expect(provider).toContain("OpenAI");
      console.log("PROVIDER " + width + " cols\n" + provider);
      await tmux("send-keys", "-t", "picker", "Down");
      await tmux("send-keys", "-t", "picker", "Enter");
      const setup = await until(["OpenAI API key configured", "Done", navigation]);
      expect(setup).toContain("Done");
      expect(setup).not.toContain("Start voice");
      console.log("SETUP " + width + " cols\n" + setup);
      await tmux("send-keys", "-t", "picker", "Enter"); // Done, never starts voice
      await until("");
      await send("/livepicker status", "Live off");
      const status = await until("Live off · OpenAI voice model gpt-live-1");
      expect(status).not.toContain("Live listening");
      console.log("STATUS " + width + " cols\n" + status);
    });
  }, 30_000);
