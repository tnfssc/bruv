import { afterEach, expect, test } from "bun:test";
import { createAudioRelay, type AudioRelayData } from "../../src/web/audio-relay";
import { BrowserLiveAudio, browserAudioEnvironment } from "../../src/live/browser-audio";
import { parseAudio } from "../../src/live/browser-protocol";
import { liveLocalOnly } from "../../src/live/status";
import liveExtension from "../../src/live/extension";
import { LIVE_PROVIDERS } from "../../src/live/providers";
import type { VoiceCallbacks } from "../../src/live/types";
import { CAPTURE_WORKLET, connectBrowserAudio } from "../../src/web/browser-audio";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function fixture() {
  const relay = createAudioRelay({
    allowedOrigins: ["https://bruv.test"],
    authorizeBrowser: (req, id) => req.headers.get("cookie") === "auth=yes" && id === "owner",
  });
  const server = Bun.serve<AudioRelayData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req, server) => relay.upgrade(req, server),
    websocket: relay.websocket,
  });
  cleanup.push(() => {
    relay.unregisterSession("owner");
    relay.unregisterSession("other");
    server.stop(true);
  });
  const secret = relay.registerSession("owner");
  relay.registerSession("other");
  const base = `ws://127.0.0.1:${server.port}/api/live/audio`;
  return {
    relay,
    server,
    secret,
    cli: base + "?role=cli&session=owner",
    browser: base + "?role=browser&session=owner",
  };
}
async function openBrowser(url: string, headers = { origin: "https://bruv.test", cookie: "auth=yes" }) {
  // Bun supports custom client headers; DOM typings intentionally do not.
  const Client = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
  const ws = new Client(url, { headers });
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("rejected"));
  });
  cleanup.push(() => ws.close());
  return ws;
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(10);
  expect(check()).toBe(true);
}

test("explicit browser environment allows remote root TUI, never workers/RPC, and validates secret/TLS", () => {
  const f = fixture();
  const env = { BRUV_LIVE_RELAY_URL: f.cli, BRUV_LIVE_RELAY_SECRET: f.secret, SSH_CONNECTION: "remote" };
  expect(browserAudioEnvironment(env)).toEqual({ url: f.cli, secret: f.secret });
  expect(liveLocalOnly("tui", env, true)).toBe(true);
  expect(liveLocalOnly("rpc", env, true)).toBe(false);
  expect(liveLocalOnly("tui", { ...env, BRUV_SUBAGENT_DEPTH: "1" }, true)).toBe(false);
  expect(browserAudioEnvironment({})).toBeUndefined();
  expect(() => browserAudioEnvironment({ BRUV_LIVE_RELAY_URL: f.cli })).toThrow();
  expect(() =>
    browserAudioEnvironment({ ...env, BRUV_LIVE_RELAY_URL: "ws://remote.test/audio?session=x&role=cli" }),
  ).toThrow("TLS");
});

test("browser auth, exact origin/session ownership, duplicates and CLI secret fail closed", async () => {
  const f = fixture();
  await expect(openBrowser(f.browser, { origin: "https://evil.test", cookie: "auth=yes" })).rejects.toThrow();
  await expect(openBrowser(f.browser, { origin: "https://bruv.test", cookie: "" })).rejects.toThrow();
  await expect(openBrowser(f.browser.replace("owner", "other"))).rejects.toThrow();
  const browser = await openBrowser(f.browser);
  await expect(openBrowser(f.browser)).rejects.toThrow();
  await expect(BrowserLiveAudio.launch({ url: f.cli, secret: "0".repeat(64), timeoutMs: 1000 })).rejects.toThrow();
  expect(browser.readyState).toBe(WebSocket.OPEN);
  const audio = await BrowserLiveAudio.launch({ url: f.cli, secret: f.secret });
  cleanup.push(() => audio.close());
  await expect(BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, timeoutMs: 1000 })).rejects.toThrow();
  expect(browser.readyState).toBe(WebSocket.OPEN);
});

