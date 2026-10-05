import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { capturePane, frameContaining as waitForText, shellQuote as quote, tmuxRunner } from "./tui-helpers";
import { waitForLiveTuiStartup } from "./live-tui-startup";

// Real source CLI and Pi renderer; synthetic microphone/provider, no device or network I/O.
for (const width of [80, 120])
  test("Live push-to-talk real terminal " + width + " columns", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-ptt-tui-"));
    const root = resolve(import.meta.dir, "..");
    const socket = "bruv-ptt-" + process.pid + "-" + width;
    const tmux = tmuxRunner(socket, join(home, "tmux.conf"), Bun.which("tmux") ?? "/usr/bin/tmux");
    const frame = async () => (await capturePane(tmux, "ptt")).stdout;
    const until = (text: string | string[]) => waitForText(frame, text, 100, 80);
    const send = async (text: string, expected: string) => {
      await tmux("send-keys", "-t", "ptt", "-l", text);
      await Bun.sleep(120);
      await tmux("send-keys", "-t", "ptt", "Enter");
      await Bun.sleep(250);
      if (!(await frame()).includes(expected)) await tmux("send-keys", "-t", "ptt", "Enter");
    };

    try {
      const { version } = await Bun.file(join(root, "package.json")).json();
      const themeDir = join(home, ".bruv/runtime", version, "dist/modes/interactive");
      await mkdir(themeDir, { recursive: true });
      await symlink(join(home, ".bruv/runtime", version, "theme"), join(themeDir, "theme"));
      const launch = [
        "env",
        "HOME=" + home,
        "PI_OFFLINE=1",
        "BRUV_SUBAGENT_DEPTH=0",
        "OPENAI_API_KEY=offline-placeholder",
        process.execPath,
        join(root, "src/cli.ts"),
        "--offline",
        "--no-session",
        "--no-extensions",
        "-e",
        join(root, "tests/fixtures/live-push-to-talk-tui.ts"),
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
      expect(
        (await tmux("new-session", "-d", "-s", "ptt", "-x", String(width), "-y", "40", "-c", root, launch)).code,
      ).toBe(0);
      await waitForLiveTuiStartup(frame, (key) => tmux("send-keys", "-t", "ptt", key), "PTT FIXTURE LOADED");
      await send("/liveptt start", "MUTED — mic audio discarded");
      const muted = await until([
        "MUTED — mic audio discarded",
        "Press and release Space once",
        "Enter: talk",
        "Esc: return to text",
      ]);
      expect(muted).toContain("MUTED — mic audio discarded");
      console.log("PTT MUTED " + width + " cols\n" + muted);
      await tmux("send-keys", "-t", "ptt", "-l", " ");
      await Bun.sleep(80);
      expect(await frame()).not.toContain("TALKING — sending mic audio");
      // Synthetic Kitty events prove terminal splitting/routing, not hardware support.
      await tmux("send-keys", "-t", "ptt", "-l", "\x1b[32;1:3u");
      await until("Hold Space to talk. Release to mute.");
      await tmux("send-keys", "-t", "ptt", "-l", "\x1b[32;1:1u");
      const talking = await until("TALKING — sending mic audio");
      console.log("PTT TALKING " + width + " cols\n" + talking);
      await tmux("send-keys", "-t", "ptt", "-l", "\x1b[32;1:2u");
      await Bun.sleep(100);
      await tmux("send-keys", "-t", "ptt", "-l", "\x1b[32;1:3u");
      await until("MUTED — mic audio discarded");
      await tmux("send-keys", "-t", "ptt", "Enter");
      await until("TALKING — sending mic audio");
      await tmux("send-keys", "-t", "ptt", "-l", "\x1b[O");
      await until("MUTED — mic audio discarded");
      await tmux("send-keys", "-t", "ptt", "Escape");
      await Bun.sleep(500);
      expect(await frame()).not.toContain("Esc: return to text");
      await until("/live talk");
      await send("/pttproof", "PTT proof:");
      const proof = await until("PTT proof:");
      const match = proof.match(/PTT proof: captures (\d+) sends (\d+) ends (\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(Number(match![2]));
      expect(Number(match![2])).toBeGreaterThan(0);
      expect(Number(match![3])).toBe(2);
      // Reopen starts muted and must check release again. Legacy explicit controls work.
      await send("/liveptt talk", "Press and release Space once");
      await tmux("send-keys", "-t", "ptt", "Enter");
      await until("TALKING — sending mic audio");
      await tmux("send-keys", "-t", "ptt", "BSpace");
      await until("MUTED — mic audio discarded");
      await tmux("send-keys", "-t", "ptt", "Escape");
      await Bun.sleep(500);
      expect(await frame()).not.toContain("Esc: return to text");
      await until("/live talk");
      await send("/liveptt stop", "Live off.");
    } finally {
      await tmux("kill-server");
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);
