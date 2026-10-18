import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Level, speakOnce, voiceId } from "./cloud";
import { type Example, type Kind, Kinds } from "./kind";

/**
 * Short sounds played while the agent starts its answer. Between the user's last word and the agent's first
 * there are a few seconds of silence, which feel like not being heard; a "hmm" fills them the way a person
 * would. They are made once in the agent's voice and kept, so they cost nothing after and play at once.
 *
 * Which one fits depends on what was said: "let me think" to "how are you doing" is worse than silence, so
 * a small classifier picks the kind (see kind.ts), and a turn it can't place gets no sound. A model on
 * OpenRouter picked well but took a second or more, landing on the answer. News, good or bad, gets a sound
 * that fits either.
 */
export const fillerLines: Record<Kind, string[]> = {
  greeting: ["Oh, hey!", "Hey!", "Heh, hey."],
  question: ["Hmm.", "Hmm, let me see.", "Let me think."],
  request: ["Okay.", "Sure.", "Got it.", "Yep, on it."],
  news: ["Oh!", "Whoa.", "Oh, wow."],
};

/** The labelled turns the classifier learns from, one `label<tab>text` a line. */
export function examples(): Example[] {
  return readFileSync(new URL("./turns.tsv", import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [label, text] = line.split("\t");
      return { label, text };
    });
}

export type Sound = { kind: Kind; text: string; pcm: Int16Array; rate: number };

/** The sound without the silence around it, but for a breath at each end. */
export function trim(pcm: Int16Array, rate: number) {
  const frame = Math.round(rate / 100);
  const loud = (at: number) => {
    let sum = 0;
    for (let i = at; i < Math.min(at + frame, pcm.length); i++) sum += pcm[i] * pcm[i];
    return Math.sqrt(sum / frame) > 184; // -45 dBFS
  };
  let start = 0;
  while (start < pcm.length && !loud(start)) start += frame;
  let end = pcm.length;
  while (end > start && !loud(end - frame)) end -= frame;
  const pad = Math.round(rate * 0.05);
  return pcm.slice(Math.max(0, start - pad), Math.min(pcm.length, end + pad));
}

export class Fillers {
  private sounds: Sound[] = [];
  private last: Sound | undefined;
  private kinds: Kinds | undefined;

  /** Loads the kept sounds from `dir`, making the missing ones in the background. */
  constructor(
    private dir: string,
    private model: string,
    private key: () => Promise<string | undefined>,
    private fetch = globalThis.fetch,
    private speed = 1,
  ) {
    this.ready = this.load().catch(() => {});
  }

  /** Done loading or making them; some may be missing if making them failed. */
  ready: Promise<void>;

  private async load() {
    // Learning takes a few hundred ms, so it waits for the command that started voice to finish.
    await new Promise((resolve) => setImmediate(resolve));
    this.kinds = new Kinds(examples());
    const id = voiceId(this.model, this.speed);
    const lines = (Object.entries(fillerLines) as [Kind, string[]][]).flatMap(([kind, texts]) =>
      texts.map((text) => ({
        kind,
        text,
        file: `${id}-${createHash("sha256").update(text).digest("hex").slice(0, 8)}.pcm`,
      })),
    );
    // Sounds from other voices or older lines aren't played again.
    const keep = new Set(lines.map(({ file }) => file));
    if (existsSync(this.dir))
      for (const name of readdirSync(this.dir)) if (!keep.has(name)) rmSync(join(this.dir, name), { force: true });
    for (const { kind, text, file: name } of lines) {
      const file = join(this.dir, name);
      if (existsSync(file)) {
        const bytes = readFileSync(file);
        this.sounds.push({ kind, text, pcm: new Int16Array(new Uint8Array(bytes).buffer), rate: 44_100 });
        continue;
      }
      const key = await this.key();
      if (!key) return;
      const made = await speakOnce(this.model, key, text, this.speed, this.fetch);
      const level = new Level(made.rate);
      const levelled = [...level.push(trim(made.pcm, made.rate)), ...level.end()];
      const pcm = new Int16Array(levelled.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of levelled) {
        pcm.set(part, at);
        at += part.length;
      }
      // Kept at 44.1 kHz, the rate Drama 3 sends; another rate would need its own name.
      if (made.rate !== 44_100) return;
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(`${file}.partial`, Buffer.from(pcm.buffer));
      renameSync(`${file}.partial`, file);
      this.sounds.push({ kind, text, pcm, rate: made.rate });
    }
  }

  /** One that fits `heard`, at random and never the one played last; undefined when none fits or is ready. */
  pick(heard: string): Sound | undefined {
    const kind = this.kinds?.of(heard);
    if (!kind) return undefined;
    const fitting = this.sounds.filter((sound) => sound.kind === kind);
    const choices = fitting.filter((sound) => sound !== this.last);
    const sound = choices[Math.floor(Math.random() * choices.length)] ?? fitting[0];
    if (sound) this.last = sound;
    return sound;
  }
}
