import { CustomEditor, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  isKeyRelease,
  type TuiInputListener,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
} from "@earendil-works/pi-tui";

import { EditorPushToTalk, type EditorPushToTalkOptions, type WarmupSpace } from "../live/editor-push-to-talk";

export const IDLE_PROMPT_ICON = ""; // nf-oct-chevron_right, U+F460

/** Borderless presentation; all editing, IME, paste and app shortcuts stay in Pi. */
export class CompactEditor extends CustomEditor {
  /** Opt into the guarded host dock reservation; native replacements retain three rows. */
  readonly bruvCompactEditor = true;
  private voice?: EditorPushToTalk;
  private detachVoice?: () => void;

  /** Attach to the existing editor; never replace it or move input focus. */
  attachPushToTalk(ui: Pick<ExtensionUIContext, "onTerminalInput">, options: EditorPushToTalkOptions): () => void {
    this.detachVoice?.();
    if (options.signal.aborted) return () => {};
    const control = new EditorPushToTalk(options);
    this.voice = control;
    let focused = this.focused;
    // Pi's Editor declares a data property, so an override accessor would be
    // illegal in TS. Install the focus hook only for this attached session.
    Object.defineProperty(this, "focused", {
      configurable: true,
      enumerable: true,
      get: () => focused,
      set: (value: boolean) => {
        focused = value;
        if (!value) control.cancel();
      },
    });
    const observe = (data: string) => {
      control.observeInput(data);
      if (!this.focused) control.cancel();
      return undefined; // Space in dialogs and other components stays theirs.
    };
    const remove = ui.onTerminalInput(observe);
    // Narrow SDK seam: fullscreen registers handleViewportInput before extension
    // listeners. It consumes focus-in, search, scrolling, and mouse packets.
    // Safety must see those BEFORE consumption (not 250ms later). Reorder only
    // this observer; all existing listeners keep their relative order.
    const listeners = (this.tui as unknown as { inputListeners: Set<TuiInputListener> }).inputListeners;
    const previousListeners = [...listeners].filter((listener) => listener !== observe);
    listeners.clear();
    listeners.add(observe);
    for (const listener of previousListeners) listeners.add(listener);
    // Pi negotiates flag 2; printable keys need flag 8 as well to report Space
    // releases. Push/pop only while attached, without claiming routing proof.
    const pushed = this.tui.terminal.kittyProtocolActive;
    if (pushed) this.tui.terminal.write("\x1b[>15u");
    const ownsFocusReporting = this.tui.mode !== "fullscreen";
    if (ownsFocusReporting) this.tui.terminal.write("\x1b[?1004h");
    let disposed = false;
    const detach = () => {
      if (disposed) return;
      disposed = true;
      control.dispose();
      remove();
      options.signal.removeEventListener("abort", detach);
      Object.defineProperty(this, "focused", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: focused,
      });
      this.voice = undefined;
      this.detachVoice = undefined;
      if (ownsFocusReporting) this.tui.terminal.write("\x1b[?1004l");
      if (pushed) this.tui.terminal.write("\x1b[<u");
    };
    this.detachVoice = detach;
    options.signal.addEventListener("abort", detach, { once: true });
    return detach;
  }

  /** Pi filters releases unless the focused component opts in. */
  get wantsKeyRelease(): boolean {
    return !!this.voice;
  }

  override handleInput(data: string): void {
    // Release packets must never become editor actions or printable text.
    if (isKeyRelease(data)) {
      this.voice?.observeInput(data);
      return;
    }
    if (this.focused && this.voice?.input(data, () => this.insertWarmupSpace())) return;
    super.handleInput(data);
  }

  override setText(text: string): void {
    this.voice?.cancel();
    super.setText(text);
  }

  override insertTextAtCursor(text: string): void {
    this.voice?.cancel();
    super.insertTextAtCursor(text);
  }

  private insertWarmupSpace(): WarmupSpace | undefined {
    const text = this.getText();
    const cursor = this.getCursor();
    const lines = this.getLines();
    const line = lines[cursor.line] ?? "";
    lines[cursor.line] = `${line.slice(0, cursor.col)} ${line.slice(cursor.col)}`;
    const expected = lines.join("\n");
    const autocomplete = this.isShowingAutocomplete();
    super.handleInput(" ");
    if (autocomplete || this.getText() !== expected) return undefined;
    return () => {
      const current = this.getCursor();
      if (this.getText() !== expected || current.line !== cursor.line || current.col !== cursor.col + 1) return false;
      // Narrow SDK seam: every Space gets its own undo snapshot (Pi Editor
      // insertCharacter). undo restores cursor and paste registry too. Public
      // setText clears paste markers and moves the cursor; Backspace pollutes
      // undo history. Keep this one seam covered by real-editor tests.
      (this as unknown as { undo(): void }).undo();
      const restored = this.getCursor();
      return this.getText() === text && restored.line === cursor.line && restored.col === cursor.col;
    };
  }

  private bodyRows = 1;
  private gutter = 2;
  private above = 0;
  private below = 0;
  private indicator: Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];

  override setPaddingX(_padding: number): void {
    super.setPaddingX(0); // The prompt gutter replaces horizontal editor padding.
  }

  override setWorkingStatusIndicator(indicator: Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]): void {
    super.setWorkingStatusIndicator(indicator);
    this.indicator = indicator;
  }

  protected override renderTopBorder(_width: number, hidden: number): string {
    this.above = hidden;
    return "";
  }

  protected override renderBottomBorder(_width: number, hidden: number): string {
    this.below = hidden;
    return "";
  }

  override render(width: number): string[] {
    if (width < 1) return [];
    // Keep input, cursor, and autocomplete columns fixed while the idle
    // chevron is replaced by the working spinner. At two columns or fewer,
    // prioritize editable content over decoration.
    this.gutter = width > 2 ? 2 : 0;
    const lines = super.render(width - this.gutter);
    // Pi's border hooks delimit input and autocomplete. Drop only those two
    // rows, not the last row (which may belong to an autocomplete menu).
    const bottom = lines.indexOf("", 1);
    this.bodyRows = bottom - 1;
    return lines
      .filter((_, index) => index !== 0 && index !== bottom)
      .map((line, index) => {
        let prefix = " ";
        if (index === 0) {
          prefix =
            this.indicator?.renderSpinnerInBorder(1) ||
            this.borderColor(this.above ? (this.below ? "↕" : "↑") : IDLE_PROMPT_ICON);
        } else if (index === this.bodyRows - 1 && this.below) {
          prefix = this.borderColor("↓");
        }
        return truncateToWidth((this.gutter ? `${prefix} ` : "") + line, width, "");
      });
  }

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    this.voice?.cancel();
    return super.handleMouse({
      ...event,
      x: Math.max(0, event.x - this.gutter),
      y: event.y + (event.y < this.bodyRows ? 1 : 2),
      width: Math.max(1, event.width - this.gutter),
      height: event.height + 2,
    });
  }
}
