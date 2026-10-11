import { expect, test } from "bun:test";
import { demoDuration, demoFrame, demoHeight, demoIds, demoTranscript } from "./demos";
import { layout } from "./layout";
import { advance, FINAL_HOLD, inView } from "./playback";
import { requireValue } from "./require-value";

const text = (id: (typeof demoIds)[number], cols: number, ms: number) =>
  demoFrame(id, cols, ms)
    .rows.map((row) =>
      row
        .map((cell) => cell.text)
        .join("")
        .trim(),
    )
    .join("\n");

const spinner = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const PROMPT = "\uf460";
const frames = (id: (typeof demoIds)[number], cols: number) =>
  Array.from({ length: Math.floor(demoDuration(id) / 100) + 1 }, (_, i) => demoFrame(id, cols, i * 100));

test("all three scripts keep their cell bounds and fixed viewport throughout", () => {
  expect(demoIds).toHaveLength(3);
  for (const id of demoIds) {
    expect(demoDuration(id)).toBeGreaterThanOrEqual(16000);
    expect(demoDuration(id)).toBeLessThanOrEqual(22000);
    for (const cols of [30, 59, 60, 80]) {
      for (let ms = 0; ms <= demoDuration(id); ms += 250) {
        const frame = demoFrame(id, cols, ms);
        expect(frame.rows.length).toBe(demoHeight(cols));
        expect(frame.stage.length).toBeGreaterThan(0);
        for (const row of frame.rows) {
          expect(row.length).toBe(cols);
          for (const cell of row) {
            expect([...cell.text].length).toBe(1);
            // Closed repertoire: no surrogate pairs, combining or double-width glyphs.
            expect(cell.text).toMatch(/^[ -~⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗·−…─│╭╮╰╯\uf460]$/u);
            expect(cell.style).toContain("38;2;");
            expect(cell.style).toContain("48;2;");
          }
        }
      }
      expect(demoFrame(id, cols, demoDuration(id) + 10000)).toEqual(demoFrame(id, cols, demoDuration(id)));
    }
  }
});

test("each demo types its request, works with a spinner in the prompt mark, then goes idle", () => {
  for (const id of demoIds) {
    expect(text(id, 80, 1800).length).toBeGreaterThan(text(id, 80, 800).length);
    const marks = frames(id, 80).map((frame) => requireValue(frame.rows.at(-2))[0].text);
    expect(marks.some((mark) => spinner.includes(mark))).toBe(true);
    expect(marks.at(-1)).toBe(PROMPT);
  }
});

test("the board sits above the editor while work runs and ends with every item done", () => {
  for (const id of ["check", "background"] as const) {
    const boardRow = (row: { text: string }[]) => /^ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓] [aj]\d/.test(row.map((cell) => cell.text).join(""));
    expect(
      frames(id, 80).some((frame) => frame.rows.some((row) => spinner.includes(row[1]?.text) && boardRow(row))),
    ).toBe(true);
    const final = demoFrame(id, 80, demoDuration(id)).rows;
    const board = final.filter(boardRow);
    expect(board.length).toBeGreaterThan(0);
    for (const row of board) expect(row[1].text).toBe("✓");
    // Board rows come after the transcript and before the editor and footer.
    expect(final.findLastIndex(boardRow)).toBeLessThan(final.length - 2);
  }
});

test("the receipt box keeps its edges lined up at every width", () => {
  for (const cols of [30, 60, 80]) {
    const rows = demoFrame("check", cols, demoDuration("check")).rows.map((row) =>
      row.map((cell) => cell.text).join(""),
    );
    const top = rows.findIndex((row) => row.includes("╭"));
    const bottom = rows.findIndex((row) => row.includes("╰"));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThan(top + 1);
    const left = rows[top].indexOf("╭");
    const right = rows[top].indexOf("╮");
    expect(rows[bottom].indexOf("╰")).toBe(left);
    expect(rows[bottom].indexOf("╯")).toBe(right);
    for (const row of rows.slice(top + 1, bottom)) {
      expect([...row][left]).toBe("│");
      expect([...row][right]).toBe("│");
    }
  }
});

test("the footer is one row with the model at the right edge", () => {
  for (const id of demoIds)
    for (const cols of [30, 60, 80]) {
      const footer = requireValue(demoFrame(id, cols, demoDuration(id)).rows.at(-1));
      expect(footer).toHaveLength(cols);
      expect(footer[cols - 1].text).not.toBe(" ");
    }
});

test("transcripts tell each story without UI chrome", () => {
  for (const id of demoIds) {
    const transcript = demoTranscript(id);
    expect(transcript.split("\n\n").length).toBeGreaterThanOrEqual(3);
    expect(transcript).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\uf460]/u);
  }
});

test("loop holds the final frame and wraps at the end of the hold", () => {
  for (const id of demoIds) {
    const duration = demoDuration(id);
    const playback = { elapsed: duration, paused: false };
    const final = demoFrame(id, 68, duration);
    advance(playback, FINAL_HOLD - 1, duration, true);
    expect(demoFrame(id, 68, playback.elapsed)).toEqual(final);
    advance(playback, 1, duration, true);
    expect(playback.elapsed).toBe(0);
    expect(demoFrame(id, 68, playback.elapsed)).toEqual(demoFrame(id, 68, 0));
  }
});

test("offscreen playback preserves its position", () => {
  for (const id of demoIds) {
    const playback = { elapsed: 1200, paused: false };
    advance(playback, 100, demoDuration(id), false);
    expect(playback.elapsed).toBe(1200);
  }
});

test("paused playback preserves its position even while visible", () => {
  for (const id of demoIds) {
    const playback = { elapsed: 1200, paused: true };
    advance(playback, 100, demoDuration(id), true);
    expect(playback.elapsed).toBe(1200);
  }
});

test("a demo fitting inside the viewport is in view", () => {
  expect(inView(4, 27, 3, 30)).toBe(true);
});

test("one panel action replaces permanent playback and diagnostic rows", () => {
  const initial = layout(144, 53, { scroll: 0, focus: -1 });
  const scroll = initial.capture.y - 5;
  const plain = layout(144, 53, { scroll, focus: -1 });
  const hit = plain.hits.findIndex((h) => h.action === "demo:keep:toggle");
  expect(hit).toBeGreaterThanOrEqual(0);
  expect(plain.hits.filter((h) => h.action.startsWith("demo:keep:"))).toHaveLength(1);
  expect(plain.hits[hit].height).toBeGreaterThan(1);
  const hover = layout(144, 53, { scroll, focus: -1, hover: "keep" });
  const focused = layout(144, 53, { scroll, focus: hit });
  expect(hover.maxScroll).toBe(plain.maxScroll);
  expect(focused.maxScroll).toBe(plain.maxScroll);
  expect(hover.ansi).toContain("[ Pause ]");
  expect(focused.ansi).toContain("[ Pause ]");
  expect(plain.ansi).not.toContain("[ Pause ]");
  expect(plain.lines.join(" ")).not.toContain("Animated demo");
  expect(plain.lines.join(" ")).not.toContain("Replay");
});
