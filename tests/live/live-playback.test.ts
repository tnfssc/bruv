import { describe, expect, test } from "bun:test";
import { FRAME_BYTES, MAX_PENDING_BYTES, type PlaybackClock, PlaybackScheduler } from "../../src/live/playback";

class Clock implements PlaybackClock {
  time = 0;
  timerLateness = 0;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + ms + this.timerLateness, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  clearTimeout(id: ReturnType<typeof setTimeout>) {
    this.timers.delete(id as unknown as number);
  }
  advance(ms: number) {
    const end = this.time + ms;
    while (true) {
      let first: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= end && (!first || entry[1].at < first[1].at)) first = entry;
      if (!first) break;
      this.time = Math.max(this.time, first[1].at);
      this.timers.delete(first[0]);
      first[1].fn();
    }
    this.time = end;
  }
  stall(ms: number) {
    this.time += ms;
  }
}
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function harness(
  overrides: {
    send?: (frame: Buffer, epoch: number) => Promise<void>;
    flush?: (epoch: number) => Promise<void>;
    maxPendingBytes?: number;
  } = {},
) {
  const clock = new Clock();
  const sent: { frame: Buffer; epoch: number; at: number }[] = [];
  const flushed: number[] = [];
  const errors: Error[] = [];
  const scheduler = new PlaybackScheduler({
    clock,
    maxPendingBytes: overrides.maxPendingBytes,
    send(frame, epoch) {
      sent.push({ frame, epoch, at: clock.now() });
      return overrides.send?.(frame, epoch) ?? Promise.resolve();
    },
    flush(epoch) {
      flushed.push(epoch);
      return overrides.flush?.(epoch) ?? Promise.resolve();
    },
    onError: (error) => errors.push(error),
  });
  return { clock, sent, flushed, errors, scheduler };
}
// Each attempted write owns its completion; accepting one never releases the next.
class HeldPipe {
  readonly writes: { accept(): void }[] = [];
  send = (_frame: Buffer, _epoch: number): Promise<void> => {
    const write = Promise.withResolvers<void>();
    this.writes.push({ accept: write.resolve });
    return write.promise;
  };
}

type NativeFeedback = "none" | "stale-zero" | "delayed-coarse";

// Native rendering and reported ring depth have their own cadence, independent of JS timers.
class NativeRing {
  queuedMs = 0;
  peakMs = 0;
  underrunMs = 0;
  consumedMs = 0;
  private readonly reports: { at: number; ms: number }[] = [];

  constructor(
    private readonly blockMs: number,
    private readonly feedback: NativeFeedback,
  ) {}

  send = async (frame: Buffer): Promise<void> => {
    this.queuedMs += frame.length / 48;
    this.peakMs = Math.max(this.peakMs, this.queuedMs);
  };

  renderAt(time: number) {
    if (time % this.blockMs !== 0) return;
    const used = Math.min(this.blockMs, this.queuedMs);
    this.underrunMs += this.blockMs - used;
    this.consumedMs += used;
    this.queuedMs -= used;
  }

  feedbackAt(time: number): number[] {
    if (this.feedback === "stale-zero") return [0];
    if (this.feedback === "delayed-coarse" && time % 40 === 0)
      this.reports.push({ at: time + 15, ms: Math.floor(this.queuedMs / 10) * 10 });
    const due: number[] = [];
    while (this.reports[0]?.at === time) due.push(this.reports.shift()!.ms);
    return due;
  }
}

