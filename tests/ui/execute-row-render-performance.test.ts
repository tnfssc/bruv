import { expect, spyOn, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";
import { executeOutputPreview, type ExecutePreviewState } from "../../src/ui/execution-previews";

const theme = { fg: (_color: string, text: string) => "\x1b[36m" + text + "\x1b[39m" } as Theme;
function clean(text: string) {
  return tui
    .stripTerminalSequences(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\p{Cc}/gu, (c) => (c === "\n" ? "\n" : ""));
}
// Prior expanded renderer: the same pinned native wrapping, followed by native
// clipping of every decorated row. This oracle includes oversized graphemes.
function prior(source: string, output: string, width: number, warning: boolean) {
  if (width < 1) return [];
  const wrap = (text: string) => (text ? tui.wrapTextWithAnsi(clean(text), width) : []);
  const rows = [
    theme.fg("toolTitle", "Execute · TypeScript"),
    ...wrap(source).map((row) => theme.fg("muted", row)),
    "",
    ...wrap(output),
  ];
  if (warning) rows.push(theme.fg("warning", "… execute could not save all output"));
  return rows.map((row) => tui.truncateToWidth(row, width));
}

test("expanded execute rows equal prior native clipping, including narrow Unicode and terminal controls", () => {
  const texts = [
    "",
    "short",
    "word ".repeat(80),
    "x".repeat(4096),
    "界🙂👩🏽‍💻é ".repeat(100),
    "क्".repeat(20) + "क",
    "กํา",
    "ﾊﾞ",
    "\x1b[31mcolored\x1b[0m\tline\r\nnext\x1b]8;;https://example.test\x07link\x1b]8;;\x07",
    "first\n\nlast\n",
    "before\x00\x08after",
  ];
  for (const text of texts)
    for (const width of [0, 1, 2, 3, 12, 48, 100])
      for (const warning of [false, true]) {
        const source = "// " + text;
        const output = "output\n" + text;
        const result = {
          content: [{ type: "text", text: output }],
          details: { exitCode: 0, ...(warning ? { outputArtifactErrors: { stdout: "ENOSPC" } } : {}) },
        };
        expect(executeOutputPreview(result, true, false, theme, source).render(width)).toEqual(
          prior(source, output, width, warning),
        );
      }
});

test("fitting expanded rows avoid prefix reconstruction; oversized rows still use native clipping", () => {
  const text = "界🙂👩🏽‍💻é ".repeat(1000);
  const result = { content: [{ type: "text", text }], details: { exitCode: 0 } };
  const clip = spyOn(tui, "truncateToWidth");
  try {
    const expected = prior(text, text, 100, false);
    expect(clip.mock.calls).toHaveLength(expected.length);
    clip.mockClear();
    const preview = executeOutputPreview(result, true, false, theme, text);
    const rows = preview.render(100);
    expect(rows).toEqual(expected);
    expect(rows.length).toBeGreaterThan(100);
    expect(clip.mock.calls).toHaveLength(0); // formerly one native truncation per row
    expect(preview.render(100)).toBe(rows);
    expect(clip.mock.calls).toHaveLength(0);
    preview.render(1);
    expect(clip.mock.calls.length).toBeGreaterThan(0);
    for (const row of preview.render(1)) expect(tui.visibleWidth(row)).toBeLessThanOrEqual(1);
  } finally {
    clip.mockRestore();
  }
});

test("settled caching does not hide replacements, partial results, expansion or artifact warnings", () => {
  const state: ExecutePreviewState = {};
  const result = (text: string, exitCode = 0, warning = false) => ({
    content: [{ type: "text", text }],
    details: { exitCode, ...(warning ? { outputArtifactErrors: { stdout: "ENOSPC" } } : {}) },
  });
  const strip = (rows: string[]) => rows.map(tui.stripTerminalSequences).join("\n");
  const first = executeOutputPreview(result("FIRST"), true, false, theme, "source", state);
  expect(strip(first.render(48))).toContain("FIRST");
  const latest = executeOutputPreview(result("LATEST", 1, true), true, true, theme, "new source", state);
  expect(strip(latest.render(48))).toContain("LATEST");
  expect(strip(latest.render(48))).not.toContain("FIRST");
  expect(strip(latest.render(48))).toContain("could not save all output");
  expect(
    strip(
      executeOutputPreview(result("LATEST", 1, true), false, true, theme, "new source", state, 0, "Inspect").render(
        100,
      ),
    ),
  ).toContain("✗ Inspect");
  expect(
    strip(
      executeOutputPreview(result("partial"), false, false, theme, "source", state, 0, "Running", true).render(100),
    ),
  ).toContain("Running");
  first.invalidate();
  expect(strip(first.render(48))).toContain("FIRST");
});
