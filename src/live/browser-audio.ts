import type { AudioCallbacks, AudioDiagnostics } from "./audio";
import { AUDIO_MAX_BUFFER, audioEpoch, parseAudio, type AudioEvent } from "./browser-protocol";

export function browserAudioEnvironment(
  env: Record<string, string | undefined> = process.env,
): { url: string; secret: string } | undefined {
  const url = env.BRUV_LIVE_RELAY_URL;
  const secret = env.BRUV_LIVE_RELAY_SECRET;
  if (!url && !secret) return;
  if (!url || !secret || !/^[a-f0-9]{64}$/.test(secret))
    throw new Error("Browser Live relay environment is incomplete");
  const parsed = new URL(url);
  if (
    !["ws:", "wss:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.searchParams.get("role") !== "cli" ||
    !parsed.searchParams.get("session")
  )
    throw new Error("Invalid browser Live relay URL");
  // Remote plaintext audio/secret transmission is not an opt-in default.
  if (parsed.protocol === "ws:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
    throw new Error("Browser Live relay requires TLS outside loopback");
  return { url, secret };
}

/** Same PCM contract as LiveAudio: 16k mono capture, 24k mono playback. */
export class BrowserLiveAudio {
  readonly diagnostics: AudioDiagnostics = { queuedMs: 0, captureFrames: 0, capturedBytes: 0 };
  private state: "idle" | "running" | "closed" = "idle";
  private generation = 0;
  private gated = false;
  private gate: number | null = null;
  private lastGate = -1;
  private intentional = false;
  private waiters = new Map<
    string,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private constructor(
    private ws: WebSocket,
    private callbacks: AudioCallbacks,
  ) {}
  static async launch(options: {
    url: string;
    secret: string;
    callbacks?: AudioCallbacks;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<BrowserLiveAudio> {
    if (options.signal?.aborted) throw new Error("Browser audio launch cancelled");
    const ws = new WebSocket(options.url);
    const audio = new BrowserLiveAudio(ws, options.callbacks ?? {});
    const hello = audio.wait("hello", options.timeoutMs ?? 30_000);
    const abort = () => audio.fail();
    options.signal?.addEventListener("abort", abort, { once: true });
    ws.onopen = () => audio.send({ type: "hello", secret: options.secret });
    ws.onmessage = (event) => audio.receive(event.data);
    ws.onerror = () => audio.fail();
    ws.onclose = () => audio.shutdown(!audio.intentional);
    try {
      await hello;
      return audio;
    } catch (error) {
      audio.close();
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }
  private wait(type: string, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(type);
        reject(new Error("Browser audio acknowledgement timed out"));
        this.fail();
      }, ms);
      this.waiters.set(type, { resolve, reject, timer });
    });
  }
  private ack(type: string) {
    const w = this.waiters.get(type);
    if (w) {
      clearTimeout(w.timer);
      this.waiters.delete(type);
      w.resolve();
    }
  }
  private send(value: unknown) {
    const text = JSON.stringify(value);
    if (
      this.state === "closed" ||
      this.ws.readyState !== WebSocket.OPEN ||
      this.ws.bufferedAmount + text.length > AUDIO_MAX_BUFFER
    ) {
      this.fail();
      return false;
    }
    try {
      this.ws.send(text);
      return true;
    } catch {
      this.fail();
      return false;
    }
  }
  private receive(text: unknown) {
    if (typeof text !== "string") return this.fail();
    if (text === '{"type":"hello"}') {
      this.ack("hello");
      return;
    }
    const m = parseAudio(text, "browser") as AudioEvent | undefined;
    if (!m) return this.fail();
    if (m.type === "ready" || m.type === "stopped") this.ack(m.type);
    if (m.type === "error") this.fail();
    if (
      m.type === "capture" &&
      this.state === "running" &&
      (!this.gated || (this.gate !== null && m.epoch === this.gate))
    ) {
      const pcm = Buffer.from(m.data, "base64");
      this.diagnostics.captureFrames++;
      this.diagnostics.capturedBytes += pcm.length;
      this.callbacks.capture?.(pcm, m.epoch);
    }
    if (m.type === "played" && this.state === "running") {
      this.diagnostics.queuedMs = m.queuedMs;
      this.callbacks.played?.(m.queuedMs);
    }
  }
  async start(): Promise<void> {
    if (this.state !== "idle") throw new Error("Browser audio not idle");
    const ready = this.wait("ready", 30_000);
    this.state = "running";
    this.send({ type: "start" });
    await ready;
  }
  async setCaptureGate(epoch: number | null): Promise<void> {
    if (epoch !== null && (!audioEpoch(epoch) || epoch <= this.lastGate))
      throw new Error("Capture epoch must increase");
    if (epoch !== null) this.lastGate = epoch;
    this.gated = true;
    this.gate = epoch;
    if (!this.send({ type: "capture_gate", epoch })) throw new Error("Browser audio transport unavailable");
  }
  async play(pcm: Buffer, generation: number): Promise<void> {
    if (
      this.state !== "running" ||
      !audioEpoch(generation) ||
      generation !== this.generation ||
      !pcm.length ||
      pcm.length > 9600 ||
      pcm.length % 2
    )
      throw new Error("Invalid browser playback frame");
    if (!this.send({ type: "play", data: pcm.toString("base64"), generation }))
      throw new Error("Browser audio transport unavailable");
  }
  async flush(generation: number): Promise<void> {
    if (this.state !== "running" || !audioEpoch(generation) || generation <= this.generation)
      throw new Error("Playback epoch must increase");
    this.generation = generation;
    if (!this.send({ type: "flush", generation })) throw new Error("Browser audio transport unavailable");
  }
  async stop(): Promise<void> {
    if (this.state === "closed") return;
    this.intentional = true;
    const stopped = this.wait("stopped", 2000);
    try {
      this.send({ type: "stop" });
      await stopped;
    } finally {
      this.close();
    }
  }
  close() {
    this.intentional = true;
    this.shutdown(false);
  }
  private fail() {
    this.shutdown(true);
  }
  private shutdown(error: boolean) {
    if (this.state === "closed") return;
    this.state = "closed";
    for (const w of this.waiters.values()) {
      clearTimeout(w.timer);
      w.reject(new Error("Browser audio disconnected"));
    }
    this.waiters.clear();
    this.ws.close();
    if (error) this.callbacks.error?.("browser_disconnected", "Browser microphone/speaker disconnected");
    this.callbacks.closed?.();
  }
}
