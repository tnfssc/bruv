/** Real Chromium + fake media. No provider calls or claim of audible speech. */
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAudioRelay, type AudioRelayData } from "../../src/web/audio-relay";
import { CAPTURE_WORKLET } from "../../src/web/browser-audio";
import { BrowserLiveAudio } from "../../src/live/browser-audio";

const executablePath = process.env.CHROMIUM_BIN;
const modulePath = process.env.PLAYWRIGHT_CORE;
if (!executablePath || !modulePath) throw new Error("Set CHROMIUM_BIN and PLAYWRIGHT_CORE to installed browser tools");
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const scratch = await mkdtemp(join(tmpdir(), "bruv-browser-audio-"));
const entry = join(scratch, "entry.ts");
const clientPath = resolve(import.meta.dir, "../../src/web/browser-audio.ts");
await writeFile(
  entry,
  [
    "import { connectBrowserAudio } from " + JSON.stringify(clientPath) + ";",
    "window.tracks = []; window.contexts = []; window.states = [];",
    "const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);",
    "navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await gum(...args); window.tracks.push(...stream.getTracks()); return stream; };",
    "const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(...args) { super(...args); window.contexts.push(this); } };",
    'window.requestVoice = async request => { try { window.audio = await connectBrowserAudio({url: location.origin.replace("http", "ws") + "/api/live/audio?role=browser&session=probe&request=" + request, onState: s => window.states.push(s)}); } catch(e) { window.failure = String(e); } };',
  ].join("\n"),
);
const built = await Bun.build({ entrypoints: [entry], target: "browser" });
assert(built.success, String(built.logs));
const bundle = built.outputs[0];
assert(bundle);
const javascript = await bundle.text();
const origins: string[] = [];
const relay = createAudioRelay({
  allowedOrigins: origins,
  authorizeBrowser: (req, id) =>
    id === "probe" && req.headers.get("cookie") === "probe=authorized" ? "probe-owner" : false,
  requestBrowser: (_id, _owner, request) => {
    void page.evaluate((request: string) => (window as any).requestVoice(request), request);
    return true;
  },
});
const secret = relay.registerSession("probe");
const server = Bun.serve<AudioRelayData>({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    if (relay.matches(request)) return relay.upgrade(request, server);
    if (new URL(request.url).pathname === "/audio-worklet.js")
      return new Response(CAPTURE_WORKLET, { headers: { "Content-Type": "text/javascript" } });
    if (new URL(request.url).pathname === "/probe.js")
      return new Response(javascript, { headers: { "Content-Type": "text/javascript" } });
    return new Response(
      '<label>Live command <input aria-label="Live command"></label><script src="/probe.js"></script>',
      {
        headers: { "Content-Type": "text/html", "Set-Cookie": "probe=authorized; SameSite=Strict; HttpOnly; Path=/" },
      },
    );
  },
  websocket: relay.websocket,
});
origins.push(server.url.origin);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(String(error)));
let audio: BrowserLiveAudio | undefined;
let captures = 0;
let bytes = 0;
let disconnected = false;
const waitFor = async (check: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await Bun.sleep(20);
  assert(check(), "timed out waiting for audio event");
};
try {
  await page.goto(server.url.origin);
  assert.equal(await page.evaluate("window.tracks.length"), 0, "no mic on load");
  await page.getByRole("textbox", { name: "Live command" }).focus();
  await page.keyboard.type("/live");
  await page.keyboard.press("Enter");
  const launch = () =>
    BrowserLiveAudio.launch({
      url: server.url.origin.replace("http", "ws") + "/api/live/audio?role=cli&session=probe",
      secret,
      request: relay.inputTicket("probe", "probe-owner"),
      callbacks: {
        capture(pcm) {
          assert.equal(pcm.length, 640);
          captures++;
          bytes += pcm.length;
        },
        error() {
          disconnected = true;
        },
      },
    });
  audio = await launch();
  await audio.start();
  await waitFor(() => captures >= 5);
  await audio.play(Buffer.alloc(9600), 0);
  await waitFor(() => (audio?.diagnostics.queuedMs ?? 0) > 0);
  await audio.flush(1);
  await waitFor(() => audio?.diagnostics.queuedMs === 0);
  await audio.setCaptureGate(null);
  await Bun.sleep(80);
  const gated = captures;
  await Bun.sleep(120);
  assert.equal(captures, gated, "capture gate must stay closed");
  await audio.setCaptureGate(1);
  await waitFor(() => captures > gated);
  await audio.stop();
  await page.waitForFunction(
    "window.tracks.every(t => t.readyState === 'ended') && window.contexts.every(c => c.state === 'closed')",
  );
  // A fresh explicit command and CLI launch must work after a complete stop.
  await page.getByRole("textbox", { name: "Live command" }).focus();
  await page.keyboard.type("/live");
  await page.keyboard.press("Enter");
  audio = await launch();
  await audio.start();
  await page.evaluate("window.audio.close()");
  await waitFor(() => disconnected);
  await page.waitForFunction(
    "window.tracks.every(t => t.readyState === 'ended') && window.contexts.every(c => c.state === 'closed')",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      pass: true,
      captures,
      bytes,
      stoppedAndReconnected: true,
      browserDisconnectObserved: true,
      providerCalls: 0,
      media: "Chromium fake device, not audible speech",
    }),
  );
} finally {
  audio?.close();
  await browser.close();
  relay.unregisterSession("probe");
  server.stop(true);
  await rm(scratch, { recursive: true, force: true });
}

