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
    'document.querySelector("button").onclick = async () => { try { window.audio = await connectBrowserAudio({url: location.origin.replace("http", "ws") + "/api/live/audio?role=browser&session=probe", onState: s => window.states.push(s)}); } catch(e) { window.failure = String(e); } };',
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
  authorizeBrowser: (req, id) => id === "probe" && req.headers.get("cookie") === "probe=authorized",
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
    return new Response('<button>Enable microphone</button><script src="/probe.js"></script>', {
      headers: { "Content-Type": "text/html", "Set-Cookie": "probe=authorized; SameSite=Strict; HttpOnly; Path=/" },
    });
  },
  websocket: relay.websocket,
});
origins.push(server.url.origin);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
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
  assert.equal(await page.evaluate("window.tracks.length"), 0, "no mic before click");
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await page.waitForFunction("window.states.includes('enabled') || window.failure");
  assert.equal(await page.evaluate("window.failure"), undefined);
  const launch = () =>
    BrowserLiveAudio.launch({
      url: server.url.origin.replace("http", "ws") + "/api/live/audio?role=cli&session=probe",
      secret,
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
  // A fresh explicit click and CLI launch must work after a complete stop.
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await page.waitForFunction("window.states.filter(s => s === 'enabled').length === 2 || window.failure");
  assert.equal(await page.evaluate("window.failure"), undefined);
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
