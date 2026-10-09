import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createAudioRelay, type AudioRelayData } from "../../src/web/audio-relay";
import { waitForLiveTuiStartup } from "./live-tui-startup";
import { capturePane, pasteAndSubmit, shellQuote, tmuxRunner, frameContaining } from "../helpers/tui-helpers";

// Actual CLI /live mic-check, default audio selection, real WS relay, fake browser device.
// No paid provider connection and no native OS device is opened.
test.skipIf(!Bun.which("tmux"))(
  "actual remote CLI /live mic-check uses browser relay and releases it",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-browser-audio-"));
    const root = resolve(import.meta.dir, "../..");
    const tmux = tmuxRunner("bruv-browser-audio-" + process.pid, join(home, "tmux.conf"));
    const relay = createAudioRelay({ allowedOrigins: ["https://bruv.test"], authorizeBrowser: () => true });
    const secret = relay.registerSession("terminal");
    const server = Bun.serve<AudioRelayData>({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req, server) => relay.upgrade(req, server),
      websocket: relay.websocket,
    });
    const Client = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
    const browser = new Client(`ws://127.0.0.1:${server.port}/api/live/audio?role=browser&session=terminal`, {
      headers: { origin: "https://bruv.test" },
    });
    const messages: string[] = [];
    browser.onmessage = ({ data }) => {
      const m = JSON.parse(String(data));
      messages.push(m.type);
      if (m.type === "start") browser.send('{"type":"ready"}');
      if (m.type === "stop") browser.send('{"type":"stopped"}');
    };
    const frame = async () => (await capturePane(tmux, "audio")).stdout;
    try {
      await new Promise<void>((resolve, reject) => {
        browser.onopen = () => resolve();
        browser.onerror = () => reject(new Error("Browser fixture connection failed"));
      });
      const { version } = await Bun.file(join(root, "package.json")).json();
      const themeDir = join(home, ".bruv/runtime", version, "dist/modes/interactive");
      await mkdir(themeDir, { recursive: true });
      await symlink(join(home, ".bruv/runtime", version, "theme"), join(themeDir, "theme"));
      const session = SessionManager.create(root, join(home, "sessions"));
      session.appendMessage({ role: "user", content: "SESSION_FIXTURE_SEED", timestamp: Date.now() });
      const launch = [
        "env",
        "HOME=" + home,
        "PI_OFFLINE=1",
        "BRUV_SUBAGENT_DEPTH=0",
        "SSH_CONNECTION=fake-remote",
        "BRUV_WEB_BRUV_BINARY=1",
        "BRUV_LIVE_RELAY_SECRET=" + secret,
        "BRUV_LIVE_RELAY_URL=ws://127.0.0.1:" + server.port + "/api/live/audio?role=cli&session=terminal",
        "SHELL=/bin/sh",
        process.execPath,
        join(root, "src/cli.ts"),
        "--offline",
        "--session",
        session.getSessionFile()!,
        "--no-extensions",
        "-e",
        join(root, "tests/live/fixtures/browser-audio-tui.ts"),
        "--provider",
        "openai",
        "--model",
        "gpt-4o",
      ]
        .map(shellQuote)
        .join(" ");
      await writeFile(
        join(home, "tmux.conf"),
        (await readFile(join(root, "scripts/tui/tmux.conf"), "utf8")) + "\nset -g default-shell /bin/sh\n",
      );
      expect((await tmux("new-session", "-d", "-s", "audio", "-x", "120", "-y", "40", "-c", root, launch)).code).toBe(
        0,
      );
      await waitForLiveTuiStartup(
        frame,
        (key) => tmux("send-keys", "-t", "audio", key),
        "BROWSER AUDIO FIXTURE LOADED",
      );
      await pasteAndSubmit(tmux, "audio", "/live mic-check");
      const consent = await frameContaining(frame, "Audio crosses the session relay", 100, 80);
      expect(consent.replace(/\s+/g, " ")).toContain("No provider or agent tools");
      await tmux("send-keys", "-t", "audio", "Enter");
      const result = await frameContaining(frame, "Audio route ready. Sound quality not measured.", 100, 80);
      expect(result).not.toContain("Audio helper failed");
      for (let n = 0; n < 100 && messages.length < 2; n++) await Bun.sleep(20);
      expect(messages).toEqual(["start", "stop"]);
    } finally {
      await tmux("kill-server");
      browser.close();
      relay.unregisterSession("terminal");
      server.stop(true);
      await rm(home, { recursive: true, force: true });
    }
  },
  30_000,
);
