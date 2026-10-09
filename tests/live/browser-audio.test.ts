import { afterEach, expect, test } from "bun:test";
import { createAudioRelay, type AudioRelayData } from "../../src/web/audio-relay";
import { BrowserLiveAudio, browserAudioEnvironment } from "../../src/live/browser-audio";
import { BROWSER_INPUT_MARKER, parseAudio } from "../../src/live/browser-protocol";
import { liveLocalOnly } from "../../src/live/status";
import liveExtension from "../../src/live/extension";
import { LIVE_PROVIDERS } from "../../src/live/providers";
import type { VoiceCallbacks } from "../../src/live/types";
import { CAPTURE_WORKLET, connectBrowserAudio } from "../../src/web/browser-audio";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const privateOwner = "private-attachment-capability";
const publicOwner = "public-presence-id";
function fixture(targetAvailable = true) {
  const requests: { session: string; owner: string; request: string }[] = [];
  const cancelled: typeof requests = [];
  const relay = createAudioRelay({
    allowedOrigins: ["https://bruv.test"],
    authorizeBrowser: (req, id) =>
      id === "owner" && req.headers.get("cookie") === "auth=yes"
        ? (req.headers.get("x-attachment") ?? privateOwner)
        : false,
    requestBrowser: (session, owner, request) => {
      requests.push({ session, owner, request });
      return targetAvailable;
    },
    cancelBrowser: (session, owner, request) => {
      cancelled.push({ session, owner, request });
    },
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
  const otherSecret = relay.registerSession("other");
  const base = `ws://127.0.0.1:${server.port}/api/live/audio`;
  return {
    relay,
    requests,
    cancelled,
    ticket: () => relay.inputTicket("owner", privateOwner),
    server,
    secret,
    otherSecret,
    cli: base + "?role=cli&session=owner",
    browser: base + "?role=browser&session=owner",
  };
}
async function openBrowser(
  url: string,
  headers: Record<string, string> = { origin: "https://bruv.test", cookie: "auth=yes" },
) {
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

async function acquire(
  f: ReturnType<typeof fixture>,
  options: Partial<Parameters<typeof BrowserLiveAudio.launch>[0]> = {},
) {
  const request = f.ticket();
  const pending = BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, ...options, request });
  await until(() => f.requests.some((r) => r.request === request));
  const browser = await openBrowser(f.browser + "&request=" + request);
  const audio = await pending;
  cleanup.push(() => audio.close());
  return { browser, audio, request };
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

test("browser auth and exact request capability fail closed without stealing active ownership", async () => {
  const f = fixture();
  await expect(openBrowser(f.browser)).rejects.toThrow(); // No manual pre-attach.
  const request = f.ticket();
  await expect(
    BrowserLiveAudio.launch({ url: f.cli, secret: "0".repeat(64), request, timeoutMs: 1000 }),
  ).rejects.toThrow();
  const pending = BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, request });
  await until(() => f.requests.length === 1);
  expect(f.requests).toEqual([{ session: "owner", owner: privateOwner, request }]);
  const url = f.browser + "&request=" + request;
  await expect(openBrowser(url, { origin: "https://evil.test", cookie: "auth=yes" })).rejects.toThrow();
  await expect(openBrowser(url, { origin: "https://bruv.test", cookie: "" })).rejects.toThrow();
  await expect(openBrowser(url.replace("session=owner", "session=other"))).rejects.toThrow();
  await expect(
    openBrowser(url, { origin: "https://bruv.test", cookie: "auth=yes", "x-attachment": "observer-capability" }),
  ).rejects.toThrow();
  await expect(
    openBrowser(url, { origin: "https://bruv.test", cookie: "auth=yes", "x-attachment": publicOwner }),
  ).rejects.toThrow();
  await expect(openBrowser(f.browser + "&request=" + f.ticket())).rejects.toThrow();
  expect(f.cancelled).toEqual([]);
  const browser = await openBrowser(url);
  const audio = await pending;
  cleanup.push(() => audio.close());
  await expect(openBrowser(url)).rejects.toThrow();
  await expect(
    BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, request: f.ticket(), timeoutMs: 1000 }),
  ).rejects.toThrow();
  f.relay.releaseAttachment("owner", publicOwner);
  f.relay.releaseAttachment("owner", "observer-capability");
  expect(browser.readyState).toBe(WebSocket.OPEN);
  expect(f.cancelled).toEqual([]);
  f.relay.releaseAttachment("owner", privateOwner);
  await until(() => browser.readyState === WebSocket.CLOSED);
  expect(f.cancelled).toEqual([{ session: "owner", owner: privateOwner, request }]);
});

