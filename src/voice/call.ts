import { fresh, isEcho, Sentences, withoutDirections, withoutEcho } from "./text";

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
  /** Plays a short sound such as "hmm" as sentence `part`, if it has one ready, and returns its words. */
  filler?(part: number): string | undefined;
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
  /**
   * Hold playback: someone may be talking over it. `soft` when only the microphone heard something, which
   * may be the speaker's own echo, so a device can turn it down rather than stop.
   */
  | { type: "pause"; soft?: boolean }
  /** It was a noise or an echo; play on. */
  | { type: "resume" }
  /** Drop all playback. */
  | { type: "flush" }
  | ({ type: "show" } & Shown)
  /** What the agent wrote or did, shown and never spoken. */
  | { type: "note"; kind: "text" | "tool"; text: string }
  | { type: "error"; message: string };

/** Something to look at: a page, a picture or a video. `src` is a link; `html` is a whole page. */
export type Shown = { kind: "html" | "image" | "video"; title?: string; src?: string; html?: string };

/** What a page needs to draw the conversation so far. */
type Entry =
  | { type: "user"; text: string }
  | { type: "note"; kind: "text" | "tool"; text: string }
  | { type: "assistant"; text: string; part: number }
  | ({ type: "show" } & Shown);
/** Entries are numbered, so a page that reconnects gets only what it missed. */
export type Logged = Entry & { seq: number };

export interface Device {
  /** A device with a screen can show things; the local speaker can't. */
  screen?: boolean;
  send(event: DeviceEvent): void;
  /** Sentences are numbered in order, so a device can go back to the start of the one it is playing. */
  play(pcm: Int16Array, rate: number, part: number): void;
}

/** Where heard words go. The brain answers through `Call.reply`. */
export interface Brain {
  /**
   * `interrupted`: the user talked over a reply, so it should stop rather than go on. `cut` is the sentence
   * that was playing then; the user heard the reply up to it and nothing after.
   */
  tell(text: string, interrupted: boolean, cut?: string): void;
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
  /**
   * Sentences given to the speaker and not yet played everywhere, by number. A device reports each sentence
   * it finishes, so this is what is still to be heard.
   */
  private saying = new Map<number, string>();
  /** The last sentences played, to tell the speaker's own echo from the user. */
  private recent: string[] = [];
  /** The sentence playing when the user started talking, if a reply was. */
  private cut?: string;
  /** When the last sentence finished playing. */
  private playedAt = 0;
  /** Whether the user started talking while a reply could be heard, so it may be its echo. */
  private echoable = false;
  /** Set when real words were heard over the reply and it was stopped before the turn ended. */
  private cutIn = false;
  /** Between the brain starting and stopping. */
  private busy = false;
  /** Set while a page's talk button is down. */
  private held = false;
  private state: State = "starting";
  private part = 0;
  private log: Logged[] = [];
  private seq = 0;
  /** Random per call, so a page can tell a new call from the one it was showing. */
  readonly id = Math.random().toString(36).slice(2);
  /**
   * The device whose audio is heard. One at a time: the terminal's microphone and a page's would otherwise
   * mix into one stream and garble both.
   */
  private microphone?: Device;
  /**
   * Devices that play replies aloud: the terminal's speaker, and pages once started. Only they say what was
   * heard; a page that is open but not started hears nothing.
   */
  private players = new Set<Device>();
  /** Recent sentences by number, to tell a long echo from the user. */
  private spoken = new Map<number, string>();
  /** The first sentence that could be heard when the user started talking. */
  private heardFrom = 0;

