import { describe, expect, test } from "bun:test";
import { siteMetadata, textContent } from "./build";
import { layout, hitAt, wrap } from "../layout";
import { wordmark } from "../brand";
import { siteContent, landing } from "../content";
import { settingsCapture, type Run } from "../capture";
import { demoIds, demoFrame, demoDuration, demoTranscript } from "../demos";
import { advance, inView } from "../playback";
import data from "../assets/settings-cells.json";
import { createHash } from "node:crypto";
describe("single terminal landing", () => {
  test("SVG-derived wordmark fits desktop and mobile terminal cells", () => {
    for (const width of [25, 28, 34, 48, 100]) {
      const rows = wordmark(width);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.join("")).toMatch(/[█▀▄]/);
      for (const row of rows) expect([...row].length).toBeLessThanOrEqual(width);
    }
  });
  test("metadata requires a configured origin", () => {
    expect(siteMetadata()).toEqual({ html: "", sitemap: "", robots: "" });
    const m = siteMetadata("https://example.test/bruv");
    expect(m.html).toContain('href="https://example.test/bruv/"');
    expect(m.html).toContain('property="og:image" content="https://example.test/bruv/assets/brand/bruv-social.png"');
    expect(m.html).toContain('property="og:image:width" content="1200"');
    expect(m.html).toContain('property="og:image:height" content="630"');
    expect(siteMetadata("https://example.test/bruv", "text.html").html).toContain(
      "https://example.test/bruv/assets/brand/bruv-social.png",
    );
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
      expect(a.hits.some((h) => h.action === "install")).toBe(true);
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
      expect(f.lines.join(" ")).not.toContain("Scripted demos");
      expect(f.hits.find((h) => h.action === "text")?.y).toBe(1);
      expect(f.ansi).not.toContain("scroll / swipe");
      expect(f.captures).toHaveLength(3);
    }
  });
  test("each demo has distinct, bounded, stable cell frames", () => {
    for (const width of [27, 29, 37, 56, 68])
      for (const id of demoIds) {
        const first = demoFrame(id, width, 0);
        const texts = new Set<string>();
        for (let elapsed = 0; elapsed <= demoDuration(id); elapsed += 200) {
          const frame = demoFrame(id, width, elapsed);
          expect(frame.rows.length).toBe(first.rows.length);
          for (const row of frame.rows) {
            expect(row.length).toBe(width);
            expect(row.every((c) => [...c.text].length === 1 && !/[\x00-\x1f]/.test(c.text))).toBe(true);
            expect(row.every((c) => c.style.includes("38;2;") && c.style.includes("48;2;"))).toBe(true);
          }
          texts.add(
            frame.rows
              .flat()
              .map((c) => c.text)
              .join(""),
          );
        }
        expect(texts.size).toBeGreaterThan(5);
        expect(demoTranscript(id).length).toBeGreaterThan(100);
      }
  });
  test("playback never shifts subsequent sections", () => {
    for (const cols of [35, 44, 100, 149]) {
      const positions = (ms: number) =>
        layout(cols, 50, {
          scroll: 0,
          focus: -1,
          demos: Object.fromEntries(demoIds.map((id) => [id, { elapsed: ms, paused: false }])) as any,
        }).captures.map((c) => c.y);
      const first = positions(0);
      for (let ms = 500; ms <= 21000; ms += 500) expect(positions(ms)).toEqual(first);
    }
  });
  test("playback freezes outside viewport and when paused, then holds before looping", () => {
    const p = { elapsed: 0, paused: false };
    advance(p, 100, 1000, false);
    expect(p.elapsed).toBe(0);
    advance(p, 100, 1000, true);
    expect(p.elapsed).toBe(100);
    p.paused = true;
    advance(p, 100, 1000, true);
    expect(p.elapsed).toBe(100);
    p.paused = false;
    advance(p, 2000, 1000, true);
    expect(p.elapsed).toBe(2100);
    expect(inView(30, 23, 3, 32)).toBe(false);
    expect(inView(20, 23, 3, 32)).toBe(false);
    expect(inView(6, 23, 3, 32)).toBe(true);
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
    expect(html).toContain(landing.titleTail);
    expect(html).toContain(landing.intro);
    expect(html).not.toContain("not recorded model runs");
    for (const id of demoIds) expect(html).toContain(demoTranscript(id).split("\n")[0]);
    expect(html).not.toContain("Auto-compact");
    expect(html).toContain(siteContent.install);
    expect(html).toContain(landing.installNote);
    expect(html).toContain(landing.requirements);
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain('class="brand-wordmark"');
    expect(html).toContain('<span class="sr-only">Bruv</span>');
    expect(html).toContain('src="./assets/brand/bruv-wordmark-light.svg"');
    expect(html).not.toContain("#gallery");
    for (const feature of landing.features) expect(html).toContain(feature.text);
    expect(wrap("a".repeat(40), 12).every((s) => s.length <= 12)).toBe(true);
  });
});
