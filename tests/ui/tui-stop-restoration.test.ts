import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { CURSOR_MARKER, TuiAltScreen, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

import {
  getCapabilities,
  isImageLine,
  setCapabilities,
} from "../../node_modules/@earendil-works/pi-tui/dist/terminal-image.js";

const zonePrefix = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// Model the pre-cache pipeline independently of the fixture's render/reset counters.
// Reset before clipping: clipping can intentionally omit the reset sequence.
function uncachedTranscript(lines: string[], width: number, resetRows: (rows: string[]) => string[]) {
  const rows = resetRows(lines.map((line) => line.replace(zonePrefix, "").replaceAll(CURSOR_MARKER, ""))).map((line) =>
    isImageLine(line) || visibleWidth(line) <= width ? line : sliceByColumn(line, 0, width, true),
  );
  let result = "\x1b[?2026h\x1b[?1049l\x1b[?7l";
  rows.forEach((line, row) => {
    result += (row > 0 ? "\r\n" : "") + "\r\x1b[2K" + line;
  });
  return result + "\x1b[0m\x1b[?7h\r\n\x1b[?25h\x1b[?2026l";
}

function fixture(lines: string[], width: number) {
  const writes: string[] = [];
  const terminal = {
    columns: width,
    rows: 32,
    write: (text: string) => {
      writes.push(text);
    },
  };
  const tui = new TuiAltScreen(terminal as any, false, undefined, { mouse: false }) as any;
  let renders = 0;
  let resetLines = 0;
  tui.render = () => {
    renders++;
    return lines;
  };
  // Keep the original transform so the oracle bypasses the observed-work spy.
  const resetRows: (rows: string[]) => string[] = tui.applyLineResets.bind(tui);
  tui.applyLineResets = (rows: string[]) => {
    resetLines += rows.length;
    return resetRows(rows);
  };
  tui.doRender = () => {
    throw new Error("stop must not draw a frame");
  };
  const reference = () => uncachedTranscript(lines, terminal.columns, resetRows);
  const restore = (preserveScreen = false) => {
    tui.altScreenActive = true;
    tui.afterTerminalStop({ preserveScreen });
    return writes.at(-1)!;
  };
  return { tui, terminal, writes, reference, restore, counters: () => ({ renders, resetLines }) };
}

test("stop writes all repeated rows, but transforms each consecutive run once", () => {
  const row = "\x1b[38;2;25;50;75mrepeated transcript row\x1b[0m";
  const lines = ["start", ...Array(33294).fill(row), "end"];
  const f = fixture(lines, 100);
  const expected = f.reference();
  const output = f.restore();
  expect(output.length).toBe(expected.length);
  expect(hash(output)).toBe(hash(expected));
  expect(f.tui.lastDocument.length).toBe(lines.length);
  expect(f.counters()).toEqual({ renders: 1, resetLines: 3 });
  expect(f.writes.length).toBe(1);
});

test("stop preserves colors, links, images, cursor stripping, normalization and clipping", () => {
  const rows = [
    "",
    "plain",
    "\x1b]133;A\x07\x1b]133;C\x1b\\prompt",
    CURSOR_MARKER + "cursor" + CURSOR_MARKER,
    "\x1b[31mred\x1b[0m",
    "\x1b]8;;https://example.test\x1b\\link\x1b]8;;\x1b\\",
    "tabs\tand Thai กำ Lao ກຳ",
    "中🙂é long wide text",
    "overlong ".repeat(20),
    "\x1b_Ga=T,f=100;AAAA\x1b\\",
    "\x1b]1337;File=inline=1:AAAA\x07",
  ];
  for (const width of [1, 8, 100]) {
    const f = fixture([...rows.flatMap((line) => [line, line]), ...rows], width);
    expect(f.restore()).toBe(f.reference());
    expect(f.counters()).toEqual({ renders: 1, resetLines: rows.length * 2 });
  }
});

test("stop cache does not survive a later restore or width/content change", () => {
  const rows = ["abcdef", "abcdef"];
  const f = fixture(rows, 100);
  expect(f.restore()).toBe(f.reference());
  f.terminal.columns = 3;
  rows.push("new state");
  expect(f.restore()).toBe(f.reference());
  expect(f.counters()).toEqual({ renders: 2, resetLines: 3 });
});

test("preserveScreen and inactive stops do not render or restore transcript", () => {
  const f = fixture(["do not restore"], 100);
  expect(f.restore(true)).toBe("\x1b[?2026h\x1b[?1049l\x1b[?25h\x1b[?2026l");
  f.tui.afterTerminalStop({});
  expect(f.counters()).toEqual({ renders: 0, resetLines: 0 });
  expect(f.writes.length).toBe(1);
});

test("public stop restores terminal state before transcript and restores saved capabilities", () => {
  const original = getCapabilities();
  try {
    const f = fixture(["transcript", "transcript"], 100);
    const events: string[] = [];
    const nativeWrite = f.terminal.write;
    f.terminal.write = (text: string) => {
      events.push(text.includes("\x1b[?1049l") ? "transcript" : "before-stop");
      nativeWrite(text);
    };
    (f.terminal as any).showCursor = () => events.push("cursor");
    (f.terminal as any).stop = () => events.push("terminal-stop");
    f.tui.altScreenActive = true;
    f.tui.savedCapabilities = original;
    setCapabilities({ ...original, trueColor: !original.trueColor });
    f.tui.stop();
    expect(events).toEqual(["before-stop", "cursor", "terminal-stop", "transcript"]);
    expect(getCapabilities()).toBe(original);
    expect(f.tui.savedCapabilities).toBeUndefined();
    expect(f.counters()).toEqual({ renders: 1, resetLines: 1 });
    expect(f.writes.at(-1)).toBe(f.reference());
  } finally {
    setCapabilities(original);
  }
});
