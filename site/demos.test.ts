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
  expect(demoTranscript("delegate")).toContain("review the diff before merging");
  const talking = text("background", 30, 9000);
  expect(talking).toContain("↗ Run import tests");
  expect(talking).toContain("While they run");
  expect(talking).toContain("1t");
  expect(text("background", 30, 21000)).toContain("✓ Run import tests");
  expect(demoTranscript("background")).toContain("Import tests passed");
  expect(text("wisdom", 30, 20000)).toContain("4 tools called ▸");
  expect(text("wisdom", 80, 15000)).toContain("Update wisdom/csv.md");
  expect(demoTranscript("wisdom")).toContain("keep memory bounded");
  expect(demoTranscript("wisdom")).toContain("Quoted newlines now pass");
});