test("PCM/epochs/queue reports and observed stop use real relay sockets", async () => {
  const f = fixture();
  const browser = await openBrowser(f.browser);
  const received: any[] = [];
  const captures: number[] = [];
  const queued: number[] = [];
  browser.onmessage = ({ data }) => {
    const m = JSON.parse(String(data));
    received.push(m);
    if (m.type === "start") browser.send('{"type":"ready"}');
    if (m.type === "stop") browser.send('{"type":"stopped"}');
  };
  const audio = await BrowserLiveAudio.launch({
    url: f.cli,
    secret: f.secret,
    callbacks: { capture: (b, e) => captures.push(e ?? b.length), played: (m) => queued.push(m) },
  });
  cleanup.push(() => audio.close());
  await audio.start();
  browser.send(JSON.stringify({ type: "capture", data: Buffer.alloc(640).toString("base64") }));
  await until(() => captures.length === 1);
  await audio.setCaptureGate(1);
  browser.send(JSON.stringify({ type: "capture", data: Buffer.alloc(640).toString("base64"), epoch: 0 }));
  browser.send(JSON.stringify({ type: "capture", data: Buffer.alloc(640).toString("base64"), epoch: 1 }));
  await until(() => captures.length === 2);
  expect(captures).toEqual([640, 1]);
  await audio.setCaptureGate(null);
  await audio.play(Buffer.alloc(9600), 0);
  await audio.flush(1);
  await expect(audio.play(Buffer.alloc(2), 0)).rejects.toThrow();
  browser.send('{"type":"played","queuedMs":100}');
  await until(() => queued.length === 1);
  await audio.stop();
  expect(received.map((m) => m.type)).toEqual(["start", "capture_gate", "capture_gate", "play", "flush", "stop"]);
});

test("malformed/browser tool messages and backpressure close audio; no arbitrary forwarding", async () => {
  expect(parseAudio('{"type":"play","data":"AA==","generation":0}', "cli")).toBeUndefined();
  expect(parseAudio('{"type":"played","queuedMs":2000}', "browser")).toBeUndefined();
  const f = fixture();
  const browser = await openBrowser(f.browser);
  let closed = false;
  const audio = await BrowserLiveAudio.launch({
    url: f.cli,
    secret: f.secret,
    callbacks: {
      closed: () => {
        closed = true;
      },
    },
  });
  cleanup.push(() => audio.close());
  browser.send('{"type":"execute","code":"jobs.stopWork()"}');
  await until(() => closed);
  // Injectable mount uses bounded server backpressure, independent of a fast loopback socket.
  const relay = createAudioRelay({ allowedOrigins: [], authorizeBrowser: () => false });
  const secret = relay.registerSession("s");
  const cli: any = {
    data: { channel: "audio", sessionId: "s", role: "cli", authenticated: false },
    close: () => {},
    getBufferedAmount: () => 0,
    send: () => 1,
  };
  let releases = 0;
  const peer: any = {
    data: { channel: "audio", sessionId: "s", role: "browser", authenticated: true },
    close: () => {
      releases++;
    },
    getBufferedAmount: () => 65536,
    send: () => 1,
  };
  relay.websocket.open(peer);
  relay.websocket.open(cli);
  relay.websocket.message(cli, JSON.stringify({ type: "hello", secret }));
  relay.websocket.message(cli, '{"type":"start"}');
  expect(releases).toBe(1);
  relay.unregisterSession("s");
});

