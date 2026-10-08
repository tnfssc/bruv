import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { layout } from "../layout";
import { siteContent } from "../content";
import { build } from "./build";
import { preview } from "./preview";
import { launchBrowser } from "./browser";
import type { Browser, Page } from "playwright-core";
const evidence = resolve(import.meta.dir, "../../artifacts/landing-page/install/regression");

async function ready(page: Page) {
  await page.locator('#terminal[data-ready="true"]').waitFor();
  await page.waitForTimeout(100);
}

async function checkCells(page: Page) {
  // Source-cell comparison excludes the intentional hover overlay.
  await page.mouse.move(3, 3);
  await page.waitForTimeout(40);
  const snap = await page.evaluate(() => {
    const t = (window as any).__terminal,
      h = document.querySelector<HTMLElement>("#terminal")!;
    const before = t.renderer.getCanvas().toDataURL();
    t.renderer.render(t.wasmTerm, true);
    return {
      data: { ...h.dataset },
      samePaint: before === t.renderer.getCanvas().toDataURL(),
      lines: Array.from({ length: t.rows }, (_, y) => t.buffer.active.getLine(y)?.translateToString(true)),
      cells: Array.from({ length: t.rows }, (_, y) =>
        Array.from({ length: t.cols }, (_, x) => {
          const c = t.buffer.active.getLine(y)?.getCell(x);
          return { glyph: c.getChars(), fg: c.getFgColor(), bg: c.getBgColor(), bold: c.isBold() };
        }),
      ),
      canvases: document.querySelectorAll("canvas").length,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  const d = snap.data,
    state = {
      scroll: Number(d.scroll),
      focus: -1,
      installCommand: d.installCommand,
      installUrl: d.installUrl,
      demos: JSON.parse(d.demos!),
    };
  let f = layout(Number(d.cols), Number(d.rows), state);
  state.focus = f.hits.findIndex((h) => h.label === d.focus);
  f = layout(Number(d.cols), Number(d.rows), state);
  assert.equal(snap.samePaint, true);
  assert.equal(snap.canvases, 1);
  assert.equal(snap.overflow, false);
  assert.deepEqual(
    snap.lines,
    f.ansiRows.map((row) => row.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd()),
  );
  let verified = 0;
  f.captures.forEach((capture) =>
    capture.rows.forEach((row, y) => {
      const ty = capture.y + y;
      if (ty < f.clip.top || ty >= f.clip.bottom) return;
      let x = capture.x;
      row.forEach((run) => {
        const fg = run.style.match(/38;2;(\d+);(\d+);(\d+)/)!,
          bg = run.style.match(/48;2;(\d+);(\d+);(\d+)/)!;
        for (const glyph of run.text) {
          const c = snap.cells[ty][x++];
          assert.equal(c.glyph || " ", glyph);
          assert.equal(c.fg, (+fg[1] << 16) | (+fg[2] << 8) | +fg[3]);
          assert.equal(c.bg, (+bg[1] << 16) | (+bg[2] << 8) | +bg[3]);
          verified++;
        }
      });
    }),
  );
  return { f, verified };
}

async function validateDesktopScrolling(page: Page) {
  await page.mouse.move(1250, 700);
  const tiny = [];
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 1);
    await page.waitForTimeout(25);
    tiny.push(Number(await page.locator("#terminal").getAttribute("data-scroll")));
  }
  assert.deepEqual(tiny, Array(12).fill(0));
  await page.keyboard.press("Home");
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const t = (window as any).__terminal,
      w = window as any;
    w.__writes = 0;
    const original = t.write.bind(t);
    t.write = (...args: any[]) => {
      w.__writes++;
      return original(...args);
    };
    for (let i = 0; i < 100; i++)
      document
        .querySelector("canvas")!
        .dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  const burst = await page.evaluate(() => ({
    writes: (window as any).__writes,
    scroll: Number(document.querySelector<HTMLElement>("#terminal")!.dataset.scroll),
  }));
  assert.deepEqual(burst, { writes: 1, scroll: 5 });
  const checked = await checkCells(page);
  assert(checked.verified > 0);
  await page.screenshot({ path: resolve(evidence, "desktop-scroll.png") });
  for (const key of ["PageDown", "End", "ArrowUp", "PageUp", "Home"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(50);
    await checkCells(page);
  }
  await page.keyboard.press("End");
  await page.waitForTimeout(70);
  await checkCells(page);
  await page.screenshot({ path: resolve(evidence, "desktop-end.png") });
  await page.keyboard.press("Home");
  await page.waitForTimeout(70);
  return { tiny, burst, desktopCaptureCells: checked.verified };
}

async function validateDesktopNavigation(page: Page, url: string, homeFrame: ReturnType<typeof layout>) {
  // Browser links are normal location navigation, exercised without leaving for the network.
  await page
    .context()
    .route(siteContent.repository + "**", (route) => route.fulfill({ body: "Repository destination" }));
  const h = homeFrame.hits.find((h) => h.action === "install")!;
  const metrics = await page.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  await page.mouse.click((h.x + 2) * Number(metrics.cellWidth), (h.y + 0.5) * Number(metrics.cellHeight));
  await page.waitForTimeout(100);
  assert(Number(await page.locator("#terminal").getAttribute("data-scroll")) > 0);
  await page.goto(url);
  await ready(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/text.html");
  await page.goto(url);
  await ready(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  assert(Number(await page.locator("#terminal").getAttribute("data-scroll")) > 0);
  await page.goto(url);
  await ready(page);
  await page.keyboard.press("Escape");
  await page.waitForURL("**/text.html");
  assert(await page.locator("h1").isVisible());
  return { mouseInstall: true, keyboardInstall: true, escape: true };
}

async function validateDesktop(page: Page, url: string) {
  const initial = await checkCells(page);
  await page.screenshot({ path: resolve(evidence, "desktop.png") });
  const scrolling = await validateDesktopScrolling(page);
  const navigation = await validateDesktopNavigation(page, url, initial.f);
  return { ...scrolling, ...navigation };
}

async function validateNarrowScreens(page: Page, url: string) {
  const results: Record<string, { cols: number; cells: number }> = {};
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url);
    await ready(page);
    const first = await checkCells(page);
    await page.screenshot({ path: resolve(evidence, "mobile-" + width + ".png") });
    for (let i = 0; i < Math.max(0, first.f.capture.y - 6); i++) await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);
    const c = await checkCells(page);
    assert(c.verified > 0);
    results["mobile" + width] = { cols: c.f.capture.cols, cells: c.verified };
    await page.screenshot({ path: resolve(evidence, "mobile-" + width + "-capture.png") });
    await page.keyboard.press("End");
    await page.waitForTimeout(70);
    await checkCells(page);
    await page.screenshot({ path: resolve(evidence, "mobile-" + width + "-end.png") });
  }
  return results;
}

async function validateTouchInput(page: Page) {
  // Real Chromium touch input, rather than synthetic pointer handlers.
  await page.keyboard.press("Home");
  await page.waitForTimeout(70);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 150, y: 650 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 150, y: 490 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);
  const touched = await checkCells(page);
  assert(touched.f.scroll > 0);
  await page.keyboard.press("Home");
  await page.waitForTimeout(80);
  const tapFrame = await checkCells(page);
  const source = tapFrame.f.hits.find((h) => h.action === siteContent.repository)!;
  const tapMetrics = await page.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  await page.context().route(siteContent.repository, (route) => route.fulfill({ body: "Source destination" }));
  const point = {
    x: (source.x + 2) * Number(tapMetrics.cellWidth),
    y: (source.y + 0.5) * Number(tapMetrics.cellHeight),
  };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForURL(siteContent.repository);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  return { touchScroll: touched.f.scroll, touchSource: true };
}

