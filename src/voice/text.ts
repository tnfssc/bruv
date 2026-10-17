/** Cuts streamed reply text into sentences, so speech can start before the reply is done. */
export class Sentences {
  private buffer = "";
  private fence = false;
  /** Nothing said yet. Speech is made a piece at a time, so a long first sentence delays the first sound. */
  private first = true;

  /** Adds streamed text and returns the sentences it completed. */
  push(delta: string): string[] {
    this.buffer += delta;
    const done: string[] = [];
    for (;;) {
      const end = this.boundary();
      if (end < 0) break;
      const piece = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      done.push(...this.take(piece));
      if (done.length) this.first = false;
    }
    return done;
  }

  /** Returns what is left once the reply has ended. */
  flush(): string[] {
    const rest = this.take(this.buffer);
    this.buffer = "";
    this.fence = false;
    this.first = true;
    return rest;
  }

  /** The end of the first whole line or sentence in the buffer, or -1. */
  private boundary() {
    const line = this.buffer.indexOf("\n");
    // A sentence ends at . ! or ? followed by a space; "e.g. " and "1.5" stay whole. A colon doesn't end
    // one: "One:" alone sounds clipped.
    const sentence = this.buffer.search(/(?<!\b(?:e\.g|i\.e|etc|vs|Mr|Ms|Dr))[.!?](?=\s)/);
    // The first piece may end at a comma once it has 8 words, so the first sound comes sooner.
    let comma = -1;
    if (this.first)
      for (const match of this.buffer.matchAll(/[,;](?=\s)/g))
        if ((this.buffer.slice(0, match.index).match(/\S+/g)?.length ?? 0) >= 8) {
          comma = match.index;
          break;
        }
    const ends = [line, sentence, comma].map((at) => (at < 0 ? -1 : at + 1)).filter((at) => at > 0);
    return ends.length ? Math.min(...ends) : -1;
  }

  private take(piece: string) {
    if (/^\s*(```|~~~)/.test(piece)) {
      this.fence = !this.fence;
      return [];
    }
    if (this.fence) return [];
    const text = speakable(piece);
    return text ? [text] : [];
  }
}

/** Turns one line of Markdown into words worth saying. */
export function speakable(text: string) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*(#+|>|[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*\|.*\|\s*$/, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** How many of the heard words, over 3 letters, are nowhere close in what was said: the user's own words. */
export function fresh(heard: string, spoken: string) {
  const said = words(spoken);
  return words(heard).filter((word) => word.length > 3 && !said.some((other) => close(word, other))).length;
}

/**
 * The heard text without the echo around it. Without echo cancelling, a turn spoken over the reply starts
 * or ends with a stretch of the reply itself; runs of 4 or more words that follow what was said are cut from
 * either end. Shorter runs stay, as the user's own words often repeat a few of the reply's.
 */
export function withoutEcho(heard: string, spoken: string) {
  const said = words(spoken).join(" ");
  const parts = heard.trim().split(/\s+/);
  const key = (part: string) => words(part).join(" ");
  const run = (from: number, to: number) => {
    const text = parts.slice(from, to).map(key).filter(Boolean).join(" ");
    return text.split(" ").length >= 4 && said.includes(text);
  };
  let start = 0;
  for (let end = parts.length; end - start >= 4; end--)
    if (run(start, end)) {
      start = end;
      break;
    }
  let end = parts.length;
  for (let from = start; end - from >= 4; from++)
    if (run(from, end)) {
      end = from;
      break;
    }
  return parts.slice(start, end).join(" ");
}

/** The recogniser writes speech as said: "want to" comes back as "wanna". */
const spoken: Record<string, string> = {
  wanna: "want to",
  gonna: "going to",
  gotta: "got to",
  kinda: "kind of",
  lemme: "let me",
};

const words = (text: string) =>
  (
    text
      .toLowerCase()
      .replace(/'/g, "")
      .match(/[a-z0-9]+/g) ?? []
  ).flatMap((word) => (spoken[word] ?? word).split(" "));

/**
 * Whether what was heard is most likely the speaker's own voice coming back through the microphone. Echo is
 * often misheard ("years" as "year", "during" as "dur"), so words only need to be close. Short words are
 * in every reply, so they count only when fewer than two longer words were heard: otherwise "now run the
 * tests" would hang on "tests" alone.
 */
export function isEcho(heard: string, spoken: string) {
  const said = words(spoken);
  const all = words(heard);
  const long = all.filter((word) => word.length > 3);
  const counted = long.length >= 2 ? long : all;
  if (!counted.length || !said.length) return false;
  const matched = counted.filter((word) => said.some((other) => close(word, other))).length;
  if (matched / counted.length >= 0.75) return true;
  // Words heard split or joined differently ("fog horns" for "foghorn's").
  const letters = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return letters(heard).length >= 6 && letters(spoken).includes(letters(heard));
}

function close(a: string, b: string) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  if (short.length >= 4 && distance(a, b) <= Math.floor(long.length / 4)) return true;
  // Sounds alike ("scary" for "skerry"); only longer words, as short ones collide ("stop", "step").
  return short.length >= 5 && sound(a) === sound(b);
}

/** Soundex: the first letter and the next three consonant sounds. */
function sound(word: string) {
  const codes: Record<string, string> = {
    b: "1",
    f: "1",
    p: "1",
    v: "1",
    c: "2",
    g: "2",
    j: "2",
    k: "2",
    q: "2",
    s: "2",
    x: "2",
    z: "2",
    d: "3",
    t: "3",
    l: "4",
    m: "5",
    n: "5",
    r: "6",
  };
  let out = word[0];
  let last = codes[word[0]] ?? "";
  for (const letter of word.slice(1)) {
    const code = codes[letter] ?? "";
    if (code && code !== last) out += code;
    if (letter !== "h" && letter !== "w") last = code;
  }
  return out.slice(0, 4);
}

/** Edit distance. */
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
