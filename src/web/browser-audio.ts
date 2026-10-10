import { AUDIO_MAX_BUFFER, parseAudio, type AudioCommand } from "../live/browser-protocol";

/** Runs on the audio rendering thread; epochs tag acquisition, not later socket delivery. */
export const CAPTURE_WORKLET = `
class BruvCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.active = false; this.gated = false; this.epoch = null;
    this.phase = 0; this.sum = 0; this.count = 0; this.samples = [];
    this.port.onmessage = ({data}) => {
      if (data.type === 'start') this.active = true;
      if (data.type === 'gate') { this.gated = true; this.epoch = data.epoch; }
      this.samples = []; this.phase = 0; this.sum = 0; this.count = 0;
    };
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!this.active || (this.gated && this.epoch === null) || !samples) return true;
    for (const sample of samples) {
      this.sum += sample; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        const v = Math.max(-1, Math.min(1, this.sum / this.count));
        this.samples.push(Math.round(v < 0 ? v * 32768 : v * 32767));
        this.phase -= sampleRate; this.sum = 0; this.count = 0;
        if (this.samples.length === 320) {
          const bytes = new ArrayBuffer(640); const view = new DataView(bytes);
          this.samples.forEach((s, i) => view.setInt16(i * 2, s, true));
          this.port.postMessage({bytes, epoch: this.gated ? this.epoch : undefined}, [bytes]);
          this.samples = [];
        }
      }
    }
    return true;
  }
}
registerProcessor('bruv-capture', BruvCapture);
`;
export interface BrowserAudioOptions {
  /** Authenticated same-origin endpoint, role=browser, exact server-issued session ID. No secret. */
  url: string;
  /** Server token and private attachment capability stay in WebSocket protocols. */
  token: string;
  signal?: AbortSignal;
  owner: string;
  onState?: (state: "connecting" | "enabled" | "running" | "closed" | "error") => void;
}
/** Called only by an owning CLI request. Selection never moves this device. */
export async function connectBrowserAudio(options: BrowserAudioOptions): Promise<{ close(): Promise<void> }> {
  const url = new URL(options.url, location.href);
  const expectedProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  if (
    url.protocol !== expectedProtocol ||
    url.host !== location.host ||
    url.searchParams.get("role") !== "browser" ||
    !url.searchParams.get("session")
  )
    throw new Error("Invalid session audio endpoint");
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error("Microphone needs HTTPS or localhost. Reopen Bruv securely, then type /live to retry.");
  if (options.signal?.aborted) throw new Error("Voice request cancelled.");
  options.onState?.("connecting");
  // Keyboard submission activates Chromium audio; permission still belongs to the browser.
  const context = new AudioContext({ latencyHint: "interactive" });
  const resumed = context.resume();
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let capture: AudioWorkletNode | undefined;
  let ws: WebSocket | undefined;
  let closed = false;
  let releasePromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let active = false;
  let connected = false;
  let generation = 0;
  let gate: number | null | undefined;
  let nextTime = 0;
  let reportTimer: ReturnType<typeof setInterval> | undefined;
  const playing = new Set<AudioBufferSourceNode>();
  function send(value: unknown) {
    const text = JSON.stringify(value);
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount + text.length > AUDIO_MAX_BUFFER) {
      void fail();
      return;
    }
    ws.send(text);
  }
  function report() {
    send({ type: "played", queuedMs: Math.max(0, Math.round((nextTime - context.currentTime) * 1000)) });
  }
  function flush() {
    for (const node of playing) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    playing.clear();
    nextTime = context.currentTime;
    clearInterval(reportTimer);
    reportTimer = undefined;
  }
  function release(): Promise<void> {
    if (releasePromise) return releasePromise;
    closed = true;
    active = false;
    flush();
    capture?.disconnect();
    source?.disconnect();
    if (capture) capture.port.onmessage = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    options.signal?.removeEventListener("abort", abort);
    releasePromise = context.close();
    return releasePromise;
  }
  function close(): Promise<void> {
    closePromise ??= release().finally(() => {
      ws?.close();
      options.onState?.("closed");
    });
    return closePromise;
  }
  async function fail() {
    options.onState?.("error");
    if (ws?.readyState === WebSocket.OPEN) ws.send('{"type":"error"}');
    await close().catch(() => {});
  }
  const abort = () => {
    void close().catch(() => {});
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await resumed;
    if (closed) throw new Error("Voice request cancelled.");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (closed) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error("Voice request cancelled.");
    }
    for (const track of stream.getTracks())
      track.onended = () => {
        void fail();
      };
    await context.audioWorklet.addModule("/audio-worklet.js");
    if (closed) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error("Voice request cancelled.");
    }
    source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, "bruv-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    capture = worklet;
    source.connect(capture);
    capture.connect(context.destination); // Worklet output is silence.
    capture.port.onmessage = ({ data }) => {
      if (!active || closed || (gate !== undefined && (gate === null || data.epoch !== gate))) return;
      const bytes = new Uint8Array(data.bytes);
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      send({ type: "capture", data: btoa(text), ...(data.epoch === undefined ? {} : { epoch: data.epoch }) });
    };
    const socket = new WebSocket(url, ["bruv-audio", "bruv-token." + options.token, "bruv-owner." + options.owner]);
    ws = socket;
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Browser audio connection timed out")), 10_000);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Browser audio connection failed"));
      };
      socket.onclose = () => {
        clearTimeout(timer);
        reject(new Error("Browser audio disconnected"));
        if (connected) void close().catch(() => {});
      };
    });
    ws.onmessage = ({ data }) => {
      const m = typeof data === "string" ? (parseAudio(data, "cli") as AudioCommand | undefined) : undefined;
      if (!m || closed) {
        void fail();
        return;
      }
      if (m.type === "capture_gate") {
        gate = m.epoch;
        worklet.port.postMessage({ type: "gate", epoch: gate });
      }
      if (m.type === "start") {
        active = true;
        worklet.port.postMessage({ type: "start" });
        send({ type: "ready" });
        options.onState?.("running");
      }
      if (m.type === "stop") {
        void release()
          .then(() => {
            send({ type: "stopped" });
            return close();
          })
          .catch(() => {
            void fail();
          });
      }
      if (m.type === "flush") {
        if (m.generation <= generation) {
          void fail();
          return;
        }
        generation = m.generation;
        flush();
        report();
      }
      if (m.type === "play") {
        if (!active || m.generation !== generation) {
          void fail();
          return;
        }
        const text = atob(m.data);
        const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
        const view = new DataView(bytes.buffer);
        const buffer = context.createBuffer(1, bytes.length / 2, 24000);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        nextTime = Math.max(nextTime, context.currentTime + 0.01);
        if (nextTime + buffer.duration - context.currentTime > 1) {
          void fail();
          return;
        }
        const node = context.createBufferSource();
        node.buffer = buffer;
        node.connect(context.destination);
        playing.add(node);
        node.onended = () => {
          playing.delete(node);
          node.disconnect();
          if (!playing.size) {
            clearInterval(reportTimer);
            reportTimer = undefined;
          }
          if (!closed) report();
        };
        node.start(nextTime);
        nextTime += buffer.duration;
        report();
        reportTimer ??= setInterval(report, 50);
      }
    };
    await opened;
    if (closed) throw new Error("Voice request cancelled.");
    connected = true;
    options.onState?.("enabled");
    return { close };
  } catch (error) {
    await release();
    ws?.close();
    if (error instanceof DOMException && error.name === "NotAllowedError")
      throw new Error("Microphone permission denied. Allow it in browser site settings, then type /live to retry.");
    if (options.signal?.aborted) throw new Error("Voice request cancelled.");
    throw new Error("Browser audio could not start. Check microphone access and connection, then type /live to retry.");
  }
}
