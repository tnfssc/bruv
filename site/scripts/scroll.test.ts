import { expect, test } from "bun:test";
import { CellScroll, wheelPixels } from "../scroll";
import { layout } from "../layout";

test("pixel deltas accumulate, rather than three rows per event", () => {
  const input = new CellScroll();
  let row = 0;
  for (let i = 0; i < 17; i++) row = input.move(row, 1, 18, 100);
  expect(row).toBe(0);
  expect(input.move(row, 1, 18, 100)).toBe(1);
});

test("wheel deltas convert line and page units to pixels without rounding pixel units", () => {
  expect(wheelPixels(3, 1, 18, 40)).toBe(54);
  expect(wheelPixels(1, 2, 18, 40)).toBe(720);
  expect(wheelPixels(0.5, 0, 18, 40)).toBe(0.5);
});

test("horizontal input preserves accumulated vertical distance", () => {
  const input = new CellScroll();
  expect(input.move(5, 17, 18, 10)).toBe(5);
  expect(input.move(5, 0, 18, 10)).toBe(5);
  expect(input.move(5, 1, 18, 10)).toBe(6);
});

test("reversing direction discards the previous fractional row", () => {
  const input = new CellScroll();
  expect(input.move(6, 17, 18, 10)).toBe(6);
  expect(input.move(6, -18, 18, 10)).toBe(5);
});

test("scrolling beyond the bottom does not delay the next upward row", () => {
  const input = new CellScroll();
  expect(input.move(10, 9999, 18, 10)).toBe(10);
  expect(input.move(10, -18, 18, 10)).toBe(9);
});

test("navigation resets accumulated wheel distance", () => {
  const input = new CellScroll();
  expect(input.move(9, 17, 18, 10)).toBe(9);
  input.reset();
  expect(input.move(9, 1, 18, 10)).toBe(9);
});

test("row patches preserve complete ANSI output and fixed header rows", () => {
  const first = layout(144, 53, { scroll: 0, focus: -1 });
  const next = layout(144, 53, { scroll: 1, focus: -1 });
  expect(first.ansi).toBe("\x1b[?25l\x1b[?7l\x1b[H" + first.ansiRows.join("") + "\x1b[0m");
  expect(next.ansiRows.slice(0, 3)).toEqual(first.ansiRows.slice(0, 3));
  expect(next.ansiRows.some((r, i) => r !== first.ansiRows[i])).toBe(true);
});
