import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { capturePane, frameContaining as waitForText, shellQuote as quote, tmuxRunner } from "../helpers/tui-helpers";

test("real TUI /mode reports and switches the root instruction mode", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-mode-pty-"));
  const socket = "bruv-mode-" + process.pid + "-" + Date.now();
  const tmux = tmuxRunner(socket);
  const frameContaining = (text: string) => waitForText(async () => (await capturePane(tmux, "mode")).stdout, text, 80);
  async function command(value: string) {
    await tmux("send-keys", "-t", "mode", "-l", value);
    await Bun.sleep(100);
    await tmux("send-keys", "-t", "mode", "Enter");
  }
  try {
    const binary = resolve(import.meta.dir, "../../dist/bruv");
    const launch = [
      "env",
      "HOME=" + home,
      "BRUV_SUBAGENT_DEPTH=0",
      "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv", "agent"),
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
    expect(
      (
        await tmux(
          "-f",
          resolve(import.meta.dir, "../../scripts/tui/tmux.conf"),
          "new-session",
          "-d",
          "-s",
          "mode",
          "-x",
          "120",
          "-y",
          "40",
          "-c",
          home,
          launch,
        )
      ).code,
    ).toBe(0);
    await frameContaining("gpt-4o");
    await Bun.sleep(1000);
    await command("/mode fast");
    const switched = await frameContaining("Main-agent mode: fast");
    expect(switched).toContain("mode: fast");
    expect(switched).toContain("model and thinking unchanged");
  } finally {
    await tmux("kill-server");
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
