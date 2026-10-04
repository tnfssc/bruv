import { expect, test } from "bun:test";
import { demoIds, demoDuration, demoFrame, demoHeight, demoTranscript } from "./demos";

const text = (id: (typeof demoIds)[number], cols: number, ms: number) =>
  demoFrame(id, cols, ms)
    .rows.map((row) =>
      row
        .map((cell) => cell.text)
        .join("")
        .trim(),
    )
    .join("\n");

test("all three scripts keep their cell bounds and fixed viewport throughout", () => {
  expect(demoIds).toEqual(["delegate", "background", "wisdom"]);
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
            expect(cell.text).toMatch(/^[ -~⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓↗·▸]$/u);
            expect(cell.style).toContain("38;2;");
            expect(cell.style).toContain("48;2;");
          }
        }
      }
      expect(demoFrame(id, cols, demoDuration(id) + 10000)).toEqual(demoFrame(id, cols, demoDuration(id)));
    }
  }
});

test("typing leads to source-shaped tool activity and useful final results", () => {
  expect(text("delegate", 80, 1800).length).toBeGreaterThan(text("delegate", 80, 800).length);
  expect(text("delegate", 80, 5000)).toContain("1 tool called ▸ · Delegate CSV fix");
  expect(text("delegate", 30, 8000)).toContain("↗ Fix CSV import");
  expect(text("delegate", 30, 20000)).toContain("1 tool called ▸");
  expect(demoTranscript("delegate")).toContain("Review its branch before merging");
  const talking = text("background", 30, 9000);
  expect(talking).toContain("↗ Run import tests");
  expect(talking).toContain("While they run");
  expect(talking).toContain("1t");
  expect(text("background", 30, 21000)).toContain("✓ Run import tests");
  expect(demoTranscript("background")).toContain("Import tests passed");
  expect(text("wisdom", 30, 20000)).toContain("4 tools called ▸");
  expect(text("wisdom", 80, 15000)).toContain("Update wisdom/csv.md");
  expect(demoTranscript("wisdom")).toContain("limit memory use");
  expect(demoTranscript("wisdom")).toContain("Added the quoted-newline test");
});

import { advance, FINAL_HOLD, inView } from "./playback";
import { layout } from "./layout";
test("loop holds the final frame, wraps once, and stops when paused/offscreen", () => {
  for (const id of demoIds) {
    const duration = demoDuration(id);
    const p = { elapsed: duration, paused: false };
    const final = demoFrame(id, 68, duration);
    advance(p, FINAL_HOLD - 1, duration, true);
    expect(demoFrame(id, 68, p.elapsed)).toEqual(final);
    advance(p, 1, duration, true);
    expect(p.elapsed).toBe(0);
    expect(demoFrame(id, 68, p.elapsed)).toEqual(demoFrame(id, 68, 0));
    advance(p, 100, duration, false);
    expect(p.elapsed).toBe(0);
    p.paused = true;
    advance(p, 100, duration, true);
    expect(p.elapsed).toBe(0);
  }
  expect(inView(4, 27, 3, 30)).toBe(true);
});
test("one panel action replaces permanent playback and diagnostic rows", () => {
  const initial = layout(144, 53, { scroll: 0, focus: -1 });
  const scroll = initial.capture.y - 5;
  const plain = layout(144, 53, { scroll, focus: -1 });
  const hit = plain.hits.findIndex((h) => h.action === "demo:delegate:toggle");
  expect(hit).toBeGreaterThanOrEqual(0);
  expect(plain.hits.filter((h) => h.action.startsWith("demo:delegate:"))).toHaveLength(1);
  expect(plain.hits[hit].height).toBeGreaterThan(1);
  const hover = layout(144, 53, { scroll, focus: -1, hover: "delegate" });
  const focused = layout(144, 53, { scroll, focus: hit });
  expect(hover.maxScroll).toBe(plain.maxScroll);
  expect(focused.maxScroll).toBe(plain.maxScroll);
  expect(hover.ansi).toContain("[ Pause ]");
  expect(focused.ansi).toContain("[ Pause ]");
  expect(plain.ansi).not.toContain("[ Pause ]");
  expect(plain.lines.join(" ")).not.toContain("Animated demo");
  expect(plain.lines.join(" ")).not.toContain("Replay");
});
