import { describe, expect, test } from "bun:test";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { PushToTalkControl, openPushToTalk } from "../src/live/push-to-talk";

describe("hold-Space controls", () => {
  test("never guesses release from repeats or silence", () => {
    const changes: boolean[] = [];
    const control = new PushToTalkControl((talking) => changes.push(talking));
    control.input(" ");
    control.input("\x1b[32;1:2u");
    expect(changes).toEqual([]);
    control.input("\x1b[32;1:3u");
    control.input("\x1b[32;1:2u");
    expect(changes).toEqual([]);
    control.input("\x1b[32;1:1u");
    control.input("\x1b[32;1:2u");
    expect(changes).toEqual([true]);
    control.input("\x1b[32;1:3u");
    expect(changes).toEqual([true, false]);
  });
  test("paste and modified Space cannot enable sending", () => {
    const changes: boolean[] = [];
    const control = new PushToTalkControl((talking) => changes.push(talking));
    control.input("\x1b[200~ \x1b[32;1:3u\r\x1b[201~");
    control.input("\x1b[32;5:1u");
    expect(changes).toEqual([]);
    expect(control.holdSupported).toBe(false);
  });
  test("explicit start and stop are idempotent; close always mutes", () => {
    const changes: boolean[] = [];
    const control = new PushToTalkControl((talking) => changes.push(talking));
    control.input("\r");
    control.input("\r");
    control.input("\x1b[32;1:3u"); // release check does not cancel explicit talk
    control.input("\x7f");
    control.input("\x7f");
    control.input("\r");
    expect(control.input("\x03")).toBe("close");
    expect(changes).toEqual([true, false, true, false]);
  });
});

test("Space release still mutes when modifiers change during a hold", () => {
  for (const modifier of [2, 3, 5, 8]) {
    const changes: boolean[] = [];
    const control = new PushToTalkControl((talking) => changes.push(talking));
    control.input("\x1b[32;1:3u");
    control.input("\x1b[32;1:1u");
    control.input("\x1b[32;" + modifier + ":3u");
    expect(changes).toEqual([true, false]);
  }
});

test("fullscreen forwards focus loss after cleanup and keeps renderer-owned reporting", async () => {
  const writes: string[] = [];
  const terminal: any = {
    columns: 100,
    rows: 40,
    kittyProtocolActive: false,
    write: (data: string) => writes.push(data),
    hideCursor: () => {},
    showCursor: () => {},
    clearScreen: () => {},
    start: () => {},
    stop: () => {},
    setProgress: () => {},
  };
  const tui = new TuiAltScreen(terminal);
  const changes: boolean[] = [];
  const ui: any = {
    onTerminalInput: (listener: any) => tui.addInputListener(listener),
    custom: (factory: any) =>
      new Promise<void>((resolve) => {
        const component = factory(tui, {}, {}, () => {
          component.dispose();
          resolve();
        });
        tui.setFocus(component);
      }),
  };
  const opened = openPushToTalk(ui, new AbortController().signal, (talking) => changes.push(talking));
  (tui as any).handleTerminalInput("\r");
  (tui as any).handleTerminalInput("\x1b[O");
  expect(changes).toEqual([true, false]);
  (tui as any).handleTerminalInput("\x1b");
  await opened;
  expect(writes).not.toContain("\x1b[?1004h");
  expect(writes).not.toContain("\x1b[?1004l");
  tui.stop();
});
