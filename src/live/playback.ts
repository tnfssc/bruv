/** Bounded real-time PCM16/24kHz mono playback. Pipe writes are not audible acknowledgements. */
export const FRAME_BYTES = 960; // 20ms
export const MAX_PENDING_BYTES = 2_880_000; // 60 seconds
export type PlaybackClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};
export type PlaybackState = { pendingBytes: number; nativeQueuedMs: number; inFlight: boolean; epoch: number };
export type PlaybackOptions = {
  send(frame: Buffer, generation: number): Promise<void>;
  flush(generation: number): Promise<void>;
  onError(error: Error): void;
  onState?: (state: PlaybackState) => void;
  clock?: PlaybackClock;
  maxPendingBytes?: number;
};
type Piece = { data: Buffer; offset: number } | null; // null is a turn boundary
const realClock: PlaybackClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

/** Owns unsent samples and their turn boundaries; pending bytes exclude a taken frame. */
class PendingAudio {
  private pieces: Piece[] = [];
  private pending = 0;
  get bytes() {
    return this.pending;
  }
  append(data: Buffer) {
    this.pieces.push({ data: Buffer.from(data), offset: 0 });
    this.pending += data.length;
  }
  endTurn() {
    if (this.pieces.length && this.pieces.at(-1) !== null) this.pieces.push(null);
  }
  clear() {
    this.pieces = [];
    this.pending = 0;
  }
  /** Full frame, completed-turn tail, or zero when more samples are needed. */
  nextFrameBytes(): number {
    while (this.pieces[0] === null) this.pieces.shift();
    let bytes = 0;
    for (const part of this.pieces) {
      if (part === null) return Math.min(FRAME_BYTES, bytes);
      bytes += part.data.length - part.offset;
      if (bytes >= FRAME_BYTES) return FRAME_BYTES;
    }
    return 0;
  }
  take(count: number): Buffer {
    const frame = Buffer.allocUnsafe(count);
    let offset = 0;
    while (offset < count) {
      const part = this.pieces[0];
      if (!part) throw new Error("Playback frame crossed turn boundary");
      const size = Math.min(count - offset, part.data.length - part.offset);
      part.data.copy(frame, offset, part.offset, part.offset + size);
      part.offset += size;
      offset += size;
      if (part.offset === part.data.length) this.pieces.shift();
    }
    this.pending -= count;
    if (this.pieces[0] === null) this.pieces.shift();
    return frame;
  }
}

/** Reservation throttles writes; acceptance and elapsed time bound the played estimate.
 * Native ring reports are neither write acknowledgements nor epoch-tagged DAC receipts. */
class PlaybackTimeline {
  private ringMs = 0;
  private ringAt = 0;
  private acceptedMs = 0;
  private elapsedMs = 0;
  private countedMs = 0;
  private countedAt = 0;
  private frozen = false;
  constructor(private readonly clock: PlaybackClock) {}
  get queuedMs() {
    return Math.max(0, this.ringMs - Math.max(0, this.clock.now() - this.ringAt));
  }
  get playedMs(): number {
    if (this.frozen) return this.countedMs;
    this.advancePlayedClock();
    // Late/high feedback cannot retract progress already reported to the provider.
    this.countedMs = Math.max(this.countedMs, Math.min(this.elapsedMs, Math.max(0, this.acceptedMs - this.queuedMs)));
    return this.countedMs;
  }
  reserve(bytes: number, at: number) {
    this.ringMs = this.queuedMs + bytes / 48;
    this.ringAt = at;
  }
  accept(bytes: number) {
    // Advance before adding credit: time spent waiting for stdin is not played audio.
    this.advancePlayedClock();
    this.acceptedMs += bytes / 48;
  }
  reportQueued(ms: number) {
    // A delayed low snapshot must not erase credit reserved for subsequent writes.
    this.ringMs = Math.max(this.queuedMs, ms);
    this.ringAt = this.clock.now();
  }
  reset() {
    this.acceptedMs = 0;
    this.elapsedMs = 0;
    this.countedMs = 0;
    this.countedAt = this.clock.now();
    this.ringMs = 0;
    this.ringAt = this.clock.now();
  }
  freezePlayedEstimate() {
    void this.playedMs;
    this.frozen = true;
  }
  private advancePlayedClock() {
    const now = this.clock.now();
    this.elapsedMs = Math.min(this.acceptedMs, this.elapsedMs + Math.max(0, now - this.countedAt));
    this.countedAt = now;
  }
}

