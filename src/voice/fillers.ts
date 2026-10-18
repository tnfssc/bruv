import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Level, speakOnce, voiceId } from "./cloud";

/**
 * Short sounds played while the agent starts its answer. Between the user's last word and the agent's first
 * there are a few seconds of silence, which feel like not being heard; a "hmm" fills them the way a person
 * would. They are made once in the agent's voice and kept, so they cost nothing after and play at once.
 */
export const fillerLines = [
  "Hmm.",
  "Mm, okay.",
  "Hmm, let me see.",
  "Okay, um...",
  "Mm-hm.",
  "Right, so...",
  "Let me think.",
];

export type Sound = { text: string; pcm: Int16Array; rate: number };

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

  /** Loads the kept sounds from `dir`, making the missing ones in the background. */
  constructor(
    private dir: string,
    private model: string,
    private key: () => Promise<string | undefined>,
    private fetch = globalThis.fetch,
  ) {
    this.ready = this.load().catch(() => {});
  }

  /** Done loading or making them; some may be missing if making them failed. */
  ready: Promise<void>;

  private async load() {
    const id = voiceId(this.model);
    for (const [index, text] of fillerLines.entries()) {
      const file = join(this.dir, `${id}-${index}.pcm`);
      if (existsSync(file)) {
        const bytes = readFileSync(file);
        this.sounds.push({ text, pcm: new Int16Array(new Uint8Array(bytes).buffer), rate: 44_100 });
        continue;
      }
      const key = await this.key();
      if (!key) return;
      const made = await speakOnce(this.model, key, text, this.fetch);
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
      this.sounds.push({ text, pcm, rate: made.rate });
    }
  }

  /** One at random, never the one played last; undefined while none are ready. */
  pick(): Sound | undefined {
    const choices = this.sounds.filter((sound) => sound !== this.last);
    const sound = choices[Math.floor(Math.random() * choices.length)] ?? this.sounds[0];
    this.last = sound;
    return sound;
  }
}
