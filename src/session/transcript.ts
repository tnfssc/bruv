// Persisted discriminator stays stable for existing session branches.
export const VOICE_ENTRY = "bruv-live-transcript";
export type TranscriptEntry = {
  speaker: "You" | "Voice";
  text: string;
  status: "final" | "turn-boundary" | "interrupted" | "partial" | "suppressed";
  /** A replacement transcript superseded this draft; retain the source, not a second visible turn. */
  superseded?: true;
};
/** Received text is not audio or evidence that generated speech was heard. */
export class TranscriptLog {
  // Nonempty text from another speaker closes the active draft before starting a new one.
  private pending?: { speaker: TranscriptEntry["speaker"]; text: string };
  private recent: TranscriptEntry[] = [];
  constructor(
    private readonly save: (entry: TranscriptEntry) => void,
    private readonly options: { groupTurns?: boolean } = {},
  ) {}
  receive(speaker: "You" | "Voice", part: { text: string; finished?: boolean; replace?: boolean }): void {
    if (part.replace && (speaker === "You" || this.options.groupTurns) && this.pending?.speaker === speaker)
      this.flush("partial", this.options.groupTurns ? true : undefined);
    if (part.text) {
      // Preserve received order. This boundary is history data, not permission to hand off.
      if (this.pending && this.pending.speaker !== speaker) this.flush("partial");
      this.append(speaker, part.text, part.finished === true);
    }
    if (part.finished) this.finish(speaker, "final");
  }
  /** Conversation turns stay whole; audit chunks persist at capacity without losing received text. */
  private append(speaker: "You" | "Voice", text: string, finished: boolean): void {
    if (this.options.groupTurns) {
      this.pending ??= { speaker, text: "" };
      this.pending.text += text;
      return;
    }
    let offset = 0;
    while (offset < text.length) {
      this.pending ??= { speaker, text: "" };
      const draft = this.pending;
      const take = Math.min(4096 - draft.text.length, text.length - offset);
      draft.text += text.slice(offset, offset + take);
      offset += take;
      // An exactly full final chunk must retain its final boundary, not become partial.
      if (draft.text.length === 4096 && !(finished && offset === text.length)) this.flush("partial");
    }
  }
  finish(speaker: "You" | "Voice", status: TranscriptEntry["status"]): void {
    if (this.pending?.speaker === speaker) this.flush(status);
  }
  private flush(status: TranscriptEntry["status"], superseded?: true): void {
    const draft = this.pending;
    this.pending = undefined;
    if (!draft) return;
    const entry: TranscriptEntry = { ...draft, status, ...(superseded ? { superseded } : {}) };
    this.save(entry);
    this.recent.push(entry);
    while (this.recent.length > 24 || this.recent.reduce((n, e) => n + e.text.length, 0) > 32768) {
      this.recent.shift();
    }
  }
  reset(): void {
    this.pending = undefined;
    this.recent = [];
  }
  /** Active drafts only: completed turns belong in the ordinary conversation, not a widget. */
  draftView(clean: (text: string) => string): string[] {
    if (!this.pending) return [];
    const text = clean(this.pending.text.slice(-2400));
    return [(this.pending.speaker === "You" ? "" : "Assistant: ") + text];
  }
  /** Widget is a bounded viewport; full entries remain in session history. */
  view(clean: (text: string) => string): string[] {
    const render = (e: TranscriptEntry) => {
      const text = clean(e.text);
      const label =
        e.speaker + (e.status === "suppressed" ? " (not played)" : e.status === "interrupted" ? " (interrupted)" : "");
      // Keep live text moving instead of freezing on the start of a long reply.
      // The complete received entry is kept separately in session history.
      return label + ": " + (text.length > 2400 ? "… [earlier text saved] " + text.slice(-2400) : text);
    };
    // Reserve viewport slots for drafts before they become recent entries. Otherwise
    // finishing speech evicts an older row and moves the prompt up one line.
    const entries = this.recent.slice(this.pending ? -3 : -4);
    return [...entries.map(render), ...(this.pending ? [render({ ...this.pending, status: "partial" })] : [])];
  }
}
