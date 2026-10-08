import { describe, expect, test } from "bun:test";
import { GptLivePlaybackRecovery, GptLiveSpeechDetector } from "../../src/live/gpt-live-playback";
import type { PlaybackClock } from "../../src/live/playback";

function capture(level: number): Buffer {
  const b = Buffer.alloc(640);
  for (let i = 0; i < b.length; i += 2) b.writeInt16LE(level, i);
  return b;
}
const loud = capture(2300);
const soft = capture(700);
const quiet = capture(0);
const output = () => Buffer.alloc(960); // 20ms at 24k
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// Elapse playback time and deliver timers late, without synthesizing microphone capture.
class PlaybackTestClock implements PlaybackClock {
  private time = 0;
  private serial = 0;
  private readonly timers = new Map<number, { due: number; run: () => void }>();

  now() {
    return this.time;
  }
  get pendingTimers() {
    return this.timers.size;
  }
  setTimeout(run: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = ++this.serial;
    this.timers.set(id, { due: this.time + ms, run });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  clearTimeout(id: ReturnType<typeof setTimeout>) {
    this.timers.delete(id as unknown as number);
  }
  elapse(ms: number) {
    this.time += ms;
    // Deliver the pre-stall timers once; callbacks schedule new work against the new time.
    for (const [id, timer] of [...this.timers]) {
      if (timer.due > this.time) continue;
      this.timers.delete(id);
      timer.run();
    }
  }
}

function harness() {
  const sent: Array<{ pcm: Buffer; generation: number }> = [];
  const flushed: number[] = [];
  const errors: string[] = [];
  const playback = new GptLivePlaybackRecovery({
    send: async (pcm, generation) => {
      sent.push({ pcm, generation });
    },
    flush: async (generation) => {
      flushed.push(generation);
    },
    onError: (error) => {
      errors.push(error.message);
    },
  });
  playback.start();
  return { playback, sent, flushed, errors };
}

describe("GPT-Live processed capture activity (heuristic, not VAD)", () => {
  test("requires sustained speech and hysteretic quiet; no per-amplitude-tick transition", () => {
    const d = new GptLiveSpeechDetector();
    expect(d.observe(loud)).toBeUndefined();
    expect(d.observe(quiet)).toBeUndefined();
    for (let i = 0; i < 3; i++) expect(d.observe(loud)).toBeUndefined();
    expect(d.observe(loud)).toBe("started");
    for (let i = 0; i < 14; i++) expect(d.observe(quiet)).toBeUndefined();
    expect(d.speaking).toBe(true);
    expect(d.observe(soft)).toBeUndefined(); // insufficiently quiet: resets release counter
    for (let i = 0; i < 14; i++) expect(d.observe(quiet)).toBeUndefined();
    expect(d.observe(quiet)).toBe("ended");
    expect(d.speaking).toBe(false);
  });

  test("requires exact processed capture frame", () => {
    const d = new GptLiveSpeechDetector();
    expect(() => d.observe(Buffer.alloc(960))).toThrow();
    expect(() => d.observe(Buffer.alloc(639))).toThrow();
  });
});

describe("GPT-Live bounded queue and local interruption", () => {
  test("overflow fails closed and flushes; cannot accumulate seconds of queued PCM", () => {
    const h = harness();
    expect(h.playback.output(Buffer.alloc(9_600))).toBe(true);
    expect(h.playback.output(output())).toBe(true); // first 20ms already in flight
    expect(h.playback.output(output())).toBe(false);
    expect(h.playback.suppressed).toBe(true);
    expect(h.playback.scheduler.state.pendingBytes).toBe(0);
    expect(h.flushed).toEqual([1]);
    expect(h.errors.some((e) => e.includes("pending budget"))).toBe(true);
    h.playback.close();
  });

  test("GPT-Live queue paces at most an 80ms native reserve even after a delayed timer", async () => {
    const clock = new PlaybackTestClock();
    const writes: number[] = [];
    const playback = new GptLivePlaybackRecovery({
      clock,
      send: async () => {
        writes.push(clock.now());
      },
      flush: async () => {},
      onError: () => {
        throw Error("unexpected");
      },
    });
    playback.start();
    playback.output(Buffer.alloc(9600));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(writes).toHaveLength(4);
    expect(playback.scheduler.state.nativeQueuedMs).toBe(80);
    expect(playback.scheduler.state.pendingBytes).toBe(5760);
    clock.elapse(500);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(writes).toHaveLength(8); // no unlimited catch-up credit
    expect(playback.scheduler.state.nativeQueuedMs).toBe(80);
    for (let i = 0; i < 4; i++) playback.capture(loud);
    expect(playback.scheduler.state.pendingBytes).toBe(0);
    expect(clock.pendingTimers).toBe(0);
    playback.close();
  });

  test("local interruption flushes immediately despite an outstanding native pipe write", async () => {
    const nativeWrite = Promise.withResolvers<void>();
    const flushes: number[] = [];
    let writes = 0;
    const playback = new GptLivePlaybackRecovery({
      send: () => {
        writes++;
        return nativeWrite.promise;
      },
      flush: async (epoch) => {
        flushes.push(epoch);
      },
      onError: () => {
        throw Error("unexpected");
      },
    });
    playback.start();
    playback.output(Buffer.alloc(1920));
    for (let i = 0; i < 4; i++) playback.capture(loud);
    expect(flushes).toEqual([1]);
    expect(playback.scheduler.state.pendingBytes).toBe(0);
    nativeWrite.resolve();
    await tick();
    expect(writes).toBe(1);
    expect(playback.scheduler.playedMs).toBe(0);
    playback.close();
  });
});

describe("GPT-Live recovery from captured quiet", () => {
  test("speech flushes output, suppresses during speech and quiet guard, then automatically resumes arriving stream", async () => {
    const h = harness();
    expect(h.playback.output(output())).toBe(true);
    await tick();
    for (let i = 0; i < 3; i++) expect(h.playback.capture(loud)).toBeUndefined();
    expect(h.playback.capture(loud)).toBe("started");
    expect(h.playback.suppressed).toBe(true);
    expect(h.playback.epoch).toBe(1);
    expect(h.flushed).toEqual([1]);
    expect(h.playback.output(output())).toBe(false);
    for (let i = 0; i < 15; i++) h.playback.capture(quiet);
    expect(h.playback.speaking).toBe(false);
    expect(h.playback.suppressionReason).toBe("settling");
    for (let i = 0; i < 9; i++) h.playback.capture(quiet);
    expect(h.playback.output(output())).toBe(false);
    h.playback.capture(quiet);
    expect(h.playback.suppressed).toBe(false);
    // Same socket, no invented server marker or reset. New arriving bytes may
    // still be an old server tail: best effort, not proven generation attribution.
    expect(h.playback.output(output())).toBe(true);
    await tick();
    expect(h.sent.at(-1)?.generation).toBe(1);
    expect(h.flushed).toEqual([1]);
    h.playback.close();
  });

  test("noise during settling resets the guard; renewed speech flushes again; no indefinite mute", async () => {
    const flushed: number[] = [];
    const p = new GptLivePlaybackRecovery({
      send: async () => {},
      flush: async (e) => {
        flushed.push(e);
      },
      onError: () => {},
    });
    p.start();
    for (let i = 0; i < 4; i++) p.capture(loud);
    for (let i = 0; i < 20; i++) p.capture(quiet);
    p.capture(soft); // below onset but above quiet threshold: reset short guard
    for (let i = 0; i < 9; i++) p.capture(quiet);
    expect(p.output(output())).toBe(false);
    for (let i = 0; i < 4; i++) p.capture(loud);
    expect(flushed).toEqual([1, 2]);
    for (let i = 0; i < 25; i++) p.capture(quiet);
    expect(p.suppressed).toBe(false);
    expect(p.output(output())).toBe(true);
    p.close();
  });

  test("playback clock time cannot replace captured quiet in the recovery guard", async () => {
    const clock = new PlaybackTestClock();
    const p = new GptLivePlaybackRecovery({
      clock,
      send: async () => {},
      flush: async () => {},
      onError: () => {
        throw Error("unexpected");
      },
    });
    p.start();
    for (let i = 0; i < 4; i++) p.capture(loud);
    for (let i = 0; i < 15; i++) p.capture(quiet);
    expect(p.suppressionReason).toBe("settling");
    clock.elapse(60_000); // No microphone frames arrive while playback time advances.
    await tick();
    expect(p.output(output())).toBe(false);
    for (let i = 0; i < 9; i++) p.capture(quiet);
    expect(p.suppressed).toBe(true);
    p.capture(quiet);
    expect(p.suppressed).toBe(false);
    expect(p.epoch).toBe(1);
    p.close();
  });

  test("recovered short output waits for the speech flush and never replays suppressed chunks", async () => {
    const nativeFlush = Promise.withResolvers<void>();
    const sent: Array<{ pcm: Buffer; epoch: number }> = [];
    const p = new GptLivePlaybackRecovery({
      send: async (pcm, epoch) => {
        sent.push({ pcm, epoch });
      },
      flush: () => nativeFlush.promise,
      onError: () => {
        throw Error("unexpected");
      },
    });
    p.start();
    for (let i = 0; i < 4; i++) p.capture(loud);
    expect(p.output(Buffer.alloc(960, 1))).toBe(false);
    for (let i = 0; i < 25; i++) p.capture(quiet);
    const tail = Buffer.from([2, 0]);
    expect(p.output(tail)).toBe(true);
    await tick();
    expect(sent).toEqual([]);
    expect(p.scheduler.state.pendingBytes).toBe(2);
    expect(p.scheduler.playedMs).toBe(0);
    nativeFlush.resolve();
    await tick();
    expect(sent).toEqual([{ pcm: tail, epoch: 1 }]);
    expect(p.scheduler.state.pendingBytes).toBe(0);
    p.close();
  });
});

describe("GPT-Live terminal playback errors", () => {
  test("invalid output is rejected, but does not gate microphone or count as speech", () => {
    const h = harness();
    expect(h.playback.output(Buffer.alloc(1))).toBe(false);
    expect(h.playback.capture(quiet)).toBeUndefined();
    expect(h.playback.speaking).toBe(false);
    expect(h.playback.suppressionReason).toBe("error");
    h.playback.close();
  });

  test("hard output errors do not silently recover when capture becomes quiet", () => {
    const errors: string[] = [];
    const p = new GptLivePlaybackRecovery({
      send: async () => {},
      flush: async () => {},
      onError: (e) => errors.push(e.message),
    });
    p.start();
    expect(p.output(Buffer.alloc(1))).toBe(false);
    for (let i = 0; i < 50; i++) p.capture(quiet);
    expect(p.suppressionReason).toBe("error");
    expect(p.output(output())).toBe(false);
    expect(errors).toEqual(["Invalid GPT-Live PCM16 output"]);
    p.close();
  });

  test("flush failure during speech stays terminal while renewed speech still invalidates the queue", async () => {
    const flushes: number[] = [];
    const errors: string[] = [];
    const p = new GptLivePlaybackRecovery({
      send: async () => {},
      flush: async (epoch) => {
        flushes.push(epoch);
        throw Error("pipe failed");
      },
      onError: (error) => {
        errors.push(error.message);
      },
    });
    p.start();
    for (let i = 0; i < 4; i++) p.capture(loud);
    await tick();
    expect(flushes).toEqual([1]); // The failure must not recursively flush the already discarded queue.
    expect(errors).toEqual(["Playback flush failed"]);
    for (let i = 0; i < 25; i++) p.capture(quiet);
    expect(p.suppressionReason).toBe("error");
    expect(p.output(output())).toBe(false);
    for (let i = 0; i < 3; i++) expect(p.capture(loud)).toBeUndefined();
    expect(p.capture(loud)).toBe("started");
    await tick();
    expect(flushes).toEqual([1, 2]);
    expect(p.epoch).toBe(2);
    expect(errors).toEqual(["Playback flush failed"]);
    p.close();
    expect(p.capture(loud)).toBeUndefined();
    expect(p.output(output())).toBe(false);
    expect(p.epoch).toBe(2);
  });
});