test("CLI tickets are required, attributed and consumed once; fresh commands can reacquire", async () => {
  const f = fixture();
  const launch = (request?: string) =>
    BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, request, timeoutMs: 1000 });
  await expect(launch()).rejects.toThrow("unmixed browser command");
  const unattributed = f.relay.inputTicket("owner", undefined);
  await expect(launch(unattributed)).rejects.toThrow("unmixed browser command");
  expect(f.requests).toEqual([]);
  const { audio, browser, request } = await acquire(f);
  audio.close();
  await until(() => browser.readyState === WebSocket.CLOSED);
  await expect(launch(request)).rejects.toThrow("unmixed browser command");
  expect(f.requests).toHaveLength(1);
  const next = await acquire(f);
  expect(next.request).not.toBe(request);
  expect(f.requests).toHaveLength(2);
});

test("another terminal cannot steal active audio and observer release leaves it alive", async () => {
  const f = fixture();
  const { browser, request } = await acquire(f);
  const otherRequest = f.relay.inputTicket("other", "other-private-owner");
  await expect(
    BrowserLiveAudio.launch({
      url: f.cli.replace("session=owner", "session=other"),
      secret: f.otherSecret,
      request: otherRequest,
    }),
  ).rejects.toThrow("already active");
  f.relay.releaseAttachment("owner", "observer-capability");
  expect(browser.readyState).toBe(WebSocket.OPEN);
  expect(f.requests).toEqual([{ session: "owner", owner: privateOwner, request }]);
  expect(f.cancelled).toEqual([]);
});

test("detached request target and permission refusal cancel acquisition and allow a fresh command", async () => {
  const detached = fixture(false);
  const detachedRequest = detached.ticket();
  await expect(
    BrowserLiveAudio.launch({ url: detached.cli, secret: detached.secret, request: detachedRequest }),
  ).rejects.toThrow("detached");
  expect(detached.cancelled).toEqual(detached.requests);

  const f = fixture();
  const request = f.ticket();
  const pending = BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, request });
  const rejected = pending.then(
    () => undefined,
    (error: Error) => error,
  );
  await until(() => f.requests.length === 1);
  // An observer/public ID and the wrong ticket cannot end the pending owner request.
  f.relay.failRequest("owner", publicOwner, request, "Not the owner");
  f.relay.failRequest("owner", privateOwner, f.ticket(), "Not this request");
  expect(f.cancelled).toEqual([]);
  f.relay.failRequest("owner", privateOwner, request, "Microphone permission denied");
  expect((await rejected)?.message).toBe("Microphone permission denied");
  expect(f.cancelled).toEqual([{ session: "owner", owner: privateOwner, request }]);
  await expect(openBrowser(f.browser + "&request=" + request)).rejects.toThrow();
  await acquire(f);
});

test("PCM/epochs/queue reports and observed stop use real relay sockets", async () => {
  const f = fixture();
  const received: any[] = [];
  const captures: number[] = [];
  const queued: number[] = [];
  const { browser, audio } = await acquire(f, {
    callbacks: { capture: (b, e) => captures.push(e ?? b.length), played: (m) => queued.push(m) },
  });
  browser.onmessage = ({ data }) => {
    const m = JSON.parse(String(data));
    received.push(m);
    if (m.type === "start") browser.send('{"type":"ready"}');
    if (m.type === "stop") browser.send('{"type":"stopped"}');
  };
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
  let closed = false;
  const { browser } = await acquire(f, {
    callbacks: {
      closed: () => {
        closed = true;
      },
    },
  });
  browser.send('{"type":"execute","code":"jobs.stopWork()"}');
  await until(() => closed);
  // Injectable mount uses bounded server backpressure, independent of a fast loopback socket.
  const relay = createAudioRelay({
    allowedOrigins: ["https://bruv.test"],
    authorizeBrowser: () => privateOwner,
    requestBrowser: () => true,
  });
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
  relay.websocket.open(cli);
  const request = relay.inputTicket("s", privateOwner);
  relay.websocket.message(cli, JSON.stringify({ type: "hello", secret, request }));
  await relay.upgrade(
    new Request("http://localhost/api/live/audio?role=browser&session=s&request=" + request, {
      headers: { origin: "https://bruv.test" },
    }),
    {
      upgrade: (_req, options) => {
        peer.data = options.data;
        return true;
      },
    },
  );
  relay.websocket.open(peer);
  relay.websocket.message(cli, '{"type":"start"}');
  expect(releases).toBe(1);
  relay.unregisterSession("s");
});

