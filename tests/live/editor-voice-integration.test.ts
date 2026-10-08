import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  type Terminal,
  TuiAltScreen,
  type TuiInputListener,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import { CompactEditor } from "../../src/ui/editor";

const press = "\x1b[32;1:1u";
const repeat = "\x1b[32;1:2u";
const release = "\x1b[32;1:3u";
const identity = (text: string) => text;
const theme: EditorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  // Dispose attachments before restoring the fixture clock.
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture({ kitty = true, fullscreen = false } = {}) {
  let now = 1000;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  cleanups.push(() => clock.mockRestore());
  const writes: string[] = [];
  const terminal = {
    rows: 24,
    columns: 80,
    kittyProtocolActive: kitty,
    write: (data: string) => writes.push(data),
  } as unknown as Terminal;
  const tui = fullscreen ? new TuiAltScreen(terminal) : new TuiMainScreen(terminal);
  // Exercise the SDK's real raw-listener -> focus -> release-filter -> editor
  // routing. Only drawing is disabled: no actual device or provider calls.
  const raw = tui as unknown as { handleTerminalInput(data: string): void; requestImmediateRender(): void };
  raw.requestImmediateRender = () => {};
  tui.requestRender = () => {};
  const input = new CompactEditor(
    tui,
    theme,
    {
      matches: (data: string, action: string) => action === "app.interrupt" && data === "\x1b",
    } as KeybindingsManager,
    { paddingX: 0 },
  );
  tui.addChild(input);
  tui.setFocus(input);
  const abort = new AbortController();
  cleanups.push(() => abort.abort());
  const changes: boolean[] = [];
  const hints: (string | undefined)[] = [];
  let listeners = 0;
  const ui = {
    onTerminalInput(handler: TuiInputListener) {
      listeners++;
      const remove = tui.addInputListener(handler);
      return () => {
        listeners--;
        remove();
      };
    },
  };
  const attach = (signal = abort.signal) => {
    const detach = input.attachPushToTalk(ui, {
      signal,
      onTalking: (value: boolean) => changes.push(value),
      onHint: (value: string | undefined) => hints.push(value),
    });
    cleanups.push(detach);
    return detach;
  };
  const detach = attach();
  const send = (data: string, advance = 0) => {
    now += advance;
    raw.handleTerminalInput(data);
  };
  return { input, tui, send, abort, changes, hints, writes, attach, detach, listeners: () => listeners };
}

function hold(f: ReturnType<typeof fixture>) {
  f.send(press);
  f.send(repeat, 500);
}