test("actual /live command defaults use relay audio; fake provider closes on browser loss without cancelling jobs", async () => {
  const f = fixture();
  const browser = await openBrowser(f.browser);
  const prior = { url: process.env.BRUV_LIVE_RELAY_URL, secret: process.env.BRUV_LIVE_RELAY_SECRET };
  process.env.BRUV_LIVE_RELAY_URL = f.cli;
  process.env.BRUV_LIVE_RELAY_SECRET = f.secret;
  cleanup.push(() => {
    if (prior.url === undefined) delete process.env.BRUV_LIVE_RELAY_URL;
    else process.env.BRUV_LIVE_RELAY_URL = prior.url;
    if (prior.secret === undefined) delete process.env.BRUV_LIVE_RELAY_SECRET;
    else process.env.BRUV_LIVE_RELAY_SECRET = prior.secret;
  });
  browser.onmessage = ({ data }) => {
    if (JSON.parse(String(data)).type === "start") browser.send('{"type":"ready"}');
  };
  let command: any;
  let callbacks!: VoiceCallbacks;
  let providerClosed = 0;
  let ownerClosed = 0;
  let jobCancellation = 0;
  const sent: string[] = [];
  const notes: string[] = [];
  const events = { on: () => () => {}, emit: () => {} };
  liveExtension(
    {
      events,
      appendEntry: () => {},
      on: () => {},
      registerMessageRenderer: () => {},
      registerCommand: (_name: string, c: any) => {
        command = c.handler;
      },
    } as any,
    {
      local: () => true,
      key: async () => "fake-key",
      config: {
        load: async () => ({ provider: "google", model: LIVE_PROVIDERS.google.models[0], inputMode: "continuous" }),
        save: async () => {},
      },
      owner: async () =>
        ({
          orchestration: { instructions: "fake root instructions", tools: [], execute: async () => ({}) },
          close: () => {
            ownerClosed++;
          },
          stopForeground: () => {
            jobCancellation++;
          },
          released: Promise.resolve(),
        }) as any,
      voice: (c) => {
        callbacks = c;
        return {
          state: "ready",
          generation: 0,
          connect: async () => {},
          sendAudio: (b) => sent.push(b),
          close: () => {
            providerClosed++;
          },
        };
      },
    },
  );
  const ctx: any = {
    mode: "tui",
    sessionManager: {
      getSessionId: () => "owner",
      getLeafId: () => "leaf",
      getSessionFile: () => "file",
      getBranch: () => [],
    },
    ui: { notify: (m: string) => notes.push(m), setStatus: () => {}, setWidget: () => {} },
  };
  cleanup.push(async () => {
    await command("stop", ctx);
  });
  await command("start", ctx);
  const pcm = Buffer.alloc(640).toString("base64");
  browser.send(JSON.stringify({ type: "capture", data: pcm }));
  await until(() => sent.length === 1);
  expect(sent).toEqual([pcm]);
  expect(callbacks).toBeDefined();
  browser.close();
  await until(() => providerClosed === 1);
  expect(ownerClosed).toBe(1);
  expect(jobCancellation).toBe(0);
  expect(notes.some((n) => n.includes("No agent work was cancelled"))).toBe(true);
});

test("capture worklet emits 16k little-endian 20ms PCM and tags acquisition epochs", () => {
  let Worklet: any;
  class Processor {
    port = { onmessage: undefined as any, postMessage: (_m: any, _t: any) => {} };
  }
  new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor", CAPTURE_WORKLET)(
    Processor,
    48000,
    (_name: string, ctor: any) => {
      Worklet = ctor;
    },
  );
  const worklet = new Worklet();
  const frames: any[] = [];
  worklet.port.postMessage = (m: any) => frames.push(m);
  worklet.port.onmessage({ data: { type: "start" } });
  worklet.process([[new Float32Array(960).fill(0.5)]]);
  expect(frames[0].bytes.byteLength).toBe(640);
  expect(new DataView(frames[0].bytes).getInt16(0, true)).toBe(16384);
  worklet.port.onmessage({ data: { type: "gate", epoch: 4 } });
  worklet.process([[new Float32Array(960).fill(-0.5)]]);
  expect(frames[1].epoch).toBe(4);
  worklet.port.onmessage({ data: { type: "gate", epoch: null } });
  worklet.process([[new Float32Array(960)]]);
  expect(frames).toHaveLength(2);
});

