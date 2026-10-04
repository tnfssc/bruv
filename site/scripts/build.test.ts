import { describe, expect, test } from "bun:test";
import { siteMetadata, textContent } from "./build";
import { layout, hitAt, wrap } from "../layout";
import { siteContent, landing } from "../content";
import { settingsCapture, type Run } from "../capture";
import data from "../assets/settings-cells.json";
import { createHash } from "node:crypto";
describe("single terminal landing", () => {
  test("metadata requires a configured origin", () => {
    expect(siteMetadata()).toEqual({ html: "", sitemap: "", robots: "" });
    const m = siteMetadata("https://example.test/bruv");
    expect(m.html).toContain('href="https://example.test/bruv/"');
    expect(m.sitemap).toContain("https://example.test/bruv/text.html");
    expect(m.robots).toContain("https://example.test/bruv/sitemap.xml");
    for (const url of [
      "file:///tmp/site",
      "javascript:alert(1)",
      "https://a:b@example.test",
      "https://example.test/?q=1",
      "https://example.test/#x",
    ])
      expect(() => siteMetadata(url)).toThrow();
  });
  test("one page reflows with in-bounds links and capture cells", () => {
    for (const [cols, rows] of [
      [38, 40],
      [46, 52],
      [80, 30],
      [149, 53],
    ]) {
      for (const scroll of [0, 1, 20, 999]) {
        const f = layout(cols, rows, { scroll, focus: -1 });
        expect(f.ansi).toContain("\x1b[");
        expect(f.capture.x + f.capture.cols).toBeLessThan(cols);
        for (const h of f.hits) {
          expect(h.x + h.width).toBeLessThan(cols);
          expect(h.y).toBeLessThan(rows);
          expect(hitAt(f.hits, h.x, h.y)).toBeGreaterThanOrEqual(0);
          expect(hitAt(f.hits, h.x + h.width, h.y)).not.toBe(f.hits.indexOf(h));
          expect(h.action.startsWith("#")).toBe(false);
        }
      }
      const a = layout(cols, rows, { scroll: 0, focus: -1 });
      const b = layout(cols, rows, { scroll: 1, focus: -1 });
      expect(b.capture.y).toBe(a.capture.y - 1);
      expect(a.hits.some((h) => h.action === siteContent.install)).toBe(true);
    }
  });
  test("capture is actual glyph/style runs, not a reserved image rectangle", () => {
    for (const width of [32, 40, 72, 110]) {
      const c = settingsCapture(width);
      expect(c.cols).toBeLessThanOrEqual(width);
      expect(c.rows.flat().some((r) => r.text.trim())).toBe(true);
      expect(c.rows.flat().every((r) => r.style.includes("38;2;"))).toBe(true);
      for (const row of c.rows) expect(row.reduce((n, r) => n + [...r.text].length, 0)).toBe(c.cols);
      const f = layout(width + 6, 100, { scroll: 0, focus: -1 });
      expect(f.ansi).toContain("Auto-compact");
    }
  });
  test("narrow reflow retains every source glyph and its style", async () => {
    const visible = (rows: Run[][]) =>
      rows.flatMap((row) => row.flatMap((run) => [...run.text].filter((c) => c.trim()).map((c) => [c, run.style])));
    for (const width of [29, 32, 37, 48, 56]) expect(visible(settingsCapture(width).rows)).toEqual(visible(data.rows));
    const raw = await Bun.file(new URL("../assets/cli-settings.txt", import.meta.url)).text();
    expect(createHash("sha256").update(raw).digest("hex")).toBe(data.sha256);
    expect(raw).toContain("\x1b[");
  });
  test("semantic HTML is the same concise page, without gallery or route app", () => {
    const html = textContent();
    expect(html).toContain(landing.title);
    expect(html).toContain(landing.intro);
    expect(html).toContain("Auto-compact");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("#gallery");
    for (const feature of landing.features) expect(html).toContain(feature.text);
    expect(wrap("a".repeat(40), 12).every((s) => s.length <= 12)).toBe(true);
  });
});