describe("voice in real CompactEditor input routing", () => {
  test("tap Space types; ordinary Enter and Backspace are still editor actions", () => {
    const f = fixture();
    f.send("draft");
    f.send(press);
    f.send(release);
    expect(f.input.getText()).toBe("draft ");
    f.send("\x7f");
    expect(f.input.getText()).toBe("draft");
    let submitted = "";
    f.input.onSubmit = (value) => {
      submitted = value;
    };
    f.send("\r");
    expect(submitted).toBe("draft");
    expect(f.changes).toEqual([false]);
  });

  test("hold restores only warmup Spaces and the exact middle-of-draft cursor", () => {
    const f = fixture();
    f.input.setText("first  😀 line\nsecond");
    f.send("\x1b[H");
    f.send("\x1b[D");
    const before = f.input.getText();
    const cursor = f.input.getCursor();
    hold(f);
    expect(f.input.getText()).toBe(before);
    expect(f.input.getCursor()).toEqual(cursor);
    expect(f.changes).toEqual([false, true]);
    f.send("\x1b[32;6:3u");
    expect(f.changes).toEqual([false, true, false]);
    f.send("X");
    expect(f.input.getText()).toBe("first  😀 lineX\nsecond");
  });

  test("legacy packets warm up in editor then restore draft at repeat activation", () => {
    const f = fixture({ kitty: false });
    f.send("draft  ");
    f.send(" ");
    f.send(" ", 500);
    expect(f.input.getText()).toBe("draft    ");
    f.send(" ", 30);
    expect(f.input.getText()).toBe("draft  ");
    expect(f.changes).toEqual([false, true]);
    f.send("\x1b[D");
    expect(f.changes.at(-1)).toBe(false);
    f.detach();
    expect(f.writes).toEqual(["\x1b[?1004h", "\x1b[?1004l"]);
  });

  test("paste marker registry and undo history survive a hold", () => {
    const f = fixture();
    const content = "abc😀".repeat(250) + "\n" + "row\n".repeat(12);
    f.send("\x1b[200~" + content + "\x1b[201~");
    const marker = f.input.getText();
    const cursor = f.input.getCursor();
    hold(f);
    f.send(release);
    expect(f.input.getText()).toBe(marker);
    expect(f.input.getExpandedText()).toBe(content);
    expect(f.input.getCursor()).toEqual(cursor);
    (f.input as unknown as { undo(): void }).undo();
    expect(f.input.getText()).toBe("");
    expect(f.input.getExpandedText()).toBe("");
  });

  test.each([
    ["navigation", "\x1b[D"],
    ["cancel", "\x1b"],
    ["Backspace", "\x7f"],
    ["Enter", "\r"],
    ["paste", "\x1b[200~ pasted \x1b[201~"],
  ])("%s input mutes capture", (_action, packet) => {
    const f = fixture();
    hold(f);
    expect(f.changes.at(-1)).toBe(true);
    f.send(packet);
    expect(f.changes.at(-1)).toBe(false);
    f.send(release);
    hold(f);
    expect(f.changes).toEqual([false, true, false, true]);
  });

  test("editor mouse input mutes capture", () => {
    const f = fixture();
    hold(f);
    f.input.render(80);
    f.input.handleMouse({
      type: "click",
      button: "left",
      x: 3,
      y: 0,
      width: 80,
      height: 1,
      screenX: 3,
      screenY: 0,
      shift: false,
      alt: false,
      ctrl: false,
    });
    expect(f.changes.at(-1)).toBe(false);
    f.send(release);
    hold(f);
    expect(f.changes).toEqual([false, true, false, true]);
  });

  test.each(["insertTextAtCursor", "setText"] as const)("%s mutes capture and applies the edit", (edit) => {
    const f = fixture();
    hold(f);
    f.input[edit]("replacement");
    expect(f.changes.at(-1)).toBe(false);
    expect(f.input.getText()).toBe("replacement");
    f.send(release);
    hold(f);
    expect(f.changes).toEqual([false, true, false, true]);
  });

  test("losing editor focus mutes synchronously; Space in other UI stays ordinary input", () => {
    const f = fixture();
    hold(f);
    const received: string[] = [];
    const dialog = {
      focused: false,
      handleInput: (data: string) => received.push(data),
      render: () => [],
      invalidate() {},
    };
    f.tui.addChild(dialog);
    f.tui.setFocus(dialog);
    expect(f.changes.at(-1)).toBe(false);
    f.send(" ");
    expect(received).toEqual([" "]);
    f.tui.setFocus(f.input);
    f.send(repeat);
    expect(f.changes).toEqual([false, true, false]);
  });

  test("raw safety observer closes before a shortcut consumes the editor key", () => {
    const f = fixture();
    const remove = f.tui.addInputListener((data) => (data === "\x03" ? { consume: true } : undefined));
    hold(f);
    f.send("\x03");
    expect(f.changes.at(-1)).toBe(false);
    remove();
  });

  test("reattachment puts safety before existing listeners without reordering or removing them", () => {
    const f = fixture();
    f.detach();
    const seen: string[] = [];
    const first: TuiInputListener = (data) => {
      if (data === "\x03") {
        expect(f.changes.at(-1)).toBe(false);
        seen.push("first");
      }
      return undefined;
    };
    const second: TuiInputListener = (data) => {
      if (data !== "\x03") return undefined;
      seen.push("second");
      return { consume: true };
    };
    const removeFirst = f.tui.addInputListener(first);
    const removeSecond = f.tui.addInputListener(second);
    cleanups.push(removeFirst, removeSecond);
    const listeners = (f.tui as unknown as { inputListeners: Set<TuiInputListener> }).inputListeners;
    const existing = [...listeners];
    const detach = f.attach();
    expect([...listeners].slice(1)).toEqual(existing);
    hold(f);
    f.send("\x03");
    expect(seen).toEqual(["first", "second"]);
    detach();
    expect([...listeners]).toEqual(existing);
  });

  test.each(["detach", "abort"] as const)("%s restores Pi's writable focus property with its latest value", (end) => {
    const f = fixture();
    expect(Object.getOwnPropertyDescriptor(f.input, "focused")?.get).toBeDefined();
    hold(f);
    f.tui.setFocus(null);
    expect(f.changes.at(-1)).toBe(false);
    if (end === "detach") f.detach();
    else f.abort.abort();
    expect(Object.getOwnPropertyDescriptor(f.input, "focused")).toEqual({
      configurable: true,
      enumerable: true,
      writable: true,
      value: false,
    });
    f.tui.setFocus(f.input);
    expect(f.input.focused).toBe(true);
    f.send(" ");
    expect(f.input.getText()).toBe(" ");
  });

  test("an already-aborted attachment detaches the prior session without acquiring new hooks", () => {
    const f = fixture();
    hold(f);
    const aborted = new AbortController();
    aborted.abort();
    const detach = f.attach(aborted.signal);
    detach();
    expect(f.changes).toEqual([false, true, false]);
    expect(f.listeners()).toBe(0);
    expect(f.input.wantsKeyRelease).toBe(false);
    expect(f.writes).toEqual(["\x1b[>15u", "\x1b[?1004h", "\x1b[?1004l", "\x1b[<u"]);
  });

  test("terminal focus loss and changed-modifier release close capture at the raw seam", () => {
    const f = fixture();
    hold(f);
    f.send("\x1b[O");
    expect(f.changes.at(-1)).toBe(false);
    f.send("\x1b[I");
    hold(f);
    f.send("\x1b[32;5:3u");
    expect(f.changes.at(-1)).toBe(false);
  });

  test("fullscreen viewport cannot hide focus-in or navigation from the safety observer", () => {
    const f = fixture({ fullscreen: true });
    hold(f);
    f.send("\x1b[O");
    expect(f.changes.at(-1)).toBe(false);
    f.send("\x1b[I");
    hold(f);
    expect(f.changes.at(-1)).toBe(true);
    // Viewport mouse input is consumed before normal extension listeners.
    // A wheel packet is sufficient: no layout/render fixture is needed.
    f.send("\x1b[<64;1;1M");
    expect(f.changes.at(-1)).toBe(false);
    expect(f.writes).toEqual(["\x1b[>15u"]); // fullscreen already owns focus reporting
    f.detach();
    expect(f.writes).toEqual(["\x1b[>15u", "\x1b[<u"]);
  });

  test("abort preserves a pending typed Space, detaches listeners and restores terminal flags", () => {
    const f = fixture();
    f.send("draft");
    f.send(press);
    const cursor = f.input.getCursor();
    f.abort.abort();
    f.detach();
    expect(f.input.getText()).toBe("draft ");
    expect(f.input.getCursor()).toEqual(cursor);
    expect(f.input.wantsKeyRelease).toBe(false);
    expect(f.listeners()).toBe(0);
    expect(f.hints.at(-1)).toBeUndefined();
    expect(f.writes).toEqual(["\x1b[>15u", "\x1b[?1004h", "\x1b[?1004l", "\x1b[<u"]);
    f.send(" ");
    expect(f.input.getText()).toBe("draft  ");
  });

  test("abort during capture mutes and reattachment has only one listener", () => {
    const f = fixture();
    hold(f);
    f.abort.abort();
    expect(f.changes).toEqual([false, true, false]);
    const next = new AbortController();
    const detach = f.attach(next.signal);
    expect(f.listeners()).toBe(1);
    const detachAgain = f.attach(next.signal);
    expect(f.listeners()).toBe(1);
    detach();
    expect(f.listeners()).toBe(1); // old detach can't remove a new session
    detachAgain();
    expect(f.listeners()).toBe(0);
  });
});