test("browser client with fake devices sends PCM, schedules 24k output, flushes, and releases on CLI stop", async () => {
  const f = fixture();
  const NativeSocket = WebSocket;
  const Client = NativeSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> },
  ) => WebSocket;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  function replace(name: string, value: unknown) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  cleanup.push(() => {
    for (const [name, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
  });
  const nodes: any[] = [];
  let port: any;
  let tracksStopped = 0;
  let contextsClosed = 0;
  let bufferRate = 0;
  class Context {
    currentTime = 0;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    resume = async () => {};
    close = async () => {
      contextsClosed++;
    };
    createMediaStreamSource = () => ({ connect: () => {}, disconnect: () => {} });
    createBuffer = (_channels: number, length: number, rate: number) => {
      bufferRate = rate;
      return { duration: length / rate, getChannelData: () => new Float32Array(length) };
    };
    createBufferSource = () => {
      const node = {
        buffer: null,
        onended: null,
        stopped: false,
        at: -1,
        connect: () => {},
        disconnect: () => {},
        stop: () => {
          node.stopped = true;
        },
        start: (at: number) => {
          node.at = at;
        },
      };
      nodes.push(node);
      return node;
    };
  }
  class Worklet {
    port = { onmessage: null as any, postMessage: () => {} };
    constructor() {
      port = this.port;
    }
    connect() {}
    disconnect() {}
  }
  const track = {
    stop: () => {
      tracksStopped++;
    },
    onended: null,
  };
  replace("location", {
    href: `http://127.0.0.1:${f.server.port}/`,
    protocol: "http:",
    host: `127.0.0.1:${f.server.port}`,
  });
  replace("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
  replace("AudioContext", Context);
  replace("AudioWorkletNode", Worklet);
  replace(
    "WebSocket",
    class extends Client {
      static OPEN = NativeSocket.OPEN;
      constructor(url: string) {
        super(url, { headers: { origin: "https://bruv.test", cookie: "auth=yes" } });
      }
    },
  );
  const states: string[] = [];
  const browser = await connectBrowserAudio({ url: f.browser, onState: (s) => states.push(s) });
  cleanup.push(() => browser.close());
  // CLI must have no Origin, just like the real server-side child.
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: NativeSocket });
  let captures = 0;
  const audio = await BrowserLiveAudio.launch({
    url: f.cli,
    secret: f.secret,
    callbacks: {
      capture: (b) => {
        expect(b.length).toBe(640);
        captures++;
      },
    },
  });
  cleanup.push(() => audio.close());
  await audio.start();
  port.onmessage({ data: { bytes: new ArrayBuffer(640) } });
  await until(() => captures === 1);
  await audio.play(Buffer.alloc(9600), 0);
  await until(() => nodes.length === 1);
  expect(bufferRate).toBe(24000);
  expect(nodes[0].at).toBe(0.01);
  await audio.flush(1);
  await until(() => nodes[0].stopped);
  await audio.stop();
  expect(tracksStopped).toBe(1);
  expect(contextsClosed).toBe(1);
  expect(states).toContain("running");
  expect(states).toContain("closed");
});

test("CLI waits for its exact browser; session revocation closes both and rejects reuse", async () => {
  const f = fixture();
  let launched = false;
  const pending = BrowserLiveAudio.launch({ url: f.cli, secret: f.secret }).then((audio) => {
    launched = true;
    return audio;
  });
  await Bun.sleep(20);
  expect(launched).toBe(false);
  const browser = await openBrowser(f.browser);
  const audio = await pending;
  cleanup.push(() => audio.close());
  let released = false;
  browser.onclose = () => {
    released = true;
  };
  f.relay.unregisterSession("owner");
  await until(() => released);
  await expect(openBrowser(f.browser)).rejects.toThrow();
  await expect(BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, timeoutMs: 1000 })).rejects.toThrow();
});