  /** Set after the user's turn, to play a filler if nothing has been said by then. */
  private waiting: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private engine: Engine,
    private brain: Brain,
    /** How long a silence after the user's turn is left before a filler fills it. */
    private fillerDelay = 800,
  ) {
    engine.onEvent((event) => this.onEngine(event));
  }

  attach(device: Device) {
    this.devices.add(device);
    if (!device.screen) this.players.add(device);
    device.send({ type: "state", state: this.state });
  }

  /** The conversation after `seq`, for a page that opened or came back. Sentences already played are `past`. */
  history(seq = 0) {
    const first = Math.min(...this.saying.keys());
    return this.log
      .filter((entry) => entry.seq > seq)
      .map((entry) => (entry.type === "assistant" && entry.part < first ? { ...entry, past: true } : entry));
  }

  /** Where replies are heard: the terminal's speaker and started pages. */
  hearers() {
    return [...this.players].map((device) => (device.screen ? "voice page" : "terminal"));
  }

  /** What was said lately, to leave out written text that only repeats it. */
  lately() {
    return [...this.spoken.values()].slice(-6).join(" ");
  }

  /** Something the agent did or wrote, for pages to show; it is never spoken. */
  note(kind: "text" | "tool", text: string) {
    this.broadcast(this.remember({ type: "note", kind, text }));
  }

  /** Where the user is: the device holding the microphone, and how many screens are open. */
  where() {
    const screens = [...this.devices].filter((device) => device.screen).length;
    const local = [...this.devices].some((device) => !device.screen);
    const mic = this.microphone ? (this.microphone.screen ? "page" : "local") : local ? "local" : undefined;
    return { screens, local, mic } as const;
  }

  detach(device: Device) {
    this.devices.delete(device);
    if (this.microphone === device) this.microphone = undefined;
    // With no one left to play it, what was waiting to be heard never will be.
    if (this.players.delete(device) && !this.players.size) this.played(this.part);
  }

  /** A page takes the microphone when it starts or its button is pressed. */
  claim(device: Device) {
    this.microphone = device;
    this.players.add(device);
  }

  /** Audio from a device. With no microphone, the first device heard takes it, so the terminal gets it back. */
  hear(pcm: Int16Array, from: Device) {
    this.microphone ??= from;
    if (from === this.microphone) this.engine.hear(pcm);
  }

  talk(on: boolean, keep = false) {
    this.held = on;
    this.engine.talk(on, keep);
  }

  /** Puts something on every screen. Returns how many screens got it. */
  show(item: Shown) {
    const screens = [...this.devices].filter((device) => device.screen);
    const entry = this.remember({ type: "show", ...item });
    for (const device of screens) device.send(entry);
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

  /** The reply is over. `flush` says what is left of a sentence; a reply stopped early drops it. */
  replyEnd(flush = true) {
    this.replying = false;
    const rest = this.sentences.flush();
    if (flush && !this.muted) for (const sentence of rest) this.say(sentence);
  }

  /** The brain is working on something it will answer. */
  thinking() {
    this.busy = true;
    if (this.state === "listening") this.setState("thinking");
  }

  /** The brain has stopped; with nothing left to say, listen. */
  idle() {
    this.busy = false;
    if (this.state === "thinking" && !this.saying.size) this.setState("listening");
  }

  /** Drops whatever is being said. */
  hush() {
    clearTimeout(this.waiting);
    this.muted = true;
    this.saying.clear();
    this.engine.hush();
    this.broadcast({ type: "flush" });
    this.settle();
  }

  /** The brain failed, so nothing will be said: shown on every page, and said in a few words. */
  fail(message: string) {
    this.broadcast({ type: "error", message });
    this.say("Sorry, that failed. The error is on the screen.");
  }

  /** A device has played every sentence up to `part`. Only devices that play count. */
  played(part: number, from?: Device) {
    if (from && !this.players.has(from)) return;
    for (const [number, sentence] of this.saying) {
      if (number > part) continue;
      this.saying.delete(number);
      this.recent = [...this.recent, sentence].slice(-2);
      this.playedAt = Date.now();
    }
    if (!this.saying.size && this.state === "speaking") this.settle();
  }

  async close() {
    clearTimeout(this.waiting);
    this.devices.clear();
    await this.engine.close();
  }

  /** The engine gets the sentence with its mood directions to act; everything else, the words heard. */
  private say(sentence: string) {
    const words = withoutDirections(sentence);
    if (!words) return;
    clearTimeout(this.waiting);
    const part = ++this.part;
    this.saying.set(part, words);
    this.spoken.set(part, words);
    this.spoken.delete(part - 100);
    this.engine.speak(sentence, part);
    this.broadcast(this.remember({ type: "assistant", text: words, part }));
  }

  /** The agent hasn't started its answer yet: a "hmm" says the user was heard. It isn't shown. */
  private fill() {
    this.waiting = undefined;
    if (this.state !== "thinking" || this.saying.size || !this.engine.filler) return;
    const words = this.engine.filler(this.part + 1);
    if (!words) return;
    this.part++;
    this.saying.set(this.part, words);
    this.spoken.set(this.part, words);
  }

  private remember(event: Entry) {
    const entry: Logged = { ...event, seq: ++this.seq };
    this.log.push(entry);
    if (this.log.length > 400) this.log.shift();
    return entry;
  }

  /** What could be heard since the user started talking, to tell their words from the echo. */
  private heardSince() {
    const since = [...this.spoken].flatMap(([part, sentence]) => (part >= this.heardFrom ? [sentence] : []));
    return [...this.recent, ...since].join(" ");
  }

  /** Nothing left to say: thinking while the brain works, otherwise listening. */
  private settle() {
    this.setState(this.busy || this.replying ? "thinking" : "listening");
  }

  private onEngine(event: EngineEvent) {
    switch (event.type) {
      case "ready":
        this.setState("listening");
        return;
      case "speech":
        // They're still talking: no filler over them.
        clearTimeout(this.waiting);
        // The sentence playing now. With nothing playing, nothing was cut: an earlier reply was heard whole.
        // Echo of the last words reaches the microphone as they end, so a reply just finished counts too.
        this.echoable = this.saying.size > 0 || Date.now() - this.playedAt < 1500;
        // Echo can keep the microphone hearing through a whole reply, so it is checked against all of it.
        this.heardFrom = this.saying.size ? Math.min(...this.saying.keys()) - 1 : this.part;
        this.cut = this.saying.size ? this.saying.values().next().value : undefined;
        this.broadcast({ type: "pause", soft: !this.held });
        this.setState("hearing");
        return;
      case "partial": {
        this.broadcast(event);
        // Without echo cancelling the microphone hears the reply too, so the turn only ends with it. Real
        // words in it stop the reply now instead.
        if (this.cutIn || this.held || !this.saying.size || fresh(event.text, this.heardSince()) < 3) return;
        this.cutIn = true;
        this.cut = this.saying.values().next().value;
        this.hush();
        this.setState("hearing");
        return;
      }
      case "heard": {
        const spoken = this.heardSince();
        const text = event.held ? event.text.trim() : withoutEcho(event.text, spoken);
        const cutIn = this.cutIn;
        this.cutIn = false;
        // What trimming the echo leaves can be a stray syllable of it, such as "a".
        const scrap = text !== event.text.trim() && !fresh(text, spoken) && text.split(/\s+/).length < 2;
        const echo = !event.held && !cutIn && this.echoable && (scrap || isEcho(text, spoken));
        if (!text || echo) {
          this.broadcast({ type: "resume" });
          if (this.saying.size) this.setState("speaking");
          else this.settle();
          return;
        }
        // Every pause ends in a flush or a resume.
        const interrupted = cutIn || this.saying.size > 0 || this.replying;
        if (interrupted) this.hush();
        else this.broadcast({ type: "resume" });
        this.broadcast(this.remember({ type: "user", text }));
        this.setState("thinking");
        this.brain.tell(text, interrupted, interrupted ? this.cut : undefined);
        clearTimeout(this.waiting);
        this.waiting = setTimeout(() => this.fill(), this.fillerDelay);
        return;
      }
      case "audio":
        for (const device of this.devices) device.play(event.pcm, event.rate, event.part);
        // Nothing plays it, so it counts as heard at once.
        if (!this.players.size) this.played(event.part);
        else if (this.state !== "hearing") this.setState("speaking");
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
