import { meter } from "./mic";

type Item = { part: number; audio: AudioBuffer; done: boolean; at: number; source?: AudioBufferSourceNode };

/**
 * Plays the reply as it arrives, in numbered sentences ("parts"), and tells bruv each sentence that has been
 * heard (`played`). Finished audio of the sentence playing is kept, so unmuting starts that sentence again.
 */
export class Player {
  /** Sample rate and sentence of the audio that comes next, as the server says before it. */
  rate = 24000;
  incoming = 0;
  muted = false;
  readonly level: () => number;
  private items: Item[] = [];
  private nextTime = 0;
  private reported = 0;
  private gain: GainNode;
  private later: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private output: AudioContext,
    private report: (part: number) => void,
    private changed: () => void,
  ) {
    this.gain = output.createGain();
    this.gain.connect(output.destination);
    this.level = meter(output, this.gain);
  }

  /** A new connection may be a new call, whose sentences count from 1 again. */
  reconnected() {
    this.reported = 0;
  }

  get playing() {
    return this.items.length > 0;
  }

  play(buffer: ArrayBuffer) {
    const pcm = new Int16Array(buffer);
    const audio = this.output.createBuffer(1, pcm.length, this.rate);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] as number) / 32768;
    const item: Item = { part: this.incoming, audio, done: false, at: 0 };
    this.items.push(item);
    if (!this.muted) this.schedule(item);
    this.changed();
  }

  setMuted(muted: boolean) {
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) this.silence();
    else {
      // Start again from the beginning of the sentence that was playing.
      const first = this.items.find((item) => !item.done);
      this.items = first ? this.items.filter((item) => item.part >= first.part) : [];
      for (const item of this.items) this.schedule(item);
      if (!first) this.tidy();
    }
    this.changed();
  }

  /** The microphone heard something, maybe the reply's own echo: turn it down, not off. */
  duck() {
    this.gain.gain.setTargetAtTime(0.15, this.output.currentTime, 0.03);
  }

  /** Hold playback, after `after` ms if `still` holds then (a press that may yet be a tap). */
  suspend(after: number, still: () => boolean) {
    clearTimeout(this.later);
    if (after > 0) this.later = setTimeout(() => still() && void this.output.suspend(), after);
    else void this.output.suspend();
  }

  resume() {
    clearTimeout(this.later);
    this.gain.gain.setTargetAtTime(1, this.output.currentTime, 0.03);
    void this.output.resume();
  }

  /** Drops all playback. */
  flush() {
    clearTimeout(this.later);
    this.gain.gain.setTargetAtTime(1, this.output.currentTime, 0.03);
    this.silence();
    this.items = [];
    void this.output.resume();
    this.changed();
  }

  private schedule(item: Item) {
    const source = this.output.createBufferSource();
    source.buffer = item.audio;
    source.connect(this.gain);
    this.nextTime = Math.max(this.nextTime, this.output.currentTime + 0.03);
    source.start(this.nextTime);
    item.at = this.nextTime;
    item.done = false;
    item.source = source;
    this.nextTime += item.audio.duration;
    source.onended = () => {
      item.done = true;
      item.source = undefined;
      this.tidy();
    };
  }

  private silence() {
    for (const item of this.items) {
      if (!item.source) continue;
      item.source.onended = null;
      try {
        item.source.stop();
      } catch {}
      item.source = undefined;
    }
    this.nextTime = 0;
  }

  /** Drops what has played, keeping the sentence still playing whole, and says what was heard. */
  private tidy() {
    const first = this.items.find((item) => !item.done);
    if (first) {
      this.items = this.items.filter((item) => !item.done || item.part === first.part);
      this.played(first.part - 1);
    } else {
      this.played(Math.max(0, ...this.items.map((item) => item.part)));
      this.items = [];
    }
    this.changed();
  }

  private played(part: number) {
    if (part <= this.reported) return;
    this.reported = part;
    this.report(part);
  }
}
