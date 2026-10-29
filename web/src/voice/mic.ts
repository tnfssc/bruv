/** Turns microphone audio into 16 kHz 16-bit frames of 20 ms, averaging the samples it drops. */
const worklet = `registerProcessor("mic", class extends AudioWorkletProcessor {
  constructor() { super(); this.step = sampleRate / 16000; this.at = 0; this.sum = 0; this.count = 0; this.out = new Int16Array(320); this.n = 0; }
  process([input]) {
    const samples = input[0]; if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      this.sum += samples[i]; this.count++; this.at++;
      if (this.at < this.step) continue;
      this.at -= this.step;
      this.out[this.n++] = Math.max(-1, Math.min(1, this.sum / this.count)) * 32767;
      this.sum = 0; this.count = 0;
      if (this.n === this.out.length) { this.port.postMessage(this.out.slice().buffer, []); this.n = 0; }
    }
    return true;
  }
});`;

/** How loud a node is now, from 0, for the level shown on the talk button. */
export function meter(context: AudioContext, node: AudioNode) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  node.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const x of data) sum += x * x;
    return Math.sqrt(sum / data.length);
  };
}

/**
 * Opens the microphone into `context` and hands each 20 ms frame to `frame`. Echo cancelling is off unless
 * the user turned it on: on a phone it switches sound to the call volume (see live-mode.md), and bruv tells
 * its own voice from the user's without it.
 */
export async function openMic(context: AudioContext, frame: (pcm: ArrayBuffer) => void) {
  const echo = localStorage.getItem("bruv-voice-echo") === "1";
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: echo, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const url = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }));
  await context.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(context, "mic");
  node.port.onmessage = (message) => frame(message.data as ArrayBuffer);
  const source = context.createMediaStreamSource(stream);
  source.connect(node);
  void context.resume();
  return {
    level: meter(context, source),
    close: () => {
      for (const track of stream.getTracks()) track.stop();
      node.port.onmessage = null;
      source.disconnect();
    },
  };
}
