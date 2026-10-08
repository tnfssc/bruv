/** Experiment only: never imported by the production Live flow. PCM16 mono 16 kHz. */
export class StartupAudioQueue {
  private chunks: Buffer[] = [];
  private phase: "buffering" | "replaying" | "live" | "stopped" = "buffering";
  private bytes = 0;
  /** Bound retained startup audio with maxBytes; send only after the readiness predicate passes. */
  constructor(
    private readonly send: (pcm: Buffer) => void,
    private readonly isReady: () => boolean,
    private readonly maxBytes = 320_000, // ten seconds, fail instead of silently losing words
  ) {}
  /** Bytes retained for replay; drained or stopped audio is excluded. */
  get queuedBytes() {
    return this.bytes;
  }
  /** Copy captured PCM into FIFO, or send directly once replay is complete. */
  push(pcm: Uint8Array): void {
    if (this.phase === "stopped") return;
    if (this.phase === "live") {
      if (this.isReady()) this.send(Buffer.from(pcm));
      else this.stop();
      return;
    }
    // Capture during replay joins the FIFO rather than overtaking startup audio.
    if (this.bytes + pcm.length > this.maxBytes) {
      this.stop();
      throw new Error("Startup probe queue exceeded byte limit");
    }
    this.chunks.push(Buffer.from(pcm)); // capture buffers may be reused
    this.bytes += pcm.length;
  }
  /** Drain FIFO in order only while ready; optional pacing separates sends. */
  async ready(paceMs = 0): Promise<void> {
    if (this.phase !== "buffering" || !this.isReady()) return;
    this.phase = "replaying";
    try {
      while (this.phase === "replaying" && this.chunks.length) {
        if (!this.isReady()) {
          this.stop();
          break;
        }
        const pcm = this.chunks.shift()!;
        this.bytes -= pcm.length;
        this.send(pcm);
        if (paceMs) await Bun.sleep(paceMs);
      }
    } finally {
      // A stop during send or pacing is terminal; replay completion cannot revive it.
      if (this.phase === "replaying") this.phase = "live";
    }
  }
  /** Discard pending startup PCM and ignore subsequent pushes. */
  stop(): void {
    this.phase = "stopped";
    this.chunks = [];
    this.bytes = 0;
  }
}
