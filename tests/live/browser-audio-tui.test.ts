import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createAudioRelay, type AudioRelayData } from "../../src/web/audio-relay";
import { InputOwnership } from "../../src/web/input-ownership";
import { waitForLiveTuiStartup } from "./live-tui-startup";
import { capturePane, shellQuote, tmuxRunner, frameContaining } from "../helpers/tui-helpers";

// Actual Live mic-check handler, default audio selection, real WS relay, fake browser device.
// No paid provider connection and no native OS device is opened.
test.skipIf(!Bun.which("tmux"))(
  "actual remote CLI Live mic-check rejects mixed multiline input and admits one author",
  async () => {
    await mkdir(resolve(import.meta.dir, "../../.tmp"), { recursive: true });
    const home = await mkdtemp(resolve(import.meta.dir, "../../.tmp/bruv-browser-audio-"));
    const root = resolve(import.meta.dir, "../..");
    const tmux = tmuxRunner("bruv-browser-audio-" + process.pid, join(home, "tmux.conf"));
    const privateOwner = "private-terminal-attachment";
    const requests: { session: string; owner: string; request: string }[] = [];
    const cancelled: typeof requests = [];
    const messages: string[] = [];
    let browser: WebSocket | undefined;
    const Client = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
    const relay = createAudioRelay({
      authorizeBrowser: (req) => (req.headers.get("origin") === "https://bruv.test" ? privateOwner : false),
      requestBrowser: (session, owner, request) => {
        requests.push({ session, owner, request });
        browser = new Client(
          `ws://127.0.0.1:${server.port}/api/live/audio?role=browser&session=terminal&request=${request}`,
          {
            headers: { origin: "https://bruv.test" },
          },
        );
        browser.onmessage = ({ data }) => {
          const m = JSON.parse(String(data));
          messages.push(m.type);
          if (m.type === "start") browser!.send('{"type":"ready"}');
          if (m.type === "stop") browser!.send('{"type":"stopped"}');
        };
        return true;
      },
      cancelBrowser: (session, owner, request) => {
        cancelled.push({ session, owner, request });
      },
    });
    const secret = relay.registerSession("terminal");
    const server = Bun.serve<AudioRelayData>({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req, server) => relay.upgrade(req, server),
      websocket: relay.websocket,
    });
    const frame = async () => (await capturePane(tmux, "audio")).stdout;
    try {
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
      const writes: Buffer[] = [];
      let request: string | undefined;
      const input = new InputOwnership(
        (owner, previous) => {
          request = relay.inputTicket("terminal", owner, previous);
          return request;
        },
        (bytes) => writes.push(bytes),
      );
      const type = async (owner: string, text: string) => {
        input.input(Buffer.from(text), owner);
        for (const bytes of writes.splice(0)) {
          // Hex sends the raw PTY bytes, including the private OSC label.
          expect((await tmux("send-keys", "-t", "audio", "-H", ...Array.from(bytes, (b) => b.toString(16)))).code).toBe(
            0,
          );
        }
      };
      try {
        await type(privateOwner, "/browserlive mic-check\\\r");
        await type("second-private-attachment", "\r");
        await frameContaining(frame, "Voice needs an unmixed browser command", 100, 80);
        expect(requests).toEqual([]);
        expect(messages).toEqual([]);
        await type(privateOwner, "/browserlive mic-check\\\r");
        await type(privateOwner, "\r");
      } finally {
        input.close();
      }
      const result = await frameContaining(frame, "Audio route ready. Sound quality not measured.", 100, 80);
      expect(result).not.toContain("Audio helper failed");
      for (let n = 0; n < 100 && messages.length < 2; n++) await Bun.sleep(20);
      expect(messages).toEqual(["start", "stop"]);
      expect(requests).toEqual([{ session: "terminal", owner: privateOwner, request: request! }]);
      for (let n = 0; n < 100 && !cancelled.length; n++) await Bun.sleep(20);
      expect(cancelled).toEqual(requests);
      expect(request).toBeDefined();
      expect(result).not.toContain(request!);
    } finally {
      await tmux("kill-server");
      browser?.close();
      relay.unregisterSession("terminal");
      server.stop(true);
      await rm(home, { recursive: true, force: true });
    }
  },
  30_000,
);
