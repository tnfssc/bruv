import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { registerFinishRender } from "../src/finish-render";
import type { Receipt } from "../src/receipt";
import { sdk } from "./sdk";

test("receipt frames counts, five checks and every gap within terminal width", async () => {
  initTheme("dark", false);
  const app = await sdk([registerFinishRender]);
  try {
    const runner = app.session.extensionRunner;
    const theme = runner.createContext().ui.theme;
    const data: Receipt = {
      asked: "request-781",
      checked: Array.from({ length: 7 }, (_, i) => `case-${i}`),
      gaps: ["missing-781", "broken-781"],
      failed: false,
      changes: { files: 6, added: 182, removed: 40 },
      scripts: 10,
      calls: 41,
      agents: 2,
      elapsedSeconds: 1380,
      weekPercent: 3,
    };
    const render = (width: number) =>
      runner
        .resolveToolRenderers("finish", () => undefined)
        ?.renderResult?.(
          { content: [], details: { status: "done", receipt: data } },
          { expanded: false, isPartial: false },
          theme,
          { args: {}, toolCallId: "receipt", expanded: false } as Parameters<
            NonNullable<ToolRenderers["renderResult"]>
          >[3],
        )
        ?.render(width) ?? [];
    const rows = render(100);
    const text = stripVTControlCharacters(rows.join("\n"));
    expect(rows[0]).toBe(theme.fg("accent", `╭${"─".repeat(98)}╮`));
    expect(text.match(/✓/g)).toHaveLength(5);
    expect(text.match(/✗/g)).toHaveLength(2);
    for (const value of [data.asked, ...data.checked.slice(0, 5), ...data.gaps]) expect(text).toContain(value);
    expect(text).not.toContain("case-5");
    expect(text.match(/\d+/g)?.map(Number)).toEqual([23, 41, 2, 3, 781, 0, 1, 2, 3, 4, 781, 781, 6, 182, 40]);
    for (const width of [1, 4, 12, 40, 100])
      expect(render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
    data.failed = true;
    expect(render(100).length).toBe(rows.length + 1);
    data.checked = ["\x1b]2;bad-title\x07wide 界 and\nnew line"];
    expect(render(30).some((line) => line.includes("\x1b]2;"))).toBe(false);
    expect(render(30).every((line) => visibleWidth(line) <= 30)).toBe(true);
  } finally {
    await app.close();
  }
});

test("finish wraps every gap, colors the count, and expands the raw note", async () => {
  initTheme("dark", false);
  const app = await sdk([registerFinishRender]);
  try {
    const runner = app.session.extensionRunner;
    const theme = runner.createContext().ui.theme;
    const gaps = [`case-781 ${"repeat ".repeat(20)}tail-781`, "case-782\nsecond-782"];
    const note = "raw-783";
    const render = (status: string, expanded = false, items = gaps) =>
      runner
        .resolveToolRenderers("finish", () => undefined)
        ?.renderResult?.(
          { content: [], details: { status, gaps: items, note } },
          { expanded, isPartial: false },
          theme,
          { args: {}, toolCallId: "finish", expanded } as Parameters<NonNullable<ToolRenderers["renderResult"]>>[3],
        )
        .render(40) ?? [];
    const rows = render("done");
    expect(rows[0]).toContain(theme.fg("error", stripVTControlCharacters(rows[0])));
    expect(stripVTControlCharacters(rows[0]).match(/\d+/g)).toEqual(["2"]);
    expect(stripVTControlCharacters(render("done", false, [gaps[0]])[0]).match(/\d+/g)).toEqual(["1"]);
    expect(rows.every((row) => visibleWidth(row) <= 40)).toBe(true);
    for (const value of ["case-781", "tail-781", "case-782", "second-782"]) expect(rows.join("\n")).toContain(value);
    expect(rows.join("\n")).not.toContain(note);
    expect(render("done", true).join("\n")).toContain(note);
    for (const status of ["need_you", "blocked"]) expect(render(status, false, []).join("\n")).toContain(note);
    expect(render("need_you", false, [])[0]).not.toBe(render("blocked", false, [])[0]);
  } finally {
    await app.close();
  }
});