async function validateMobile(page: Page, url: string) {
  const narrow = await validateNarrowScreens(page, url);
  const touch = await validateTouchInput(page);
  await page.goto(url);
  await ready(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.keyboard.press("Home");
  await page.waitForTimeout(100);
  await checkCells(page);
  return { ...narrow, ...touch };
}

async function validateTextFallbacks(browser: Browser, url: string) {
  const nojs = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  await nojs.goto(url);
  assert(await nojs.locator("h1").isVisible());
  assert((await nojs.locator("pre").first().innerText()).includes("worktree"));
  assert.equal(await nojs.locator("img").count(), 1);
  assert.equal(await nojs.locator("h1 img").getAttribute("src"), "./assets/brand/bruv-wordmark-light.svg");
  assert.equal(await nojs.locator("h1").textContent(), "bruv");
  await nojs.close();
  const blocked = await browser.newPage();
  await blocked.route("**/*.wasm", (r) => r.abort());
  await blocked.goto(url);
  await blocked.locator("#text-content").waitFor();
  assert(await blocked.locator("h1").isVisible());
  await blocked.close();
  return { noJS: true };
}

await mkdir(evidence, { recursive: true });
await build("");
const server = preview(0),
  browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  await context.route("**/terminal.js", async (route) => {
    const response = await route.fetch(),
      source = await response.text();
    const hook = /([\w$]+)\.open\(([\w$]+)\),(?=\1\.write)/;
    const start = source.lastIndexOf(".open(") - 30;
    const tail = source.slice(start);
    assert(hook.test(tail), "Terminal inspection hook");
    await route.fulfill({
      response,
      body: source.slice(0, start) + tail.replace(hook, "$1.open($2),window.__terminal=$1,"),
    });
  });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(server.url.href);
  await ready(page);
  const desktop = await validateDesktop(page, server.url.href);
  const mobile = await validateMobile(page, server.url.href);
  const fallback = await validateTextFallbacks(browser, server.url.href);
  assert.deepEqual(errors, []);
  const results = { ...desktop, ...mobile, ...fallback, errors };
  await Bun.write(resolve(evidence, "checks.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.stop(true);
}
