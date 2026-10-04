import { describe, expect, test } from "bun:test";
import { siteMetadata } from "./build";
import { layout, hitAt, wrap } from "../layout";
import { siteContent } from "../content";
describe("static terminal website", () => {
  test("metadata requires a real configured origin", () => {
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
  test("all pages reflow into real cell bounds and click regions", () => {
    for (const [cols, rows] of [
      [39, 40],
      [49, 45],
      [80, 30],
      [149, 47],
    ])
      for (const page of siteContent.pages) {
        const f = layout(cols, rows, { route: page.id, scroll: 999, focus: -1 });
        expect(f.ansi).toContain("\x1b[");
        expect(f.scroll).toBe(f.maxScroll);
        for (const h of f.hits) {
          expect(h.x + h.width).toBeLessThan(cols);
          expect(h.y).toBeLessThan(rows);
          expect(hitAt(f.hits, h.x, h.y)).toBeGreaterThanOrEqual(0);
          expect(hitAt(f.hits, h.x + h.width, h.y)).not.toBe(f.hits.indexOf(h));
        }
      }
  });
  test("hero images occupy reserved cells and scroll with clipped hits", () => {
    for (const cols of [35, 43, 80, 144]) {
      const initial = layout(cols, 54, { route: "overview", scroll: 0, focus: -1 }, 0.56);
      expect(initial.images[0]?.id).toBe("settings");
      const img = initial.images[0];
      expect(img.x + img.width).toBeLessThan(cols);
      const next = layout(cols, 54, { route: "overview", scroll: 1, focus: -1 }, 0.56);
      expect(next.images[0].y).toBe(img.y - 1);
      const clipped = layout(cols, 54, { route: "overview", scroll: img.y, focus: -1 }, 0.56);
      const hit = clipped.hits.find((h) => h.label === "Open settings capture");
      if (hit) {
        expect(hit.y).toBeGreaterThanOrEqual(clipped.clip.top);
        expect(hit.y + hit.height).toBeLessThanOrEqual(clipped.clip.bottom);
      }
      expect(initial.hits.some((h) => h.action === "#install")).toBe(true);
      expect(initial.hits.some((h) => h.action === siteContent.repository)).toBe(true);
    }
  });
  test("long URLs wrap, and unknown hash returns overview", () => {
    expect(wrap("a".repeat(40), 12).every((s) => s.length <= 12)).toBe(true);
    expect(layout(80, 30, { route: "invalid", scroll: 0, focus: -1 }).route).toBe("overview");
  });
});
