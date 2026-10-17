import { isEcho, Sentences } from "./text";

/** What the speech engine reports. `speech` means someone started talking. */
export type EngineEvent =
  | { type: "ready" }
  | { type: "speech" }
  | { type: "partial"; text: string }
  | { type: "heard"; text: string }
  | { type: "audio"; pcm: Int16Array; rate: number }
  | { type: "error"; message: string };

/** Speech to text and text to speech. Audio in is 16 kHz mono; audio out is mono at `rate`. */
export interface Engine {
  hear(pcm: Int16Array): void;
  speak(text: string): void;
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
  | { type: "assistant"; text: string }
  /** Hold playback: someone may be talking over it. */
  | { type: "pause" }
  /** It was a noise or an echo; play on. */
  | { type: "resume" }
  /** Drop all playback. */
  | { type: "flush" }
  | { type: "error"; message: string };

export interface Device {
  send(event: DeviceEvent): void;
  play(pcm: Int16Array, rate: number): void;
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
    this.saying.push(sentence);
    this.engine.speak(sentence);
    this.broadcast({ type: "assistant", text: sentence });
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
        const echo = this.saying.length > 0 && isEcho(text, this.saying.join(" "));
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
        for (const device of this.devices) device.play(event.pcm, event.rate);
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
