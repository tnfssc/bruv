import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, matchesKey, parseKey, truncateToWidth } from "@earendil-works/pi-tui";

/** No timeout guesses. A real Space release must prove hold support before sending. */
export class PushToTalkControl {
  holdSupported = false;
  talking = false;
  private source?: "space" | "explicit";
  constructor(private readonly change: (talking: boolean) => void) {}
  mute(): void {
    this.source = undefined;
    if (!this.talking) return;
    this.talking = false;
    this.change(false);
  }
  private talk(source: "space" | "explicit"): void {
    if (this.talking) return;
    this.source = source;
    this.talking = true;
    this.change(true);
  }
  input(data: string): "close" | undefined {
    if (data === "\x1b[O") {
      this.mute();
      return;
    }
    // Paste is never a speaking control.
    if (data.includes("\x1b[200~")) return;
    // Modifiers may change between press and release. The physical Space
    // release must still close a Space-owned hold.
    if (isKeyRelease(data) && parseKey(data)?.split("+").at(-1) === "space") {
      this.holdSupported = true;
      if (this.source === "space") this.mute();
      return;
    }
    if (matchesKey(data, "space")) {
      if (this.holdSupported && !isKeyRepeat(data)) this.talk("space");
      return;
    }
    if (isKeyRelease(data) || isKeyRepeat(data)) return;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.mute();
      return "close";
    }
    // Separate start/stop keys are idempotent even on legacy auto-repeat terminals.
    if (matchesKey(data, "enter")) this.talk("explicit");
    else if (matchesKey(data, "backspace")) this.mute();
  }
}

/** Dedicated input focus keeps speaking Space separate from text-editor Space. */
export async function openPushToTalk(
  ui: ExtensionContext["ui"],
  signal: AbortSignal,
  change: (talking: boolean) => void,
): Promise<void> {
  if (signal.aborted) return;
  await ui.custom<void>((tui, _theme, _keys, done) => {
    const control = new PushToTalkControl(change);
    let disposed = false;
    let focused = false;
    const close = () => {
      dispose();
      done();
    };
    // Pi already requests Kitty event types. All-key reporting makes printable
    // Space press/repeat explicit too. A release check still verifies routing.
    const pushed = tui.terminal.kittyProtocolActive;
    if (pushed) tui.terminal.write("\x1b[>15u");
    const ownsFocusReporting = tui.mode !== "fullscreen";
    if (ownsFocusReporting) tui.terminal.write("\x1b[?1004h");
    const remove = ui.onTerminalInput((data) => {
      if (!focused) return;
      if (control.input(data) === "close") close();
      tui.requestRender();
      return { consume: true };
    });
    function dispose() {
      if (disposed) return;
      disposed = true;
      control.mute();
      remove();
      signal.removeEventListener("abort", close);
      if (ownsFocusReporting) tui.terminal.write("\x1b[?1004l");
      if (pushed) tui.terminal.write("\x1b[<u");
    }
    signal.addEventListener("abort", close, { once: true });
    return {
      get focused() {
        return focused;
      },
      set focused(value: boolean) {
        focused = value;
        if (!value) control.mute();
      },
      render: (width) =>
        [
          "Live · " + (control.talking ? "TALKING — sending mic audio" : "MUTED — mic audio discarded"),
          control.holdSupported
            ? "Hold Space to talk. Release to mute."
            : "Press and release Space once to check hold support (muted).",
          "Enter: talk · Backspace: mute (works without key-release support).",
          "Esc: return to text, muted · /live talk: reopen · /live stop: end Live",
        ].map((line) => truncateToWidth(line, width)),
      handleInput: () => {},
      invalidate: () => {},
      dispose,
    };
  });
}
