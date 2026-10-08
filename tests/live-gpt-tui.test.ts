import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { waitForLiveTuiStartup } from "./live-tui-startup";
import { capturePane, shellQuote as quote, tmuxRunner, frameContaining as waitForText } from "./tui-helpers";

// Prepare the owned HOME and launch the real renderer; the scenario owns tmux teardown.
async function launchGptTui(tmux: ReturnType<typeof tmuxRunner>, home: string, root: string) {
  const { version } = await Bun.file(join(root, "package.json")).json();
  const themeDir = join(home, ".bruv/runtime", version, "dist/modes/interactive");
  await mkdir(themeDir, { recursive: true });
  // Source CLI materializes theme assets at runtimeRoot/theme, while the SDK source
  // resolves dist/modes/interactive/theme. This link is confined to the test HOME.
  await symlink(join(home, ".bruv/runtime", version, "theme"), join(themeDir, "theme"));
  const launch = [
    "env",
    "HOME=" + home,
    "PI_OFFLINE=1",
    "BRUV_SUBAGENT_DEPTH=0",
    "OPENAI_API_KEY=offline-placeholder",
    "SHELL=/bin/sh",
    process.execPath,
    join(root, "src/cli.ts"),
    "--offline",
    "--no-session",
    "--no-extensions",
    "-e",
    join(root, "tests/fixtures/live-gpt-tui.ts"),
    "--provider",
    "openai",
    "--model",
    "gpt-4o",
  ]
    .map(quote)
    .join(" ");
  await writeFile(
    join(home, "tmux.conf"),
    (await readFile(join(root, "scripts/tmux.conf"), "utf8")) + "\nset -g default-shell /bin/sh\n",
  );
  expect((await tmux("new-session", "-d", "-s", "gpt", "-x", "120", "-y", "40", "-c", root, launch)).code).toBe(0);
}

// Actual Pi interactive renderer in a tmux PTY, with a fake GPT stream and fake audio.
test("GPT streaming presents full speech in the shared conversation without raw passive JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-gpt-tui-"));
  const socket = "bruv-gpt-tui-" + process.pid + "-" + Date.now();
  const root = resolve(import.meta.dir, "..");
  const tmux = tmuxRunner(socket, join(dir, "tmux.conf"));

  const frame = async () => (await capturePane(tmux, "gpt", true)).stdout;
  const until = (text: string[]) => waitForText(frame, text, 80, 100);
  try {
    await launchGptTui(tmux, dir, root);
    await waitForLiveTuiStartup(frame, (key) => tmux("send-keys", "-t", "gpt", key), "GPT FIXTURE LOADED");
    await tmux("send-keys", "-t", "gpt", "-l", "/gptflood start");
    await Bun.sleep(120);
    await tmux("send-keys", "-t", "gpt", "Enter"); // completion may consume the first Enter
    await Bun.sleep(150);
    await tmux("send-keys", "-t", "gpt", "Enter");
    const rendered = await until([
      "delta23",
      "delta0 delta1",
      "provisional voice reply",
      "Voice · mic on",
      "Partial transcript",
    ]);
    expect(rendered.match(/\bdelta0\b/g)).toHaveLength(1);
    expect(rendered.match(/provisional voice reply/g)).toHaveLength(1);
    expect(rendered).not.toContain("You:");
    expect(rendered).not.toContain("Voice:");
    expect(rendered).not.toContain("[live-transcript]");
    expect(rendered).not.toContain('"gpt_live_provisional"');
  } finally {
    await tmux("kill-server");
    await rm(dir, { recursive: true, force: true });
  }
}, 25_000);
