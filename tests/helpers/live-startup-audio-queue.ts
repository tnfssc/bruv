/** Experiment only: never imported by the production Live flow. PCM16 mono 16 kHz. */
export class StartupAudioQueue {
  private chunks: Buffer[] = [];
  private stopped = false;
  private active = false;
  private draining = false;
  private bytes = 0;
  constructor(
    private readonly send: (pcm: Buffer) => void,
    private readonly isReady: () => boolean,
    private readonly maxBytes = 320_000, // ten seconds, fail instead of silently losing words
  ) {}
  get queuedBytes() {
    return this.bytes;
  }
  push(pcm: Uint8Array): void {
    if (this.stopped) return;
    if (this.active && !this.draining) {
      if (this.isReady()) this.send(Buffer.from(pcm));
      else this.stop();
      return;
    }
    if (this.bytes + pcm.length > this.maxBytes) {
      this.stop();
      throw new Error("Startup probe queue exceeded byte limit");
    }
    this.chunks.push(Buffer.from(pcm)); // capture buffers may be reused
    this.bytes += pcm.length;
  }
  async ready(paceMs = 0): Promise<void> {
    if (this.stopped || this.active || !this.isReady()) return;
    this.active = true;
    this.draining = true;
    try {
      while (!this.stopped && this.chunks.length) {
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
      this.draining = false;
    }
  }
  stop(): void {
    this.stopped = true;
    this.chunks = [];
    this.bytes = 0;
  }
}
