/** Cuts streamed reply text into sentences, so speech can start before the reply is done. */
export class Sentences {
  private buffer = "";
  private fence = false;

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
    }
    return done;
  }

  /** Returns what is left once the reply has ended. */
  flush(): string[] {
    const rest = this.take(this.buffer);
    this.buffer = "";
    this.fence = false;
    return rest;
  }

  /** The end of the first whole line or sentence in the buffer, or -1. */
  private boundary() {
    const line = this.buffer.indexOf("\n");
    // A sentence ends at . ! ? or : followed by a space; "e.g. " and "1.5" stay whole.
    const sentence = this.buffer.search(/(?<!\b(?:e\.g|i\.e|etc|vs|Mr|Ms|Dr))[.!?:](?=\s)/);
    const ends = [line < 0 ? -1 : line + 1, sentence < 0 ? -1 : sentence + 1].filter((at) => at > 0);
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

/** Whether what was heard is most likely the speaker's own voice coming back through the microphone. */
export function isEcho(heard: string, spoken: string) {
  const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const said = new Set(words(spoken));
  const heardWords = words(heard);
  return heardWords.length > 0 && said.size > 0 && heardWords.every((word) => said.has(word));
}
