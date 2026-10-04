import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { launchBrowser } from "./browser";
import { build, textContent } from "./build";
import { cellRowHtml, cellStyle, escapeText } from "../html-cells";
import { demoIds, demoTranscript, demoDuration } from "../demos";
import { landing } from "../content";
import { FINAL_HOLD } from "../playback";

const origin = "https://bruv.test";
let browser: Browser;
beforeAll(async () => {
  await build();
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});
async function open(options: Parameters<Browser["newContext"]>[0] = {}, clock = false) {
  const context = await browser.newContext(options);
  await context.route(origin + "/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = Bun.file(new URL("../dist" + path, import.meta.url));
    if (await file.exists())
      await route.fulfill({ body: Buffer.from(await file.arrayBuffer()), contentType: file.type });
    else await route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  await page.goto(origin + "/text.html");
  if (options.javaScriptEnabled !== false) await page.locator(".demo-enhanced").first().waitFor();
  return { context, page };
}
const screenText = (page: Awaited<ReturnType<typeof open>>["page"], id = "delegate") =>
  page.locator('[data-demo="' + id + '"] .demo-screen').textContent();

describe("semantic HTML feature demos", () => {
  test("crawlable transcripts and RGB cell runs survive HTML escaping", () => {
    const html = textContent();
    for (const id of demoIds)
      expect(html).toContain('<pre class="demo-transcript">' + escapeText(demoTranscript(id)) + "</pre>");
    expect(html.match(/class="demo-toggle"/g)).toHaveLength(3);
    expect(html).not.toContain("not recorded model runs");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("Replay");
    expect(cellStyle("38;2;222;224;225;48;2;20;24;32")).toBe("color:rgb(222,224,225);background-color:rgb(20,24,32)");
    const runs = cellRowHtml([
      { text: "<", style: "38;2;1;2;3" },
      { text: "&", style: "38;2;1;2;3" },
      { text: "x", style: "38;2;4;5;6" },
    ]);
    expect(runs.match(/<span /g)).toHaveLength(2);
    expect(runs).toContain("&lt;&amp;");
    expect(textContent(false)).not.toContain('class="demo-screen"');
  });

  test("no JavaScript shows every complete transcript without controls", async () => {
    const { context, page } = await open({ javaScriptEnabled: false });
    try {
      for (const id of demoIds) {
        const figure = page.locator('[data-demo="' + id + '"]');
        expect(await figure.locator(".demo-transcript").textContent()).toBe(demoTranscript(id));
        expect(await figure.locator(".demo-transcript").isVisible()).toBe(true);
        expect(await figure.locator(".demo-screen").isVisible()).toBe(false);
        expect(await figure.locator("button").isVisible()).toBe(false);
      }
      expect(await page.locator("canvas").count()).toBe(0);
      expect(await page.getByRole("link", { name: "Install bruv" }).count()).toBe(1);
    } finally {
      await context.close();
    }
  }, 15000);

  test("DOM UI animates at stable height; pause, offscreen and hidden stop time", async () => {
    const { context, page } = await open();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const first = page.locator('[data-demo="delegate"]');
      await first.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const height = (await first.boundingBox())!.height;
      const start = await screenText(page);
      await page.waitForTimeout(400);
      expect(await screenText(page)).not.toBe(start);
      expect((await first.boundingBox())!.height).toBe(height);
      const button = first.locator("button");
      await button.focus();
      expect(await button.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      await page.keyboard.press("Enter");
      const paused = await screenText(page);
      await page.waitForTimeout(250);
      expect(await screenText(page)).toBe(paused);
      expect(await button.getAttribute("aria-label")).toStartWith("Resume");
      await page.keyboard.press("Space");
      await page.locator('[data-demo="wisdom"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const offscreen = await screenText(page);
      await page.waitForTimeout(250);
      expect(await screenText(page)).toBe(offscreen);
      await first.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const hidden = await screenText(page);
      await page.waitForTimeout(250);
      expect(await screenText(page)).toBe(hidden);
      await page.evaluate(() => {
        Reflect.deleteProperty(document, "hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(250);
      expect(await screenText(page)).not.toBe(hidden);
      expect(await page.locator("canvas").count()).toBe(0);
      expect(await first.locator(".demo-screen").getAttribute("aria-hidden")).toBe("true");
      expect(await first.locator(".demo-transcript").getAttribute("aria-hidden")).toBeNull();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 15000);

  test("shared playback loops only after the final hold", async () => {
    const { context, page } = await open({ viewport: { width: 1280, height: 1000 } }, true);
    try {
      const first = page.locator('[data-demo="delegate"]');
      await first.scrollIntoViewIfNeeded();
      // Let layout and the visibility observer settle before controlling time.
      await page.clock.runFor(160);
      await page.clock.runFor(demoDuration("delegate"));
      const final = await screenText(page);
      await page.clock.runFor(FINAL_HOLD - 500);
      expect(await screenText(page)).toBe(final);
      await page.clock.runFor(800);
      expect(await screenText(page)).not.toBe(final);
    } finally {
      await context.close();
    }
  }, 10000);

  test("reduced motion holds final UI until keyboard opt-in; touch control fits", async () => {
    const { context, page } = await open({
      reducedMotion: "reduce",
      viewport: { width: 320, height: 720 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const first = page.locator('[data-demo="delegate"]');
      await first.scrollIntoViewIfNeeded();
      const final = await screenText(page);
      await page.waitForTimeout(300);
      expect(await screenText(page)).toBe(final);
      const button = first.locator("button");
      expect(await button.getAttribute("aria-label")).toStartWith("Animate");
      expect(await button.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
      const geometry = await first.evaluate((el) => {
        const screen = el.querySelector<HTMLElement>(".demo-screen")!;
        const row = el.querySelector<HTMLElement>(".demo-row")!;
        const button = el.querySelector("button")!;
        const style = getComputedStyle(screen);
        return {
          available: screen.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          row: row.getBoundingClientRect().width,
          rowTop: row.getBoundingClientRect().top,
          buttonBottom: button.getBoundingClientRect().bottom,
        };
      });
      expect(geometry.available - geometry.row).toBeLessThan(10);
      expect(geometry.rowTop).toBeGreaterThan(geometry.buttonBottom);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await button.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
      expect(await screenText(page)).not.toBe(final);
      await page.keyboard.press("Space");
      const paused = await screenText(page);
      await page.waitForTimeout(200);
      expect(await screenText(page)).toBe(paused);
    } finally {
      await context.close();
    }
  }, 10000);
});