export class PlaybackScheduler {
  private readonly clock: PlaybackClock;
  private readonly limit: number;
  private readonly queue = new PendingAudio();
  private readonly timeline: PlaybackTimeline;
  private epochValue = 0;
  private active = false;
  private closed = false;
  private blocked = false;
  private overflowed = false;
  private writing = false;
  private flushing = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly options: PlaybackOptions) {
    this.clock = options.clock ?? realClock;
    this.timeline = new PlaybackTimeline(this.clock);
    this.limit = options.maxPendingBytes ?? MAX_PENDING_BYTES;
    if (!Number.isSafeInteger(this.limit) || this.limit < FRAME_BYTES)
      throw new Error("Invalid playback pending limit");
  }
  get state(): PlaybackState {
    return {
      pendingBytes: this.queue.bytes,
      nativeQueuedMs: this.timeline.queuedMs,
      inFlight: this.writing,
      epoch: this.epochValue,
    };
  }
  /** Estimated played PCM time in this epoch, not bytes generated or merely queued.
   * No native DAC acknowledgement exists; this is a conservative wall-clock/ring estimate. */
  get playedMs(): number {
    return this.timeline.playedMs;
  }
  private emit() {
    this.options.onState?.(this.state);
  }
  /** Call only when native is ready. Idempotent. */
  start() {
    if (this.closed || this.active) return;
    this.active = true;
    if (this.epochValue) this.flushNative();
    else this.pump();
  }
  /** Copies PCM input. Returns false on stale generation, invalid input or capacity failure. */
  enqueue(data: Buffer, epoch: number): boolean {
    if (this.closed || this.blocked || epoch !== this.epochValue || this.overflowed) return false;
    if (!Buffer.isBuffer(data) || data.length % 2) {
      this.options.onError(new Error("Invalid PCM16 playback chunk"));
      return false;
    }
    if (!data.length) return true;
    if (data.length > this.limit - this.queue.bytes) {
      this.overflowed = true;
      this.options.onError(
        new Error("Local playback queue exceeds pending budget (" + this.limit + " bytes); audio incomplete"),
      );
      return false;
    }
    this.queue.append(data);
    this.emit();
    this.pump();
    return true;
  }
  /** Allows a sub-frame tail through; never flushes at a normal turn boundary. */
  turnComplete(epoch: number) {
    if (this.closed || epoch !== this.epochValue) return;
    this.queue.endTurn();
    this.pump();
  }
  /** Native played events report ring depth, not a per-frame audible acknowledgement. */
  nativeQueued(ms: number) {
    if (this.closed || !Number.isFinite(ms) || ms < 0) return;
    this.timeline.reportQueued(ms);
    this.emit();
    this.pump();
  }
  /** Discard unsent prior-epoch bytes now; native flush precedes any new sends. */
  interrupt(epoch: number) {
    if (this.closed || !Number.isSafeInteger(epoch) || epoch <= this.epochValue) return;
    this.cancelTimer();
    this.epochValue = epoch;
    this.timeline.reset();
    this.queue.clear();
    this.overflowed = false;
    this.blocked = false;
    this.emit();
    if (this.active) this.flushNative();
  }
  close() {
    if (this.closed) return;
    this.timeline.freezePlayedEstimate();
    this.closed = true;
    this.active = false;
    this.cancelTimer();
    this.queue.clear();
    this.emit();
  }
  private cancelTimer() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
  private flushNative() {
    const epoch = this.epochValue;
    this.flushing = true;
    // Invoke immediately even if an old pipe write has not settled.
    let result: Promise<void>;
    try {
      result = this.options.flush(epoch);
    } catch (cause) {
      result = Promise.reject(cause);
    }
    Promise.resolve(result).then(
      () => {
        if (this.closed || epoch !== this.epochValue) return;
        this.flushing = false;
        this.pump();
      },
      () => {
        if (this.closed || epoch !== this.epochValue) return;
        this.flushing = false;
        this.blocked = true;
        this.options.onError(new Error("Playback flush failed"));
      },
    );
  }
  private pump() {
    if (!this.active || this.closed || this.flushing || this.blocked || this.writing) return;
    const bytes = this.queue.nextFrameBytes();
    if (!bytes) return;
    const now = this.clock.now();
    // Refill a small reserve, not one frame per timer. Late timers can recover
    // without accumulating unlimited catch-up credit: at most 80ms is reserved.
    const wait = Math.max(0, this.timeline.queuedMs - 60);
    if (wait > 0) {
      this.cancelTimer();
      this.timer = this.clock.setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    this.cancelTimer();
    this.writeFrame(this.queue.take(bytes), now);
  }
  private writeFrame(frame: Buffer, now: number) {
    const epoch = this.epochValue;
    this.timeline.reserve(frame.length, now);
    this.writing = true;
    this.emit();
    let result: Promise<void>;
    try {
      result = this.options.send(frame, epoch);
    } catch (cause) {
      result = Promise.reject(cause);
    }
    Promise.resolve(result).then(
      () => {
        if (!this.closed && epoch === this.epochValue) {
          this.timeline.accept(frame.length);
        }
        this.writing = false;
        if (this.closed) return;
        this.emit();
        this.pump();
      },
      () => {
        this.writing = false;
        if (this.closed) return;
        if (epoch !== this.epochValue) {
          this.pump();
          return;
        } // cancellation is expected
        this.blocked = true;
        this.options.onError(new Error("Playback write failed"));
      },
    );
  }
}