describe("live playback scheduler", () => {
  test("played estimate excludes enqueue and pending writes; accrues only accepted playback time", async () => {
    const pipe = new HeldPipe();
    const h = harness({ send: pipe.send });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 2), 0);
    expect(h.scheduler.playedMs).toBe(0);
    h.scheduler.start();
    h.clock.advance(500);
    expect(h.scheduler.playedMs).toBe(0); // stalled pipe, not played
    pipe.writes[0]!.accept();
    await tick();
    expect(h.scheduler.playedMs).toBe(0); // success is not an audible ack
    h.clock.advance(10);
    expect(h.scheduler.playedMs).toBe(10);
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(20); // gap does not count as audio
    pipe.writes[1]!.accept();
    await tick();
    expect(h.scheduler.playedMs).toBe(20);
    h.clock.advance(8);
    expect(h.scheduler.playedMs).toBe(28);
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(40);
    h.scheduler.close();
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(40);
  });
  test("native ring feedback delays estimate, without moving it backwards", async () => {
    const h = harness();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 2), 0);
    h.scheduler.start();
    await tick();
    h.clock.advance(20);
    await tick();
    expect(h.scheduler.playedMs).toBe(20);
    h.scheduler.nativeQueued(80);
    expect(h.scheduler.playedMs).toBe(20);
    h.clock.advance(20);
    expect(h.scheduler.playedMs).toBe(20);
    h.clock.advance(60);
    expect(h.scheduler.playedMs).toBe(40);
  });
  test("interrupt resets estimate; rejected old write cannot credit new epoch", async () => {
    const oldWrite = Promise.withResolvers<void>();
    const h = harness({
      send: (_frame, epoch) => (epoch === 0 ? oldWrite.promise : Promise.resolve()),
    });
    h.scheduler.start();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0);
    h.clock.advance(100);
    h.scheduler.interrupt(1);
    expect(h.scheduler.playedMs).toBe(0);
    oldWrite.reject(new Error("cancelled"));
    await tick();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 1);
    await tick();
    expect(h.scheduler.playedMs).toBe(0);
    h.clock.advance(10);
    expect(h.scheduler.playedMs).toBe(10);
    h.scheduler.interrupt(2);
    expect(h.scheduler.playedMs).toBe(0);
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(0);
  });
  test("failed current write reports an error without crediting played time", async () => {
    const failed = harness({ send: () => Promise.reject(new Error("pipe failed")) });
    failed.scheduler.start();
    failed.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0);
    await tick();
    failed.clock.advance(100);
    expect(failed.scheduler.playedMs).toBe(0);
    expect(failed.errors).toHaveLength(1);
  });
  test("burst of seconds drains at wall time; turnComplete retains every sample including fractional tail", async () => {
    const h = harness();
    const pcm = Buffer.alloc(48_000 * 4 + 222);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i % 251;
    pcm.writeInt16LE(12345, pcm.length - 2);
    for (let i = 0; i < pcm.length; i += 48000) expect(h.scheduler.enqueue(pcm.subarray(i, i + 48000), 0)).toBe(true);
    h.scheduler.turnComplete(0);
    expect(h.sent).toHaveLength(0); // native not ready
    h.scheduler.start();
    expect(h.sent).toHaveLength(1); // immediate first frame
    for (let i = 0; i < 250; i++) {
      await tick();
      h.clock.advance(20);
    }
    expect(Buffer.concat(h.sent.map((s) => s.frame))).toEqual(pcm);
    expect(h.scheduler.state.pendingBytes).toBe(0);
    expect(h.sent.at(-1)?.frame.length).toBe(222);
    for (const send of h.sent) {
      const totalMs = h.sent.filter((s) => s.at <= send.at).reduce((sum, s) => sum + s.frame.length / 48, 0);
      expect(totalMs).toBeLessThanOrEqual(send.at + 80);
    }
    expect(h.errors).toHaveLength(0);
  });
  test("turn boundaries do not flush; partial chunks join, but adjacent turns remain distinct", async () => {
    const h = harness();
    h.scheduler.start();
    const first = Buffer.alloc(FRAME_BYTES + 100, 1);
    h.scheduler.enqueue(first.subarray(0, 502), 0);
    h.scheduler.enqueue(first.subarray(502), 0);
    h.scheduler.turnComplete(0);
    h.scheduler.enqueue(Buffer.alloc(200, 2), 0);
    h.scheduler.turnComplete(0);
    for (let i = 0; i < 4; i++) {
      await tick();
      h.clock.advance(20);
    }
    expect(h.sent.map((s) => s.frame.length)).toEqual([960, 100, 200]);
    expect(h.flushed).toHaveLength(0);
  });
  test("native feedback only adds throttle; recovery after a stall is bounded to a cushion", async () => {
    const h = harness();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 200), 0);
    h.scheduler.start();
    await tick();
    expect(h.sent).toHaveLength(4);
    h.scheduler.nativeQueued(130);
    h.clock.advance(20);
    await tick();
    expect(h.sent).toHaveLength(4);
    h.clock.stall(1000);
    h.clock.advance(0);
    await tick();
    expect(h.sent).toHaveLength(8); // bounded reserve, not 51 overdue frames
    for (let i = 0; i < 100; i++) h.scheduler.nativeQueued(0);
    await tick();
    expect(h.sent).toHaveLength(8); // stale low snapshots cannot erase reservations
    h.clock.advance(20);
    await tick();
    expect(h.sent).toHaveLength(9);
  });
  for (const blockMs of [1, 10, 32]) {
    for (const feedback of ["none", "stale-zero", "delayed-coarse"] as const) {
      test("late timers keep reserve with " + blockMs + "ms native blocks and " + feedback, async () => {
        const native = new NativeRing(blockMs, feedback);
        const h = harness({ send: native.send });
        h.clock.timerLateness = 2;
        h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 200), 0);
        h.scheduler.turnComplete(0);
        h.scheduler.start();
        await tick();
        for (let time = 1; time <= 2200; time++) {
          native.renderAt(time);
          h.clock.advance(1);
          for (const queuedMs of native.feedbackAt(time)) h.scheduler.nativeQueued(queuedMs);
          await tick();
          expect(h.scheduler.state.nativeQueuedMs).toBeLessThanOrEqual(80);
        }
        expect(native.underrunMs).toBe(0);
        expect(native.consumedMs).toBe(Math.floor(2200 / blockMs) * blockMs);
        // Discrete render phase can hold up to one additional callback block.
        expect(native.peakMs).toBeLessThanOrEqual(80 + blockMs);
        expect(native.peakMs).toBeLessThan(1000);
        expect(h.scheduler.state.pendingBytes).toBeGreaterThan(0);
        expect(h.errors).toHaveLength(0);
      });
    }
  }
  test("low feedback racing write completion cannot create unbounded refill", async () => {
    const h = harness({
      send: async () => {
        h.scheduler.nativeQueued(0);
      },
    });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 200), 0);
    h.scheduler.start();
    await tick();
    expect(h.sent).toHaveLength(4);
    expect(h.scheduler.state.nativeQueuedMs).toBe(80);
    h.scheduler.interrupt(1); // cancel the scheduled refill immediately, even with a full cushion
    expect(h.flushed).toEqual([1]);
    expect(h.scheduler.state.pendingBytes).toBe(0);
    h.clock.advance(100);
    await tick();
    expect(h.sent).toHaveLength(4);
    h.scheduler.enqueue(Buffer.alloc(222, 7), 1);
    h.scheduler.turnComplete(1);
    await tick();
    expect(h.sent.at(-1)?.frame).toEqual(Buffer.alloc(222, 7));
    expect(h.sent.at(-1)?.epoch).toBe(1);
  });
  test("interrupt discards unsent old generation, native flush gates new output; stale write rejection harmless", async () => {
    const oldWrite = Promise.withResolvers<void>();
    const flush = Promise.withResolvers<void>();
    const h = harness({
      send: (_frame, epoch) => (epoch === 0 ? oldWrite.promise : Promise.resolve()),
      flush: () => flush.promise,
    });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 4, 1), 0);
    h.scheduler.start();
    h.scheduler.interrupt(1);
    expect(h.flushed).toEqual([1]);
    expect(h.scheduler.state.pendingBytes).toBe(0);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES, 2), 1);
    oldWrite.reject(new Error("Audio playback interrupted"));
    await tick();
    expect(h.errors).toHaveLength(0);
    expect(h.sent).toHaveLength(1);
    flush.resolve();
    await tick();
    expect(h.sent.map((s) => s.epoch)).toEqual([0, 1]);
    expect(h.sent[1]?.frame).toEqual(Buffer.alloc(FRAME_BYTES, 2));
  });
  test("pending budget excludes the in-flight frame; copied tails keep their turn boundary", async () => {
    const pipe = new HeldPipe();
    const h = harness({ maxPendingBytes: FRAME_BYTES, send: pipe.send });
    h.scheduler.start();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES, 1), 0);
    expect(h.scheduler.state).toMatchObject({ pendingBytes: 0, inFlight: true });
    const tail = Buffer.alloc(100, 2);
    expect(h.scheduler.enqueue(tail, 0)).toBe(true);
    h.scheduler.turnComplete(0);
    tail.fill(9);
    expect(h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES - 100, 3), 0)).toBe(true);
    h.scheduler.turnComplete(0);
    expect(h.scheduler.state.pendingBytes).toBe(FRAME_BYTES);
    pipe.writes[0]!.accept();
    await tick();
    expect(h.sent[1]?.frame).toEqual(Buffer.alloc(100, 2));
    expect(h.scheduler.state.pendingBytes).toBe(FRAME_BYTES - 100);
    pipe.writes[1]!.accept();
    await tick();
    expect(h.sent[2]?.frame).toEqual(Buffer.alloc(FRAME_BYTES - 100, 3));
    expect(h.scheduler.state.pendingBytes).toBe(0);
    h.scheduler.close();
    pipe.writes[2]!.accept();
    await tick();
  });
  test("successful old write holds the pipe slot through flush, but cannot credit the new epoch", async () => {
    const oldWrite = Promise.withResolvers<void>();
    const h = harness({
      send: (_frame, epoch) => (epoch === 0 ? oldWrite.promise : Promise.resolve()),
    });
    h.scheduler.start();
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0);
    h.clock.advance(100);
    h.scheduler.interrupt(1);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 1);
    await tick(); // New flush is accepted, but the old pipe write still owns the slot.
    expect(h.flushed).toEqual([1]);
    expect(h.sent).toHaveLength(1);
    expect(h.scheduler.state).toMatchObject({ pendingBytes: FRAME_BYTES, inFlight: true, epoch: 1 });
    oldWrite.resolve();
    await tick();
    expect(h.sent.map((s) => s.epoch)).toEqual([0, 1]);
    expect(h.scheduler.playedMs).toBe(0);
    h.clock.advance(10);
    expect(h.scheduler.playedMs).toBe(10);
    h.scheduler.close();
    h.clock.advance(100);
    expect(h.scheduler.playedMs).toBe(10);
  });
  test("pending budget is large enough for long replies; exceeded bound reports once, no silent drop", () => {
    const h = harness();
    expect(h.scheduler.enqueue(Buffer.alloc(MAX_PENDING_BYTES), 0)).toBe(true);
    expect(h.scheduler.enqueue(Buffer.alloc(2), 0)).toBe(false);
    expect(h.scheduler.enqueue(Buffer.alloc(2), 0)).toBe(false);
    expect(h.errors).toHaveLength(1);
    expect(h.scheduler.state.pendingBytes).toBe(MAX_PENDING_BYTES);
    h.scheduler.interrupt(1);
    expect(h.scheduler.enqueue(Buffer.alloc(2), 1)).toBe(true);
  });
  test("stalled pipe write does not start extra writes and stop prevents future output", async () => {
    const pipe = new HeldPipe();
    const h = harness({ send: pipe.send });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES * 5), 0);
    h.scheduler.start();
    h.clock.stall(3000);
    h.clock.advance(0);
    await tick();
    expect(h.sent).toHaveLength(1);
    pipe.writes[0]!.accept();
    await tick();
    expect(h.sent).toHaveLength(2); // only one after stall
    h.scheduler.close();
    h.clock.advance(5000);
    await tick();
    expect(h.sent).toHaveLength(2);
    expect(h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0)).toBe(false);
  });
  test("close before native readiness prevents start and output", () => {
    const other = harness();
    other.scheduler.close();
    other.scheduler.start();
    expect(other.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 0)).toBe(false);
    expect(other.sent).toHaveLength(0);
  });
  test("pre-ready interruption flushes before first new frame and close during flush cancels output", async () => {
    const flush = Promise.withResolvers<void>();
    const h = harness({ flush: () => flush.promise });
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES, 1), 0);
    h.scheduler.interrupt(1);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES, 2), 1);
    h.scheduler.start();
    expect(h.flushed).toEqual([1]);
    expect(h.sent).toHaveLength(0);
    h.scheduler.close();
    flush.resolve();
    await tick();
    expect(h.sent).toHaveLength(0);
  });
  test("flush failure is visible and cannot send audio until another interruption", async () => {
    const h = harness({
      flush: (epoch) => (epoch === 1 ? Promise.reject(new Error("flush failed")) : Promise.resolve()),
    });
    h.scheduler.start();
    h.scheduler.interrupt(1);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 1);
    await tick();
    expect(h.errors).toHaveLength(1);
    expect(h.sent).toHaveLength(0);
    h.scheduler.interrupt(2);
    h.scheduler.enqueue(Buffer.alloc(FRAME_BYTES), 2);
    await tick();
    expect(h.sent.map((s) => s.epoch)).toEqual([2]);
  });
});
