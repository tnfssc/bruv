import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { type AudioCallbacks, LiveAudio } from "../../src/live/audio";

class Input extends EventEmitter {
  writes: { type: string; [key: string]: unknown }[] = [];
  private pending: ((error?: Error) => void)[] = [];
  accept = true;
  write(value: string, callback: (error?: Error) => void) {
    this.writes.push(JSON.parse(value));
    this.pending.push(callback);
    return this.accept;
  }
  callback(error?: Error) {
    this.pending.shift()!(error);
  }
  drain() {
    this.emit("drain");
  }
  complete() {
    this.callback();
    this.drain();
  }
  get commandTypes() {
    return this.writes.map((command) => command.type);
  }
}
class Worker extends EventEmitter {
  stdin = new Input();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  signals: string[] = [];
  kill(signal = "SIGTERM") {
    this.signals.push(signal);
    return true;
  }
  event(value: unknown) {
    this.stdout.emit("data", Buffer.from(JSON.stringify(value) + "\n"));
  }
}
async function rig(callbacks: AudioCallbacks = {}, captureGate = false) {
  const worker = new Worker();
  const launched = LiveAudio.launch({ worker: worker as never, callbacks });
  worker.event({ type: "hello", protocol: 1, captureGate });
  const audio = await launched;
  const started = audio.start();
  worker.stdin.complete();
  worker.event({ type: "ready" });
  await started;
  return { worker, audio };
}
describe("Live audio protocol boundary", () => {
  test("hello does not start audio; normal stop closes once without error", async () => {
    const worker = new Worker();
    const events: string[] = [];
    const p = LiveAudio.launch({
      worker: worker as never,
      callbacks: { error: () => events.push("error"), closed: () => events.push("closed") },
    });
    worker.event({ type: "hello", protocol: 1 });
    const audio = await p;
    expect(worker.stdin.writes).toEqual([]);
    const starting = audio.start();
    worker.stdin.complete();
    worker.event({ type: "ready" });
    await starting;
    const stopping = audio.stop();
    worker.stdin.complete();
    worker.event({ type: "stopped" });
    await stopping;
    audio.close();
    expect(events).toEqual(["closed"]);
    expect(worker.stdout.listenerCount("data")).toBe(0);
    worker.emit("close");
    expect(worker.listenerCount("error")).toBe(0);
  });
  test("failure notifies once after ready and detaches data/drain", async () => {
    const errors: string[] = [];
    let closed = 0;
    const { worker, audio } = await rig({ error: (code) => errors.push(code), closed: () => closed++ });
    worker.stdin.accept = false;
    const pending = audio.play(Buffer.alloc(960), 0);
    worker.event({ type: "error", code: "playback_full", message: "private" });
    await expect(pending).rejects.toThrow();
    worker.emit("exit", 1);
    audio.close();
    worker.stdin.complete();
    expect(errors).toEqual(["playback_full"]);
    expect(closed).toBe(1);
    expect(worker.stdin.listenerCount("drain")).toBe(0);
    worker.emit("close");
  });
  test("flush rejects unsent stale playback; written bytes are not retractable", async () => {
    const { worker, audio } = await rig();
    worker.stdin.accept = false;
    const written = audio.play(Buffer.alloc(960), 0);
    const stale = audio.play(Buffer.alloc(960), 0);
    const rejected = stale.then(
      () => "unexpected success",
      (error: Error) => error.message,
    );
    const flushed = audio.flush(1);
    expect(await rejected).toContain("interrupted");
    expect(worker.stdin.commandTypes).toEqual(["start", "play"]);
    worker.stdin.complete();
    await written;
    expect(worker.stdin.commandTypes).toEqual(["start", "play", "flush"]);
    worker.stdin.complete();
    await flushed;
    audio.close();
    worker.emit("close");
  });
  test.each([
    ["callback", "drain"],
    ["drain", "callback"],
  ] as const)("stdin acceptance waits for %s then %s", async (first, second) => {
    const { worker, audio } = await rig();
    worker.stdin.accept = false;
    let accepted = false;
    const written = audio.play(Buffer.alloc(960), 0).then(() => {
      accepted = true;
    });
    const next = audio.play(Buffer.alloc(960), 0);
    worker.stdin[first]();
    await Promise.resolve();
    expect(accepted).toBe(false);
    expect(worker.stdin.commandTypes).toEqual(["start", "play"]);
    worker.stdin.accept = true;
    worker.stdin[second]();
    await written;
    expect(accepted).toBe(true);
    expect(worker.stdin.commandTypes).toEqual(["start", "play", "play"]);
    worker.stdin.complete();
    await next;
    audio.close();
    worker.emit("close");
  });
  test("flush and stop keep queued capture controls but interrupt only unsent playback", async () => {
    for (const command of ["flush", "stop"]) {
      const { worker, audio } = await rig({}, true);
      worker.stdin.accept = false;
      const written = audio.play(Buffer.alloc(960), 0);
      const gate = audio.setCaptureGate(null);
      const stale = audio.play(Buffer.alloc(960), 0);
      const rejected = stale.catch((error: Error) => error.message);
      const control = command === "flush" ? audio.flush(1) : audio.stop();
      expect(await rejected).toContain("interrupted");
      expect(worker.stdin.commandTypes).toEqual(["start", "play"]);
      worker.stdin.complete();
      await written;
      expect(worker.stdin.writes[2]).toEqual({ type: "capture_gate", epoch: null });
      worker.stdin.complete();
      await gate;
      expect(worker.stdin.commandTypes).toEqual(["start", "play", "capture_gate", command]);
      worker.stdin.complete();
      if (command === "stop") worker.event({ type: "stopped" });
      await control;
      expect(audio.stopError).toBeUndefined();
      audio.close();
      worker.emit("close");
    }
  });
  test("close rejects active and unsent writes; late callback and drain cannot restart the pipe", async () => {
    const { worker, audio } = await rig();
    worker.stdin.accept = false;
    const written = audio.play(Buffer.alloc(960), 0).catch((error: Error) => error.message);
    const queued = audio.play(Buffer.alloc(960), 0).catch((error: Error) => error.message);
    audio.close();
    expect(await written).toContain("closed");
    expect(await queued).toContain("closed");
    expect(worker.stdin.listenerCount("drain")).toBe(0);
    worker.stdin.complete();
    expect(worker.stdin.commandTypes).toEqual(["start", "play"]);
    // Input/process error guards stay until the child is reaped, not just ownership close.
    expect(worker.stdin.listenerCount("error")).toBe(1);
    worker.emit("close");
    expect(worker.stdin.listenerCount("error")).toBe(0);
  });
  test("active write callback failure rejects active and unsent writes and closes once", async () => {
    const errors: string[] = [];
    let closed = 0;
    const { worker, audio } = await rig({ error: (code) => errors.push(code), closed: () => closed++ });
    worker.stdin.accept = false;
    const written = audio.play(Buffer.alloc(960), 0).catch((error: Error) => error.message);
    const queued = audio.play(Buffer.alloc(960), 0).catch((error: Error) => error.message);

    worker.stdin.callback(new Error("private failure"));
    expect(await written).toBe("Audio helper input failed");
    expect(await queued).toBe("Audio helper input failed");
    expect(errors).toEqual(["helper_failure"]);
    expect(closed).toBe(1);
    expect(worker.stdin.listenerCount("drain")).toBe(0);
    worker.emit("close");
  });
  test("throw while writing the next queued item preserves the accepted write and closes once", async () => {
    const errors: string[] = [];
    let closed = 0;
    const { worker, audio } = await rig({ error: (code) => errors.push(code), closed: () => closed++ });
    worker.stdin.accept = false;
    const written = audio.play(Buffer.alloc(960), 0).catch((error: Error) => error.message);
    const queued = audio.play(Buffer.alloc(960), 0).catch((error: Error) => error.message);

    worker.stdin.write = () => {
      throw new Error("private failure");
    };
    worker.stdin.complete(); // Accepts the active write, then the next queued write throws.
    expect(await written).toBeUndefined();
    expect(await queued).toBe("Audio helper input failed");
    expect(errors).toEqual(["helper_failure"]);
    expect(closed).toBe(1);
    expect(worker.stdin.listenerCount("drain")).toBe(0);
    worker.emit("close");
  });
  test("pre-aborted launch does not own a worker", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(LiveAudio.launch({ worker: new Worker() as never, signal: abort.signal })).rejects.toThrow(
      "cancelled",
    );
  });
  test("aborting start closes helper ownership", async () => {
    const worker = new Worker();
    const controller = new AbortController();
    const launch = LiveAudio.launch({ worker: worker as never, signal: controller.signal });
    worker.event({ type: "hello", protocol: 1 });
    const audio = await launch;
    const start = audio.start();
    controller.abort();
    await expect(start).rejects.toThrow("cancelled");
    expect(worker.signals).toContain("SIGTERM");
    worker.emit("close");
  });
  test("playback accepts a 200ms frame but rejects a larger frame", async () => {
    const { audio, worker } = await rig();
    await expect(audio.play(Buffer.alloc(9602), 0)).rejects.toThrow("Invalid playback frame");
    const p = audio.play(Buffer.alloc(9600), 0);
    worker.stdin.complete();
    await p;
    audio.close();
    worker.emit("close");
  });
});
