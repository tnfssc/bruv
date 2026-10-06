import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { waitForLiveTuiStartup } from "./live-tui-startup";
import {
  capturePane,
  pasteAndSubmit,
  shellQuote as quote,
  tmuxRunner,
  frameContaining as waitForText,
} from "./tui-helpers";

// Actual source CLI/Pi renderer and canonical owner, synthetic mic/provider only.
for (const width of [80, 120])
  test("Live hold Space in shared editor and replay " + width + " columns", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-ptt-tui-"));
    const root = resolve(import.meta.dir, "..");
    const socket = "bruv-ptt-" + process.pid + "-" + width;
    const tmux = tmuxRunner(socket, join(home, "tmux.conf"), Bun.which("tmux") ?? "/usr/bin/tmux");
    const frame = async () => (await capturePane(tmux, "ptt")).stdout;
    const until = (text: string | string[]) => waitForText(frame, text, 100, 80);
    const literal = async (text: string) => {
      await tmux("send-keys", "-t", "ptt", "-l", text);
    };
    const command = async (text: string, expected: string) => {
      await pasteAndSubmit(tmux, "ptt", text);
      return until(expected);
    };
    let proofs = 0;
    const proof = async () => {
      const text = await command("/pttproof", "PTT proof " + ++proofs + ":");
      const matches = [...text.matchAll(/PTT proof \d+: captures (\d+) sends (\d+) ends (\d+) typed (\d+)/g)];
      expect(matches.length).toBeGreaterThan(0);
      return matches.at(-1)!.slice(1).map(Number);
    };
    const hold = async (release = "\x1b[32;1:3u") => {
      await literal("\x1b[32;1:1u");
      for (let n = 0; n < 24; n++) {
        await Bun.sleep(35);
        await literal("\x1b[32;1:2u");
      }
      await literal(release);
    };
    try {
      const { version } = await Bun.file(join(root, "package.json")).json();
      const themeDir = join(home, ".bruv/runtime", version, "dist/modes/interactive");
      await mkdir(themeDir, { recursive: true });
      await symlink(join(home, ".bruv/runtime", version, "theme"), join(themeDir, "theme"));
      const session = SessionManager.create(root, join(home, "sessions"));
      session.appendMessage({ role: "user", content: "SESSION_FIXTURE_SEED", timestamp: Date.now() });
      const sessionFile = session.getSessionFile()!;
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
        "--session",
        sessionFile,
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
      await command("/liveptt start", "Space");
      const initial = await frame();
      expect(initial).not.toContain("Enter: talk");
      expect(initial).not.toContain("Esc: return to text");
      expect(initial).not.toContain("mic audio discarded");

      // Tap stays text; Enter submits through the actual active owner once.
      await literal("left");
      await literal("\x1b[32;1:1u");
      await literal("\x1b[32;1:3u");
      await literal("right");
      await tmux("send-keys", "-t", "ptt", "Enter");
      await until("TYPED_REPLY: left right");
      const before = await proof();
      expect(before[1]).toBe(0);
      expect(before[2]).toBe(0);

      // Warmup may add temporary spaces, but must leave the genuine draft intact.
      const seed = "KEEP_DRAFT_" + width + " one ";
      await literal(seed);
      await hold();
      await until(["SPOKEN_INPUT_1", "SPOKEN_REPLY_1", "END_REPLY_1"]);
      await literal("TAIL");
      await tmux("send-keys", "-t", "ptt", "Enter");
      await until("TYPED_REPLY: " + seed + "TAIL");
      const held = await proof();
      expect(held[1]).toBeGreaterThan(0);
      expect(held[2]).toBe(1);
      const spoken = await frame();
      expect(spoken.match(/SPOKEN_INPUT_1/g)?.length).toBe(1);
      expect(spoken.match(/SPOKEN_REPLY_1/g)?.length).toBe(1);
      expect(spoken).toContain("END_REPLY_1");
      expect(spoken).not.toContain("[live-transcript]");
      expect(spoken).not.toContain("You:");
      expect(spoken).not.toContain("Voice:");
      if (process.env.BRUV_VOICE_EVIDENCE_DIR) {
        await mkdir(process.env.BRUV_VOICE_EVIDENCE_DIR, { recursive: true });
        await writeFile(join(process.env.BRUV_VOICE_EVIDENCE_DIR, width + "-conversation.txt"), spoken);
      }

      // Muted means no new sends even if stale capture frames arrive.
      await command("/pttstale", "PTT stale frame injected 1");
      await Bun.sleep(150);
      expect((await proof())[1]).toBe(held[1]);
      await hold("\x1b[O");
      await literal("\x1b[I");
      const blurred = await proof();
      await Bun.sleep(180);
      expect((await proof())[1]).toBe(blurred[1]);
      await command("/liveptt stop", "Live off.");
      const stopped = await proof();
      await command("/pttstale", "PTT stale frame injected");
      expect((await proof())[1]).toBe(stopped[1]);

      // Reopen the real saved branch. Complete spoken text is history, not an ephemeral widget.
      await tmux("clear-history", "-t", "ptt");
      // Resize the real viewport so both long spoken turns fit after replay.
      await tmux("resize-window", "-t", "ptt", "-y", "80");
      expect((await tmux("respawn-pane", "-k", "-t", "ptt", "-c", root, launch)).code).toBe(0);
      await waitForLiveTuiStartup(frame, (key) => tmux("send-keys", "-t", "ptt", key), "PTT FIXTURE LOADED");
      const reopened = await until(["PTT FIXTURE LOADED", "SPOKEN_INPUT_1", "SPOKEN_REPLY_1", "END_REPLY_1"]);
      expect(reopened.match(/SPOKEN_INPUT_1/g)?.length).toBe(1);
      expect(reopened.match(/SPOKEN_REPLY_1/g)?.length).toBe(1);
      expect(reopened).not.toContain("[live-transcript]");
      if (process.env.BRUV_VOICE_EVIDENCE_DIR)
        await writeFile(join(process.env.BRUV_VOICE_EVIDENCE_DIR, width + "-replay.txt"), reopened);
      expect(reopened).not.toContain('"source":"gpt_live_provisional"');
      const branch = SessionManager.open(sessionFile).getBranch();
      const messages = branch.filter((entry) => entry.type === "message").map((entry) => JSON.stringify(entry));
      expect(messages.filter((text) => text.includes("SPOKEN_INPUT_1")).length).toBe(1);
      expect(messages.filter((text) => text.includes("SPOKEN_REPLY_1")).length).toBe(1);
    } finally {
      await tmux("kill-server");
      await rm(home, { recursive: true, force: true });
    }
  }, 45_000);