// Whole browser terminal path, with the actual Live extension and an injected fake provider.
const { startWebServer } = await import("../../src/web/server");
const { loadWebAssets } = await import("../../src/web/assets");
const app = startWebServer({
  command: [process.execPath, resolve(import.meta.dir, "../../tests/web/fixtures/audio-cli.ts"), "--commands"],
  assets: await loadWebAssets(),
  port: 0,
});
const liveBrowser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const livePages: any[] = [];
try {
  for (let i = 0; i < 2; i++) {
    const context = await liveBrowser.newContext();
    const p = await context.newPage();
    livePages.push(p);
    p.setDefaultTimeout(10000);
    await p.addInitScript(() => {
      const w = window as any;
      w.tracks = [];
      w.contexts = [];
      w.denyNext = false;
      w.captureFrames = 0;
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        if (w.denyNext) {
          w.denyNext = false;
          throw new DOMException("Permission denied", "NotAllowedError");
        }
        const stream = await gum(...args);
        w.tracks.push(...stream.getTracks());
        return stream;
      };
      const AC = window.AudioContext;
      window.AudioContext = class extends AC {
        constructor(...args: [AudioContextOptions?]) {
          super(...args);
          w.contexts.push(this);
        }
      };
      w.terminals = new Map();
      const WS = window.WebSocket;
      window.WebSocket = class extends WS {
        constructor(...args: [string | URL, (string | string[])?]) {
          super(...args);
          const parsed = new URL(this.url);
          if (parsed.pathname === "/api/terminal") {
            w.terminals.set(parsed.searchParams.get("tab"), this);
            this.addEventListener("message", ({ data }) => {
              if (JSON.parse(data).type === "ready") (this as any).probeReady = true;
            });
          }
          const send = this.send.bind(this);
          this.send = (data) => {
            if (
              new URL(this.url).pathname === "/api/live/audio" &&
              typeof data === "string" &&
              JSON.parse(data).type === "capture"
            )
              w.captureFrames++;
            send(data);
          };
        }
      };
    });
    await p.goto(app.origin + "/#token=" + app.token);
    await p.waitForFunction(() => {
      const id = document.querySelector('[role="tab"][aria-selected="true"]')?.id.slice(4);
      const socket = (window as any).terminals.get(id);
      return (
        socket?.readyState === WebSocket.OPEN &&
        socket.probeReady &&
        (document.querySelector("#terminal-status") as HTMLElement)?.hidden
      );
    });
    await p.waitForFunction(() =>
      document.querySelector("#terminal")?.textContent?.includes("OFFLINE_LIVE_FIXTURE_READY"),
    );
    assert.equal(await p.evaluate(() => (window as any).tracks.length), 0, "Page load cannot capture");
    assert.equal(await p.locator("#audio-toggle").count(), 0, "No permanent mic button");
  }
  const [owner, observer] = livePages;
  const submit = async (p: any, command: string) => {
    await p.bringToFront();
    await p.locator(".xterm-helper-textarea:visible").focus();
    await p.keyboard.type(command);
    await p.keyboard.press("Enter");
  };
  const released = async (p: any) =>
    p.waitForFunction(
      () =>
        (window as any).tracks.every((t: MediaStreamTrack) => t.readyState === "ended") &&
        (window as any).contexts.every((c: AudioContext) => c.state === "closed"),
    );
  await submit(owner, "/live");
  await owner.waitForFunction(() => (window as any).captureFrames >= 5);
  await owner.waitForFunction(() =>
    document.querySelector("#terminal")?.textContent?.includes("FAKE_PROVIDER_CAPTURED"),
  );
  assert.equal(await observer.evaluate(() => (window as any).tracks.length), 0, "Only issuing browser captures");
  const voice = (
    await (await fetch(app.origin + "/api/workspaces", { headers: { Authorization: "Bearer " + app.token } })).json()
  ).voice;
  await submit(observer, "/live start");
  await Bun.sleep(250);
  assert.deepEqual(
    (await (await fetch(app.origin + "/api/workspaces", { headers: { Authorization: "Bearer " + app.token } })).json())
      .voice,
    voice,
    "Active owner is not stolen",
  );
  assert.equal(await observer.evaluate(() => (window as any).tracks.length), 0);
  await observer.reload();
  await observer.waitForFunction(() => {
    const id = document.querySelector('[role="tab"][aria-selected="true"]')?.id.slice(4);
    const socket = (window as any).terminals.get(id);
    return (
      socket?.readyState === WebSocket.OPEN &&
      socket.probeReady &&
      (document.querySelector("#terminal-status") as HTMLElement)?.hidden
    );
  });
  assert.equal(await observer.evaluate(() => (window as any).tracks.length), 0, "Rejoin cannot capture");
  await submit(owner, "/live stop");
  await released(owner);
  const stoppedFrames = await owner.evaluate(() => (window as any).captureFrames);
  await submit(owner, "/live");
  await owner.waitForFunction(
    (frames: number) =>
      (window as any).tracks.some((t: MediaStreamTrack) => t.readyState === "live") &&
      (window as any).captureFrames >= frames + 5,
    stoppedFrames,
  );
  await submit(owner, "/live stop");
  await released(owner);
  console.log(
    JSON.stringify({
      pass: true,
      normalLiveCommand: true,
      fakeProviderReceivedCapture: true,
      observerNoTracks: true,
      activeOwnerNotStolen: true,
      stopRetry: true,
      autoplayOverride: false,
      providerCalls: 0,
    }),
  );
  await owner.evaluate(() => {
    (window as any).denyNext = true;
  });
  await submit(owner, "/live");
  await owner.locator("#voice-status").waitFor({ state: "visible" });
  await owner.waitForFunction(() => document.querySelector("#audio-status")?.textContent?.includes("denied"));
  assert.equal(await owner.locator("#status").isVisible(), false, "Permission denial is not a PTY outage");
  await owner.locator("#dismiss-voice").click();
  await owner.locator("#voice-status").waitFor({ state: "hidden" });
  await released(owner);
  const deniedFrames = await owner.evaluate(() => (window as any).captureFrames);
  await submit(owner, "/live");
  await owner.waitForFunction(
    (frames: number) =>
      (window as any).tracks.some((t: MediaStreamTrack) => t.readyState === "live") &&
      (window as any).captureFrames >= frames + 5,
    deniedFrames,
  );
  await submit(owner, "/live stop");
  await released(owner);
  await submit(observer, "/live");
  await observer.waitForFunction(() => (window as any).captureFrames >= 5);
  await submit(observer, "/live stop");
  await released(observer);
  const rootPid = (
    await (await fetch(app.origin + "/api/workspaces", { headers: { Authorization: "Bearer " + app.token } })).json()
  ).workspaces[0].tabs[0].pid;
  await submit(owner, "/live");
  await owner.waitForFunction(() => (window as any).tracks.some((t: MediaStreamTrack) => t.readyState === "live"));
  await submit(owner, "/fake-provider-error");
  await released(owner);
  const framesBeforeRestart = await owner.evaluate(() => (window as any).captureFrames);
  await submit(owner, "/live");
  await owner.waitForFunction((frames: number) => (window as any).captureFrames >= frames + 5, framesBeforeRestart);
  await submit(owner, "/live stop");
  await released(owner);
  assert.equal(
    (await (await fetch(app.origin + "/api/workspaces", { headers: { Authorization: "Bearer " + app.token } })).json())
      .workspaces[0].tabs[0].pid,
    rootPid,
    "Voice/provider teardown preserves the coding CLI",
  );
  console.log(
    JSON.stringify({
      pass: true,
      normalLiveCommand: true,
      browsers: 2,
      observerNoTracks: true,
      stopRetry: true,
      permissionDenialRetry: true,
      providerErrorReleaseRetry: true,
      codingPidSurvives: true,
      denial: "injected NotAllowedError",
      autoplayOverride: false,
      providerCalls: 0,
      provider: "injected fake",
    }),
  );
} catch (error) {
  for (const [i, p] of livePages.entries()) {
    console.error("LIVE_BROWSER", i, await p.locator("body").innerText());
    await p.screenshot({ path: resolve(import.meta.dir, "../../artifacts/command-mic/live-failure-" + i + ".png") });
  }
  throw error;
} finally {
  await liveBrowser.close();
  await app.stop();
}
