import { expect, test } from "bun:test";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { QuestionPicker } from "../../src/questions/picker";

const theme = { fg: (_: string, text: string) => text } as any;
function picker(title: string, labels: string[], size = 18) {
  let rows = size;
  const done: (string | undefined)[] = [];
  const p = new QuestionPicker(
    title,
    labels.map((label, i) => ({ value: String(i), label })),
    theme,
    getKeybindings(),
    (value) => done.push(value),
    () => {},
    () => rows,
  );
  return {
    p,
    done,
    resize: (height: number) => {
      rows = height;
    },
    frame: (width: number) => p.render(width).join("\n"),
  };
}

test("bounded frame; PgDn reaches title and selected label tails without changing selection", () => {
  const t = picker("TITLE-START " + "question words ".repeat(26) + "TITLE-END", [
    "LABEL-START " + "choice words ".repeat(32) + "LABEL-END",
    "other",
  ]);
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    const lines = t.p.render(24);
    expect(lines.length).toBeLessThanOrEqual(18);
    expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
    seen.add(lines.join("\n"));
    t.p.handleInput("[6~");
  }
  const all = [...seen].join("\n");
  expect(all).toContain("TITLE-START");
  expect(all).toContain("TITLE-END");
  expect(all).toContain("LABEL-START");
  expect(all).toContain("LABEL-END");
  expect(all).toContain("PgUp/PgDn");
  t.p.handleInput("\r");
  expect(t.done).toEqual(["0"]);
});

test("resize retains chosen item in visible list and clamps detail scroll", () => {
  const labels = Array.from({ length: 30 }, (_, i) => "ITEM-" + i);
  const t = picker("question ".repeat(30), labels, 20);
  for (let i = 0; i < 18; i++) t.p.handleInput("[B");
  t.p.handleInput("[6~");
  t.resize(9);
  expect(t.p.render(18).length).toBeLessThanOrEqual(9);
  expect(t.frame(18)).toContain("→ ITEM-18");
  t.resize(25);
  expect(t.frame(40)).toContain("→ ITEM-18");
  t.p.handleInput("\r");
  expect(t.done).toEqual(["18"]);
});

test("arrows, filtering and cancel keep menu semantics", () => {
  const t = picker("Pick", ["first choice", "second choice", "third choice"]);
  t.p.handleInput("[B");
  expect(t.frame(32)).toContain("→ second choice");
  t.p.handleInput("");
  expect(t.done).toEqual([undefined]);
  const f = picker("Pick", ["alpha", "beta", "gamma"]);
  f.p.handleInput("b");
  expect(f.frame(32)).toContain("→ beta");
  f.p.handleInput("\r");
  expect(f.done).toEqual(["1"]);
});

test("moderately long label tail remains visible at 48x18", () => {
  const t = picker("Select one", [
    "An intentionally long option that must remain fully readable even on a narrow choice label",
  ]);
  expect(t.frame(48)).toContain("narrow choice label");
});

test("changing choice or filter resets detail page, tiny screens retain selected item", () => {
  const t = picker("HEAD " + "long question ".repeat(25), ["FIRST " + "long label ".repeat(30), "SECOND"], 8);
  for (let i = 0; i < 20; i++) t.p.handleInput("\x1b[6~");
  t.p.handleInput("\x1b[B");
  expect(t.frame(20)).toContain("HEAD");
  t.resize(4);
  expect(t.frame(20)).toContain("→ SECOND");
  expect(t.p.render(20).length).toBeLessThanOrEqual(4);
  t.resize(18);
  for (const key of "SECOND") t.p.handleInput(key);
  expect(t.frame(20)).toContain("HEAD");
  expect(t.frame(20)).toContain("→ SECOND");
});
