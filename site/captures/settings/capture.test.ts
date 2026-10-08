import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { settingsCapture, type Run } from "./cells";
import data from "./settings-cells.json";

describe("historical settings capture", () => {
  test("capture is glyph/style runs, not a reserved image rectangle", () => {
    for (const width of [32, 40, 72, 110]) {
      const c = settingsCapture(width);
      expect(c.cols).toBeLessThanOrEqual(width);
      expect(c.rows.flat().some((r) => r.text.trim())).toBe(true);
      expect(c.rows.flat().every((r) => r.style.includes("38;2;"))).toBe(true);
      for (const row of c.rows) expect(row.reduce((n, r) => n + [...r.text].length, 0)).toBe(c.cols);
    }
  });
  test("narrow reflow retains every source glyph and its style", async () => {
    const visible = (rows: Run[][]) =>
      rows.flatMap((row) => row.flatMap((run) => [...run.text].filter((c) => c.trim()).map((c) => [c, run.style])));
    for (const width of [29, 32, 37, 48, 56]) expect(visible(settingsCapture(width).rows)).toEqual(visible(data.rows));
    const raw = await Bun.file(new URL("./cli-settings.txt", import.meta.url)).text();
    expect(createHash("sha256").update(raw).digest("hex")).toBe(data.sha256);
    expect(raw).toContain("\x1b[");
  });
});
