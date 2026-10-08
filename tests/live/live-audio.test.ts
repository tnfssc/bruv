import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { type AudioOptions, LiveAudio } from "../../src/live/audio";

class Fake extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  writes: string[] = [];
  constructor() {
    super();
    this.stdin.on("data", (data) => this.writes.push(String(data)));
  }
  emitMessage(message: object) {
    this.stdout.write(JSON.stringify(message) + "\n");
  }
  kill() {
    this.killed = true;
    return true;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// Injection inherits ChildProcess-returning on/off signatures; the pipe fake needs a boundary cast.
type LaunchOptions = Omit<AudioOptions, "worker">;

async function open(options: LaunchOptions = {}, capabilities: { captureGate?: true } = {}) {
  const worker = new Fake();
  const promise = LiveAudio.launch({ worker: worker as unknown as AudioOptions["worker"], ...options });
  worker.emitMessage({ type: "hello", protocol: 1, ...capabilities });
  return { audio: await promise, worker };
}
async function running(options: LaunchOptions = {}) {
  const { audio, worker } = await open(options);
  const start = audio.start();
  await tick();
  worker.emitMessage({ type: "ready" });
  await start;
  return { audio, worker };
}

describe("launch and explicit microphone start", () => {
  test("hello leaves the microphone idle until explicit start and ready", async () => {
    const frames: Buffer[] = [];
    const { audio, worker } = await open({ callbacks: { capture: (frame) => frames.push(frame) } });
    expect(worker.writes).toEqual([]);
    const start = audio.start();
    let ready = false;
    void start.then(() => {
      ready = true;
    });
    await tick();
    expect(worker.writes).toEqual(['{"type":"start"}\n']);
    expect(ready).toBe(false);
    worker.emitMessage({ type: "ready" });
    await start;
    worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64") });
    worker.emitMessage({ type: "played", queuedMs: 20 });
    expect(frames).toHaveLength(1);
    expect(audio.diagnostics).toEqual({ queuedMs: 20, captureFrames: 1, capturedBytes: 640 });
    audio.close();
  });

  test("protocol mismatch closes the helper before launch completes", async () => {
    const worker = new Fake();
    const launch = LiveAudio.launch({ worker: worker as unknown as AudioOptions["worker"], helloTimeoutMs: 20 });
    worker.emitMessage({ type: "hello", protocol: 2 });
    await expect(launch).rejects.toThrow();
    expect(worker.killed).toBe(true);
  });

  test("missing hello times out and closes the helper", async () => {
    const worker = new Fake();
    await expect(
      LiveAudio.launch({ worker: worker as unknown as AudioOptions["worker"], helloTimeoutMs: 10 }),
    ).rejects.toThrow("timed out");
    expect(worker.killed).toBe(true);
  });

  test("missing ready times out and closes the helper", async () => {
    const { audio, worker } = await open({ startTimeoutMs: 10 });
    await expect(audio.start()).rejects.toThrow("timed out");
    expect(worker.killed).toBe(true);
  });
});

describe("playback input", () => {
  test("flush advances the playback generation and rejects stale play", async () => {
    const { audio, worker } = await running();
    await audio.play(Buffer.alloc(960), 0);
    await audio.flush(1);
    expect(worker.writes.slice(1).map((line) => JSON.parse(line).type)).toEqual(["play", "flush"]);
    await expect(audio.play(Buffer.alloc(960), 0)).rejects.toThrow("Stale");
    audio.close();
  });

  test("playback rejects non-increasing generations and invalid frames", async () => {
    const { audio } = await running();
    await expect(audio.flush(0)).rejects.toThrow("increase");
    await expect(audio.play(Buffer.alloc(3), 0)).rejects.toThrow("frame");
    audio.close();
  });

  test("bounded pending input under stalled backpressure", async () => {
    const { audio, worker } = await running();
    // Freeze writes: no callback/drain means queue cannot grow without bound.
    (worker.stdin as unknown as { write: (...args: unknown[]) => boolean }).write = () => false;
    const pending = audio.play(Buffer.alloc(9600), 0);
    const queued = Array.from({ length: 12 }, () => audio.play(Buffer.alloc(9600), 0).catch((e) => e.message));
    expect(await Promise.all(queued.slice(6))).toContain("Audio helper input queue full");
    audio.close();
    await expect(pending).rejects.toThrow("closed");
    await Promise.all(queued);
  });

  test("process exit ends playback ownership", async () => {
    const { audio, worker } = await running();
    worker.emit("exit", 1);
    expect(worker.killed).toBe(true);
    await expect(audio.flush(2)).rejects.toThrow("not running");
  });
});

describe("stop acknowledgement and closing ownership", () => {
  test("native stop queue report precedes the stop acknowledgement", async () => {
    const played: number[] = [];
    const errors: string[] = [];
    let closed = 0;
    const { audio, worker } = await running({
      callbacks: {
        played: (ms: number) => played.push(ms),
        error: (code: string) => errors.push(code),
        closed: () => closed++,
      },
    });
    worker.emitMessage({ type: "played", queuedMs: 20 });
    const stop = audio.stop();
    expect(audio.stop()).toBe(stop);
    await tick();
    expect(JSON.parse(worker.writes.at(-1)!)).toEqual({ type: "stop" });
    // Swift's finishStop barrier writes these two events; stdout may batch them.
    worker.stdout.write('{"type":"played","queuedMs":0}\n{"type":"stopped"}\n');
    await stop;
    expect(audio.stopError).toBeUndefined();
    expect(errors).toEqual([]);
    expect(played).toEqual([20, 0]);
    expect(audio.diagnostics.queuedMs).toBe(0);
    expect(closed).toBe(1);
    expect(worker.killed).toBe(true);
    // Closing ownership retains error guards until the native child is reaped.
    expect(worker.listenerCount("error")).toBe(1);
    worker.emit("close");
    expect(worker.listenerCount("error")).toBe(0);
  });

  test("queue reports during stop do not acknowledge microphone shutdown", async () => {
    const played: number[] = [];
    const errors: string[] = [];
    const { audio, worker } = await running({
      stopTimeoutMs: 20,
      callbacks: { played: (ms: number) => played.push(ms), error: (code: string) => errors.push(code) },
    });
    const stop = audio.stop();
    let acknowledged = false;
    void stop.then(() => {
      acknowledged = true;
    });
    // Linux may still publish pump queue reports while it joins the pump thread.
    worker.emitMessage({ type: "played", queuedMs: 20 });
    worker.emitMessage({ type: "played", queuedMs: 0 });
    await tick();
    expect(acknowledged).toBe(false);
    expect(worker.killed).toBe(false);
    expect(played).toEqual([20, 0]);
    await expect(audio.play(Buffer.alloc(960), 0)).rejects.toThrow("not running");
    await expect(audio.flush(1)).rejects.toThrow("not running");
    await stop;
    expect(audio.stopError).toBe("Audio stop acknowledgement was not observed");
    expect(worker.killed).toBe(true);
    expect(errors).toEqual([]);
    worker.emit("close");
  });

  test("stop still rejects invalid queue reports and unrelated events", async () => {
    for (const message of [{ type: "played", queuedMs: -1 }, { type: "ready" }]) {
      const errors: string[] = [];
      const played: number[] = [];
      const { audio, worker } = await running({
        callbacks: { error: (code: string) => errors.push(code), played: (ms: number) => played.push(ms) },
      });
      const stop = audio.stop();
      worker.emitMessage(message);
      worker.emitMessage({ type: "stopped" });
      await stop;
      expect(errors).toEqual(["helper_failure"]);
      expect(played).toEqual([]);
      expect(audio.stopError).toBe("Audio stop acknowledgement was not observed");
      expect(worker.killed).toBe(true);
      worker.emit("close");
    }
  });

  test("stop timeout closes ownership without claiming acknowledgement", async () => {
    const { audio, worker } = await running({ stopTimeoutMs: 10 });
    await audio.stop();
    expect(audio.stopError).toBe("Audio stop acknowledgement was not observed");
    expect(worker.killed).toBe(true);
  });

  test("stdout EOF after queue drain is not a stop acknowledgement", async () => {
    const { audio, worker } = await running({ stopTimeoutMs: 10 });
    const stop = audio.stop();
    worker.emitMessage({ type: "played", queuedMs: 0 });
    worker.stdout.end();
    await stop;
    expect(audio.stopError).toBe("Audio stop acknowledgement was not observed");
    expect(worker.killed).toBe(true);
    worker.emit("close");
  });

  test("capture after acknowledged stop is ignored", async () => {
    const frames: Buffer[] = [];
    const { audio, worker } = await running({ callbacks: { capture: (frame) => frames.push(frame) } });
    worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64") });
    const stop = audio.stop();
    await tick();
    worker.emitMessage({ type: "stopped" });
    await stop;
    expect(worker.killed).toBe(true);
    worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64") });
    expect(frames).toHaveLength(1);
  });
});

describe("helper protocol rejection", () => {
  test("queue reports before start are rejected", async () => {
    const { audio, worker } = await open();
    worker.emitMessage({ type: "played", queuedMs: 0 });
    expect(worker.killed).toBe(true);
    await expect(audio.start()).rejects.toThrow("not idle");
    worker.emit("close");
  });

  test.each([
    ["oversized line", "x".repeat(65537)],
    ["malformed JSON", "{not-json}"],
    ["invalid capture base64", JSON.stringify({ type: "capture", data: "!!!" })],
    ["short capture frame", JSON.stringify({ type: "capture", data: Buffer.alloc(4).toString("base64") })],
  ])("%s closes the helper and rejects further playback", async (_case, message) => {
    const { audio, worker } = await running();
    worker.stdout.write(message + "\n");
    expect(worker.killed).toBe(true);
    await expect(audio.play(Buffer.alloc(4), 0)).rejects.toThrow();
  });
});

describe("sanitized helper diagnostics", () => {
  test("helper errors never forward private stdout or stderr text", async () => {
    const seen: string[] = [];
    const { worker } = await running({ callbacks: { error: (_: string, msg: string) => seen.push(msg) } });
    worker.stderr.write("secret token");
    worker.emitMessage({ type: "error", code: "BAD_DEVICE", message: "secret token" });
    expect(seen).toEqual(["Audio helper reported an error"]);
    expect(worker.killed).toBe(true);
  });

  test("structured setup error preserves only bounded domain and numeric code", async () => {
    const seen: unknown[] = [];
    const { audio, worker } = await open({
      callbacks: {
        error: (code: string, message: string, setup?: { domain: string; number: number }) =>
          seen.push([code, message, setup]),
      },
    });
    const start = audio.start();
    worker.emitMessage({
      type: "error",
      code: "engine_start",
      domain: "NSOSStatusErrorDomain",
      number: -10875,
      message: "private device",
    });
    await expect(start).rejects.toThrow();
    expect(seen).toEqual([
      ["engine_start", "Audio helper reported an error", { domain: "NSOSStatusErrorDomain", number: -10875 }],
    ]);
  });

  test("untrusted setup domains are discarded", async () => {
    const other: unknown[] = [];
    const next = await open({
      callbacks: {
        error: (_code: string, _message: string, setup?: { domain: string; number: number }) => other.push(setup),
      },
    });
    const pending = next.audio.start();
    next.worker.emitMessage({
      type: "error",
      code: "tap_install",
      domain: "SECRET_TOKEN_123",
      number: 42,
      message: "private",
    });
    await expect(pending).rejects.toThrow();
    expect(other).toEqual([undefined]);
  });

  test("bounded native ready metadata and full-duplex capture during queued playback", async () => {
    const frames: Buffer[] = [];
    const { audio, worker } = await open({ callbacks: { capture: (b: Buffer) => frames.push(b) } });
    const started = audio.start();
    await tick();
    worker.emitMessage({
      type: "ready",
      voiceProcessingEnabled: true,
      voiceProcessingBypassed: false,
      captureRate: 48000,
      renderRate: 48000,
      secret: "discard",
    });
    await started;
    expect(audio.diagnostics.ready).toEqual({
      voiceProcessingEnabled: true,
      voiceProcessingBypassed: false,
      captureRate: 48000,
      renderRate: 48000,
    });
    await audio.play(Buffer.alloc(960), 0);
    worker.emitMessage({ type: "played", queuedMs: 200 });
    worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64") });
    expect(audio.diagnostics).toMatchObject({ queuedMs: 200, captureFrames: 1, capturedBytes: 640 });
    expect(frames).toHaveLength(1);
    audio.close();
  });

  test("invalid ready metadata is discarded without rejecting ready", async () => {
    const invalid = await open();
    const waiting = invalid.audio.start();
    await tick();
    invalid.worker.emitMessage({
      type: "ready",
      voiceProcessingEnabled: "true",
      voiceProcessingBypassed: false,
      captureRate: Infinity,
      renderRate: 48000,
    });
    await waiting;
    expect(invalid.audio.diagnostics.ready).toBeUndefined();
    invalid.audio.close();
  });

  test("ready channel metadata is optional and independently sanitized", async () => {
    const base = {
      type: "ready",
      voiceProcessingEnabled: true,
      voiceProcessingBypassed: false,
      captureRate: 48000,
      renderRate: 48000,
    };
    for (const [channels, expected] of [
      [
        { captureChannels: 9, renderChannels: 2 },
        { captureChannels: 9, renderChannels: 2 },
      ],
      [{ captureChannels: 0, renderChannels: 1.5 }, {}],
      [{ captureChannels: Infinity, renderChannels: 257 }, {}],
      [{ captureChannels: "2", renderChannels: 1 }, { renderChannels: 1 }],
    ] as const) {
      const { audio, worker } = await open();
      const started = audio.start();
      await tick();
      worker.emitMessage({ ...base, ...channels });
      await started;
      expect(audio.diagnostics.ready).toEqual({
        voiceProcessingEnabled: true,
        voiceProcessingBypassed: false,
        captureRate: 48000,
        renderRate: 48000,
        ...expected,
      });
      audio.close();
    }
  });
});

describe("capture-origin gating", () => {
  test("capture-origin gate is opt-in before start; epochs are preserved, never relabeled", async () => {
    const epochs: (number | undefined)[] = [];
    const { audio, worker } = await open(
      { callbacks: { capture: (_: Buffer, epoch?: number) => epochs.push(epoch) } },
      { captureGate: true },
    );
    await audio.setCaptureGate(null);
    const start = audio.start();
    worker.emitMessage({ type: "ready" });
    await start;
    await audio.setCaptureGate(0);
    worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64"), epoch: 0 });
    await audio.setCaptureGate(null);
    await audio.setCaptureGate(1);
    // Parent must discard stale epochs; pipe buffering must NOT turn epoch 0 into 1.
    worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64"), epoch: 0 });
    worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64"), epoch: 1 });
    expect(epochs).toEqual([0, 0, 1]);
    expect(worker.writes.map((x) => JSON.parse(x))).toEqual([
      { type: "capture_gate", epoch: null },
      { type: "start" },
      { type: "capture_gate", epoch: 0 },
      { type: "capture_gate", epoch: null },
      { type: "capture_gate", epoch: 1 },
    ]);
    await expect(audio.setCaptureGate(1)).rejects.toThrow("must increase");
    audio.close();
  });

  test("gating rejects incompatible helpers instead of silently becoming receive-time gating", async () => {
    const { audio, worker } = await open();
    await expect(audio.setCaptureGate(null)).rejects.toThrow("does not support");
    expect(worker.writes).toEqual([]);
    audio.close();
  });

  test("gated capture must carry a valid epoch even when locally muted", async () => {
    for (const epoch of [undefined, null, -1, 1.5, 2147483648, "1"]) {
      const { audio, worker } = await open({}, { captureGate: true });
      await audio.setCaptureGate(null);
      const start = audio.start();
      worker.emitMessage({ type: "ready" });
      await start;
      worker.emitMessage({ type: "capture", data: Buffer.alloc(640).toString("base64"), epoch });
      expect(worker.killed).toBe(true);
    }
  });
});
