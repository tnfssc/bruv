import { isKeyRelease, isKeyRepeat, matchesKey, parseKey } from "@earendil-works/pi-tui";

export interface EditorPushToTalkOptions {
  signal: AbortSignal;
  onTalking(talking: boolean): void;
  onHint?(hint: string | undefined): void;
}

/** An inserted Space's undo, guarded by the exact post-insert draft and cursor. */
export type WarmupSpace = () => boolean;

const IDLE_HINT = "Hold Space to speak · tap to type";
export const REPEAT_IDLE_MS = 250;
const LEGACY_HOLD_MS = 350;
const LEGACY_REPEAT_GAP_MS = 100;
const WARMUP_GAP_MS = 1200;

/**
 * Starts only on repeated Space in the editor, never on a press timer.
 * Legacy terminals have no key-up: three Space packets, a hold-length span,
 * and a short last interval infer repeat. Repeat inactivity bounds capture to
 * 250ms after the last packet; it is NOT an observed release. Explicit key-up
 * always closes immediately, even if modifiers changed. The same idle bound
 * protects a negotiated terminal whose release packet is lost in routing.
 */
export class EditorPushToTalk {
  private warmup: { at: number; undo: WarmupSpace }[] = [];
  private lastSpaceAt = 0;
  private talking = false;
  private timer?: ReturnType<typeof setTimeout>;
  private terminalFocused = true;
  private pasting = false;
  private blockedRepeat = false;
  private disposed = false;

  constructor(private readonly options: EditorPushToTalkOptions) {
    options.onTalking(false);
    options.onHint?.(IDLE_HINT);
  }

  /** Raw-input safety observer runs before app shortcuts and release filtering. */
  observeInput(data: string): void {
    if (this.disposed) return;
    if (data === "\x1b[O") {
      this.terminalFocused = false;
      this.cancel();
      return;
    }
    if (data === "\x1b[I") {
      this.terminalFocused = true;
      return;
    }
    if (data.includes("\x1b[200~")) {
      this.pasting = true;
      this.cancel();
    }
    if (data.includes("\x1b[201~")) this.pasting = false;
    if (isKeyRelease(data)) {
      if (parseKey(data)?.split("+").at(-1) === "space") {
        this.cancel();
        this.blockedRepeat = false;
      }
      return;
    }
    if (!matchesKey(data, "space")) this.cancel();
  }

  /** Returns true only when this module handled an editor Space. */
  input(data: string, insertSpace: () => WarmupSpace | undefined): boolean {
    this.observeInput(data);
    if (this.disposed || this.pasting || !this.terminalFocused || !matchesKey(data, "space")) return false;
    if (isKeyRelease(data)) return true;
    const now = Date.now();
    const repeat = isKeyRepeat(data);
    if (!repeat && data !== " ") {
      this.blockedRepeat = false; // explicit new Space press
      this.warmup = []; // earlier presses are taps, even if their releases were lost
    }
    if (this.talking) {
      this.lastSpaceAt = now;
      this.armIdle();
      return true;
    }
    const gap = now - this.lastSpaceAt;
    if (this.blockedRepeat) {
      if (repeat) return true;
      if (gap < REPEAT_IDLE_MS) {
        // Legacy repeat looks like a tap. Keep it text after cancellation,
        // but don't consider it warmup for reopening the microphone.
        insertSpace();
        this.lastSpaceAt = now;
        return true;
      }
      this.blockedRepeat = false;
    }
    if (gap > WARMUP_GAP_MS) this.warmup = [];
    else if (!repeat && this.warmup.length >= 2 && gap > LEGACY_REPEAT_GAP_MS) {
      // Earlier slow taps are draft, not this hold's warmup. Only the latest
      // press can precede a new auto-repeat delay.
      this.warmup = this.warmup.slice(-1);
    }
    if (repeat && !this.warmup.length) return true; // attach/focus during an existing hold
    const first = this.warmup[0];
    const held =
      first && (repeat || (this.warmup.length >= 2 && now - first.at >= LEGACY_HOLD_MS && gap <= LEGACY_REPEAT_GAP_MS));
    if (held) return this.startTalking(now);
    this.typeWarmupSpace(now, insertSpace);
    return true;
  }

  /** Until repeat proves a hold, Spaces are ordinary editor insertions. */
  private typeWarmupSpace(now: number, insertSpace: () => WarmupSpace | undefined): void {
    const undo = insertSpace();
    if (!undo) {
      this.cancel();
      return;
    }
    this.warmup.push({ at: now, undo });
    this.lastSpaceAt = now;
  }

  /** Acquire capture only after restoring our unchanged warmup insertions. */
  private startTalking(now: number): boolean {
    const spaces = this.warmup;
    this.warmup = [];
    // Consume newest first: each undo expects the draft left by the one after it.
    // Never replace the whole draft, and never open capture if a guard fails.
    for (const { undo } of spaces.reverse()) {
      if (!undo()) {
        this.blockedRepeat = true;
        return false; // leave this packet to normal editor handling
      }
    }
    this.talking = true;
    this.lastSpaceAt = now;
    this.options.onTalking(true);
    if (this.disposed) return true;
    this.options.onHint?.("Speaking · hold Space");
    this.armIdle();
    return true;
  }

  /** Focus, navigation, another UI, or shutdown never deletes pending taps. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.warmup.length || this.talking) this.blockedRepeat = true;
    this.warmup = [];
    if (!this.talking) return;
    this.talking = false;
    this.options.onTalking(false);
    this.options.onHint?.(IDLE_HINT);
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.options.onHint?.(undefined);
  }

  private armIdle(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.cancel(), REPEAT_IDLE_MS);
  }
}
