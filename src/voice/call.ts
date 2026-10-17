import { isEcho, Sentences } from "./text";

/** What the speech engine reports. `speech` means someone started talking. */
export type EngineEvent =
  | { type: "ready" }
  | { type: "speech" }
  | { type: "partial"; text: string }
  /** `held`: the user held the talk button, so this is theirs and never the speaker's echo. */
  | { type: "heard"; text: string; held?: boolean }
  /** `part` is the sentence the audio belongs to, as given to `speak`. */
  | { type: "audio"; pcm: Int16Array; rate: number; part: number }
  | { type: "error"; message: string };

/** Speech to text and text to speech. Audio in is 16 kHz mono; audio out is mono at `rate`. */
export interface Engine {
  hear(pcm: Int16Array): void;
  speak(text: string, part: number): void;
  /**
   * Hold to talk: `true` starts the user's turn, `false` ends it now, without waiting for silence.
   * `false` with `keep` lets silence end it instead, for a tap that turns on hands-free.
   */
  talk(on: boolean, keep?: boolean): void;
  /** Drops the speech being made and all speech waiting to be made. */
  hush(): void;
  onEvent(listener: (event: EngineEvent) => void): void;
  close(): Promise<void>;
}

export type State = "starting" | "listening" | "hearing" | "thinking" | "speaking";

/** What a device (a browser tab or the local speaker) is told. */
export type DeviceEvent =
  | { type: "state"; state: State }
  | { type: "partial"; text: string }
  | { type: "user"; text: string }
  | { type: "assistant"; text: string; part: number }
  /** Hold playback: someone may be talking over it. */
  | { type: "pause" }
  /** It was a noise or an echo; play on. */
  | { type: "resume" }
  /** Drop all playback. */
  | { type: "flush" }
  | ({ type: "show" } & Shown)
  | { type: "error"; message: string };

/** Something to look at: a page, a picture or a video. `src` is a link; `html` is a whole page. */
export type Shown = { kind: "html" | "image" | "video"; title?: string; src?: string; html?: string };

export interface Device {
  /** A device with a screen can show things; the local speaker can't. */
  screen?: boolean;
  send(event: DeviceEvent): void;
  /** Sentences are numbered in order, so a device can go back to the start of the one it is playing. */
  play(pcm: Int16Array, rate: number, part: number): void;
}

/** Where heard words go. The brain answers through `Call.reply`. */
export interface Brain {
  /** `interrupted`: the user talked over a reply, so it should stop rather than go on. */
  tell(text: string, interrupted: boolean): void;
}

/**
 * One voice conversation: the engine hears, the brain answers, devices play the answer.
 * Talking over the answer pauses it at once; real words then drop it and go to the brain.
 */
export class Call {
  private devices = new Set<Device>();
  private sentences = new Sentences();
  /** Set when the user talked over a reply, so the rest of that reply is not spoken. */
  private muted = false;
  private replying = false;
  /** What is being said or waiting to be said, to tell the speaker's own echo from the user. */
  private saying: string[] = [];
  private state: State = "starting";
  private part = 0;

  constructor(
    private engine: Engine,
    private brain: Brain,
  ) {
    engine.onEvent((event) => this.onEngine(event));
  }

  attach(device: Device) {
    this.devices.add(device);
    device.send({ type: "state", state: this.state });
  }

  detach(device: Device) {
    this.devices.delete(device);
  }

  hear(pcm: Int16Array) {
    this.engine.hear(pcm);
  }

  talk(on: boolean, keep = false) {
    this.engine.talk(on, keep);
  }

  /** Puts something on every screen. Returns how many screens got it. */
  show(item: Shown) {
    const screens = [...this.devices].filter((device) => device.screen);
    for (const device of screens) device.send({ type: "show", ...item });
    return screens.length;
  }

  /** A new reply starts. */
  replyStart() {
    this.muted = false;
    this.replying = true;
    this.sentences = new Sentences();
  }

  /** Streamed reply text. */
  reply(delta: string) {
    if (this.muted) return;
    for (const sentence of this.sentences.push(delta)) this.say(sentence);
  }

  replyEnd() {
    this.replying = false;
    if (!this.muted) for (const sentence of this.sentences.flush()) this.say(sentence);
  }

  /** The brain is working on something it will answer. */
  thinking() {
    if (this.state === "listening") this.setState("thinking");
  }

  /** The brain has stopped; with nothing left to say, listen. */
  idle() {
    if (this.state === "thinking" && !this.saying.length) this.setState("listening");
  }

  /** Drops whatever is being said. */
  hush() {
    this.muted = true;
    this.saying = [];
    this.engine.hush();
    this.broadcast({ type: "flush" });
    this.setState("listening");
  }

  /** A device has played everything it was sent. */
  played() {
    this.saying = [];
    if (this.state === "speaking") this.setState("listening");
  }

  async close() {
    this.devices.clear();
    await this.engine.close();
  }

  private say(sentence: string) {
    const part = ++this.part;
    this.saying.push(sentence);
    this.engine.speak(sentence, part);
    this.broadcast({ type: "assistant", text: sentence, part });
  }

  private onEngine(event: EngineEvent) {
    switch (event.type) {
      case "ready":
        this.setState("listening");
        return;
      case "speech":
        this.broadcast({ type: "pause" });
        this.setState("hearing");
        return;
      case "partial":
        this.broadcast(event);
        return;
      case "heard": {
        const text = event.text.trim();
        const echo = !event.held && this.saying.length > 0 && isEcho(text, this.saying.join(" "));
        if (!text || echo) {
          this.broadcast({ type: "resume" });
          this.setState(this.saying.length ? "speaking" : "listening");
          return;
        }
        // Every pause ends in a flush or a resume.
        const interrupted = this.saying.length > 0 || this.replying;
        if (interrupted) this.hush();
        else this.broadcast({ type: "resume" });
        this.broadcast({ type: "user", text });
        this.setState("thinking");
        this.brain.tell(text, interrupted);
        return;
      }
      case "audio":
        if (this.state !== "hearing") this.setState("speaking");
        for (const device of this.devices) device.play(event.pcm, event.rate, event.part);
        return;
      case "error":
        this.broadcast(event);
        return;
    }
  }

  private setState(state: State) {
    if (state === this.state) return;
    this.state = state;
    this.broadcast({ type: "state", state });
  }

  private broadcast(event: DeviceEvent) {
    for (const device of this.devices) device.send(event);
  }
}
