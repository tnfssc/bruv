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
  /** Terminal capability sent in WS protocols, never in a request URL. */
  token?: string;
  owner?: string;
  onState?: (state: "connecting" | "enabled" | "running" | "closed" | "error") => void;
}
/** Call directly from a click. Does not follow terminal selection; create one instance per session. */
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
  options.onState?.("connecting");
  // Resume in the activation stack, before permission/network awaits.
  const context = new AudioContext({ latencyHint: "interactive" });
  const resumed = context.resume();
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let capture: AudioWorkletNode | undefined;
  let ws: WebSocket | undefined;
  let closed = false;
  let active = false;
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
  async function release() {
    if (closed) return;
    closed = true;
    active = false;
    flush();
    capture?.disconnect();
    source?.disconnect();
    if (capture) capture.port.onmessage = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    await context.close();
  }
  async function close() {
    try {
      await release();
    } finally {
      ws?.close();
      options.onState?.("closed");
    }
  }
  async function fail() {
    try {
      if (ws?.readyState === WebSocket.OPEN) ws.send('{"type":"error"}');
      await close();
    } finally {
      options.onState?.("error");
    }
  }
  try {
    await resumed;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    for (const track of stream.getTracks())
      track.onended = () => {
        void fail();
      };
    await context.audioWorklet.addModule("/audio-worklet.js");
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
    const socket = options.token
      ? new WebSocket(url, [
          "bruv-audio",
          "bruv-token." + options.token,
          ...(options.owner ? ["bruv-owner." + options.owner] : []),
        ])
      : new WebSocket(url);
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
        void fail();
      };
      socket.onclose = () => {
        clearTimeout(timer);
        reject(new Error("Browser audio disconnected"));
        void close();
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
            ws?.close();
            options.onState?.("closed");
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
    options.onState?.("enabled");
    return { close };
  } catch {
    await fail();
    throw new Error("Browser audio could not start; check microphone permission and connection");
  }
}