test("actual /live command defaults use relay audio; fake provider closes on browser loss without cancelling jobs", async () => {
  const f = fixture();
  const prior = { url: process.env.BRUV_LIVE_RELAY_URL, secret: process.env.BRUV_LIVE_RELAY_SECRET };
  process.env.BRUV_LIVE_RELAY_URL = f.cli;
  process.env.BRUV_LIVE_RELAY_SECRET = f.secret;
  cleanup.push(() => {
    if (prior.url === undefined) delete process.env.BRUV_LIVE_RELAY_URL;
    else process.env.BRUV_LIVE_RELAY_URL = prior.url;
    if (prior.secret === undefined) delete process.env.BRUV_LIVE_RELAY_SECRET;
    else process.env.BRUV_LIVE_RELAY_SECRET = prior.secret;
  });
  let command: any;
  let callbacks!: VoiceCallbacks;
  let providerClosed = 0;
  let ownerClosed = 0;
  let jobCancellation = 0;
  const sent: string[] = [];
  const notes: string[] = [];
  const events = { on: () => () => {}, emit: () => {} };
  const handlers = new Map<string, any>();
  let observeInput: any;
  liveExtension(
    {
      events,
      appendEntry: () => {},
      on: (name: string, handler: any) => handlers.set(name, handler),
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
    ui: {
      notify: (m: string) => notes.push(m),
      setStatus: () => {},
      setWidget: () => {},
      onTerminalInput: (observer: any) => {
        observeInput = observer;
        return () => {};
      },
    },
  };
  cleanup.push(async () => {
    await command("stop", ctx);
  });
  handlers.get("session_start")({}, ctx);
  const request = f.ticket();
  expect(observeInput(BROWSER_INPUT_MARKER + request + "\x07")).toEqual({ consume: true });
  const pending = command("start", ctx);
  await until(() => f.requests.length === 1);
  const browser = await openBrowser(f.browser + "&request=" + request);
  browser.onmessage = ({ data }) => {
    if (JSON.parse(String(data)).type === "start") browser.send('{"type":"ready"}');
  };
  await pending;
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
  replace("isSecureContext", true);
  replace("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
  replace("AudioContext", Context);
  replace("AudioWorkletNode", Worklet);
  let captures = 0;
  const request = f.ticket();
  const pending = BrowserLiveAudio.launch({
    url: f.cli,
    secret: f.secret,
    request,
    callbacks: {
      capture: (b) => {
        expect(b.length).toBe(640);
        captures++;
      },
    },
  });
  await until(() => f.requests.length === 1);
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
  const browser = await connectBrowserAudio({ url: f.browser + "&request=" + request, onState: (s) => states.push(s) });
  cleanup.push(() => browser.close());
  const audio = await pending;
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
  const request = f.ticket();
  const pending = BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, request }).then((audio) => {
    launched = true;
    return audio;
  });
  await Bun.sleep(20);
  expect(launched).toBe(false);
  await until(() => f.requests.length === 1);
  const browser = await openBrowser(f.browser + "&request=" + request);
  const audio = await pending;
  cleanup.push(() => audio.close());
  let released = false;
  browser.onclose = () => {
    released = true;
  };
  f.relay.unregisterSession("owner");
  await until(() => released);
  await expect(openBrowser(f.browser)).rejects.toThrow();
  await expect(BrowserLiveAudio.launch({ url: f.cli, secret: f.secret, request, timeoutMs: 1000 })).rejects.toThrow();
});

test("insecure browser context reports HTTPS before acquiring devices", async () => {
  const names = ["location", "isSecureContext"] as const;
  const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  try {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: "http://bruv.test/", protocol: "http:", host: "bruv.test" },
    });
    Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: false });
    await expect(
      connectBrowserAudio({ url: "ws://bruv.test/api/live/audio?role=browser&session=owner&request=test" }),
    ).rejects.toThrow("Microphone needs HTTPS or localhost");
  } finally {
    names.forEach((name, i) => {
      const descriptor = descriptors[i];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
