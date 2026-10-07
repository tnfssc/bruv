import { expect, test } from "bun:test";
import { demoDuration, demoFrame, demoHeight, demoIds, demoTranscript } from "./demos";
import { layout } from "./layout";
import { advance, FINAL_HOLD, inView } from "./playback";

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

test("delegation types the request, launches a helper, and asks for branch review", () => {
  expect(text("delegate", 80, 1800).length).toBeGreaterThan(text("delegate", 80, 800).length);
  expect(text("delegate", 80, 5000)).toContain("1 tool called ▸ · Delegate CSV fix");
  expect(text("delegate", 30, 8000)).toContain("↗ Fix CSV import");
  expect(text("delegate", 30, 20000)).toContain("1 tool called ▸");
  expect(demoTranscript("delegate")).toContain("Review its branch before merging");
});

test("background work leaves room for conversation and reports the result", () => {
  const talking = text("background", 30, 9000);
  expect(talking).toContain("↗ Run import tests");
  expect(talking).toContain("While they run");
  expect(talking).toContain("1t");
  expect(text("background", 30, 21000)).toContain("✓ Run import tests");
  expect(demoTranscript("background")).toContain("Import tests passed");
});

test("wisdom reuse shows the file update and carries the lesson into the result", () => {
  expect(text("wisdom", 30, 20000)).toContain("4 tools called ▸");
  expect(text("wisdom", 80, 15000)).toContain("Update wisdom/csv.md");
  expect(demoTranscript("wisdom")).toContain("limit memory use");
  expect(demoTranscript("wisdom")).toContain("Added the quoted-newline test");
});

test("one turn summary stays before interleaved prose and shows the latest action only while busy", () => {
  const working = text("wisdom", 80, 11200);
  expect(working.match(/tools? called ▸/g)).toHaveLength(1);
  expect(working).toContain("3 tools called ▸ · Run import tests");
  expect(working.indexOf("3 tools called")).toBeLessThan(working.indexOf("The notes say"));
  expect(working).not.toContain("Add quoted-newline test");
  const finished = text("wisdom", 80, demoDuration("wisdom"));
  expect(finished.match(/tools? called ▸/g)).toHaveLength(1);
  expect(finished).toContain("4 tools called ▸");
  expect(finished).not.toContain("4 tools called ▸ ·");
  expect(finished.indexOf("4 tools called")).toBeLessThan(finished.indexOf("The notes say"));
});

test("footer compacts and highlights active tasks, then clears them on completion", () => {
  for (const cols of [30, 80]) {
    const active = demoFrame("background", cols, 9000).rows[demoHeight(cols) - 1];
    const label = cols === 30 ? "1t" : "1 task";
    const footerText = active.map((cell) => cell.text).join("");
    expect(footerText).toContain(label);
    expect(footerText).toContain("studio");
    const start = footerText.indexOf(label);
    const taskStyle = active[start].style;
    expect(taskStyle).not.toBe(active[start + label.length].style);
    for (const cell of active.slice(start, start + label.length)) expect(cell.style).toBe(taskStyle);
    const finished = demoFrame("background", cols, demoDuration("background")).rows.at(-1)!;
    expect(finished.map((cell) => cell.text).join("")).not.toContain(label);
    expect(finished.every((cell) => cell.style === finished[0].style)).toBe(true);
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
