import assert from "node:assert/strict";
import { layout } from "../layout";
import { build } from "./build";
import { preview } from "./preview";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { launchBrowser } from "./browser";
const phase = process.env.PHASE || "after";
const evidence = resolve(import.meta.dir, "../../wisdom/landing-page/validation/scroll");
await mkdir(evidence, { recursive: true });
if (!process.env.PREVIEW_URL) await build("");
const server = process.env.PREVIEW_URL ? undefined : preview(0);
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Probe only: expose the real bundled terminal; do not ship instrumentation.
  await page.route("**/terminal.js", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const hook = /([\w$]+)\.open\(([\w$]+)\),(?=\1\.write)/;
    if (!hook.test(source)) throw new Error("Probe hook missing");
    await route.fulfill({ response, body: source.replace(hook, "$1.open($2),window.__terminal=$1,") });
  });
  await page.goto(process.env.PREVIEW_URL || server!.url.href);
  await page.locator('#terminal[data-ready="true"]').waitFor();
  await page.waitForTimeout(100);
  await page.mouse.move(1100, 600);
  await page.evaluate(() => {
    const w = window as any,
      t = w.__terminal;
    const m: any = (w.__metrics = {
      writes: [],
      paints: [],
      images: 0,
      imageBeforeText: 0,
      allocations: 0,
      wheels: [],
      samples: [],
    });
    const write = t.write.bind(t);
    t.write = (data: any, cb: any) => {
      const start = performance.now();
      write(data, cb);
      m.writes.push({ at: start, ms: performance.now() - start, bytes: data.length });
    };
    const render = t.renderer.render.bind(t.renderer);
    t.renderer.render = (...args: any[]) => {
      const start = performance.now();
      render(...args);
      m.paints.push({
        at: start,
        ms: performance.now() - start,
        scroll: document.querySelector<HTMLElement>("#terminal")!.dataset.scroll,
      });
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (this.canvas.classList.contains("terminal-image-plane")) {
        m.images++;
        if (m.writes.length && m.paints.at(-1)?.at < m.writes.at(-1).at) m.imageBeforeText++;
      }
      return (draw as any).apply(this, args);
    };
    for (const key of ["width", "height"]) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key)!;
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        ...d,
        set(v) {
          if (this.classList.contains("terminal-image-plane")) m.allocations++;
          d.set!.call(this, v);
        },
      });
    }
    window.addEventListener(
      "wheel",
      (e) => {
        const at = performance.now();
        queueMicrotask(() => m.wheels.push({ at, dy: e.deltaY, mode: e.deltaMode, prevented: e.defaultPrevented }));
      },
      { passive: true, capture: true },
    );
    const sample = () => {
      const h = document.querySelector<HTMLElement>("#terminal")!;
      m.samples.push({
        at: performance.now(),
        scroll: Number(h.dataset.scroll),
        placements: document.querySelector<HTMLElement>(".terminal-image-plane")!.dataset.placements,
      });
      w.__sample = requestAnimationFrame(sample);
    };
    sample();
  });
  const scroll = () => page.locator("#terminal").getAttribute("data-scroll").then(Number);
  const results: any = { phase, browser: browser.version(), errors };
  // Trusted Chromium wheel input, not route changes or only dispatched DOM events.
  const deltas = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  results.tiny = [];
  for (const dy of deltas) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(20);
    results.tiny.push(await scroll());
  }
  await page.screenshot({ path: resolve(evidence, phase + "-tiny.png") });
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  results.motion = [];
  for (const [i, dy] of [24, 24, 24, 24, -24, -24, -24, -24].entries()) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(20);
    results.motion.push(await scroll());
    if (i === 2 || i === 5) await page.screenshot({ path: resolve(evidence, phase + "-motion-" + i + ".png") });
  }
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  const start = await page.evaluate(() => {
    const m = (window as any).__metrics;
    return { writes: m.writes.length, images: m.images, allocations: m.allocations };
  });
  // A single task models high-rate events arriving before the next paint.
  await page.evaluate(() => {
    const c = document.querySelector(".ghostty-cells")!;
    for (let i = 0; i < 100; i++)
      c.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(120);
  results.burst = await page.evaluate((start) => {
    const m = (window as any).__metrics;
    return {
      scroll: Number(document.querySelector<HTMLElement>("#terminal")!.dataset.scroll),
      writes: m.writes.length - start.writes,
      images: m.images - start.images,
      allocations: m.allocations - start.allocations,
    };
  }, start);
  results.metrics = await page.evaluate(() => {
    cancelAnimationFrame((window as any).__sample);
    return (window as any).__metrics;
  });
  if (phase === "after") {
    assert.deepEqual(errors, []);
    assert.equal(results.burst.writes, 1);
    assert.equal(results.metrics.imageBeforeText, 0);
    assert.equal(results.burst.allocations, 0);
    assert.equal(results.burst.scroll, 5);
    assert.deepEqual(results.tiny, Array(12).fill(0));
    assert.deepEqual(results.motion, [1, 2, 3, 5, 4, 3, 2, 0]);
    async function assertView(p = page) {
      const snapshot = await p.evaluate(() => {
        const t = (window as any).__terminal,
          h = document.querySelector<HTMLElement>("#terminal")!;
        const plane = document.querySelector<HTMLCanvasElement>(".terminal-image-plane")!;
        const ctx = plane.getContext("2d")!,
          dpr = devicePixelRatio;
        const placements = JSON.parse(plane.dataset.placements!);
        const cellCanvas = t.renderer.getCanvas();
        const beforeFullPaint = cellCanvas.toDataURL();
        t.renderer.render(t.wasmTerm, true);
        const afterFullPaint = cellCanvas.toDataURL();
        const sameAsFullPaint = beforeFullPaint === afterFullPaint;
        const ch = Number(h.dataset.cellHeight),
          cw = Number(h.dataset.cellWidth);
        return {
          data: { ...h.dataset },
          sameAsFullPaint,
          beforeFullPaint,
          afterFullPaint,
          placements,
          lines: Array.from({ length: t.rows }, (_, i) => t.buffer.active.getLine(i)?.translateToString(true)),
          imagePixels: placements.map(
            (im: any) =>
              ctx.getImageData(Math.floor((im.x + 1) * cw * dpr), Math.floor(Math.max(7, im.y + 1) * ch * dpr), 1, 1)
                .data[3],
          ),
          plane: [plane.width, plane.height],
          cells: [t.renderer.getCanvas().width, t.renderer.getCanvas().height],
        };
      });
      const d = snapshot.data;
      const state = { route: d.route!, scroll: Number(d.scroll), focus: -1 };
      let expected = layout(Number(d.cols), Number(d.rows), state, Number(d.cellWidth) / Number(d.cellHeight));
      state.focus = expected.hits.findIndex((h) => h.label === d.focus);
      expected = layout(Number(d.cols), Number(d.rows), state, Number(d.cellWidth) / Number(d.cellHeight));
      if (!snapshot.sameAsFullPaint) {
        console.log("Paint mismatch", snapshot.data);
        for (const key of ["beforeFullPaint", "afterFullPaint"] as const)
          await Bun.write(resolve(evidence, key + ".png"), Buffer.from(snapshot[key].split(",")[1], "base64"));
      }
      assert.equal(snapshot.sameAsFullPaint, true, "Dirty terminal canvas matches a forced full paint");
      assert.deepEqual(snapshot.placements, expected.images);
      assert.deepEqual(snapshot.plane, snapshot.cells);
      const lines = expected.ansiRows.map((row) => row.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd());
      assert.deepEqual(snapshot.lines, lines, "Dirty rows agree with the full terminal layout");
      assert.ok(snapshot.imagePixels.every((a: number) => a === 255));
    }
    await assertView();
    await page.keyboard.press("Home");
    await page.waitForTimeout(60);
    for (const [mode, delta, expected] of [
      [1, 2, 2],
      [2, 1, 32],
      [0, -9999, 0],
    ]) {
      const prevented = await page.evaluate(
        ({ mode, delta }) => {
          const e = new WheelEvent("wheel", { deltaY: delta, deltaMode: mode, bubbles: true, cancelable: true });
          document.querySelector(".ghostty-cells")!.dispatchEvent(e);
          return e.defaultPrevented;
        },
        { mode, delta },
      );
      assert.equal(prevented, true);
      await page.waitForTimeout(60);
      assert.equal(await scroll(), expected);
      await assertView();
    }
    const horizontal = await page.evaluate(() => {
      const c = document.querySelector(".ghostty-cells")!;
      c.dispatchEvent(new WheelEvent("wheel", { deltaX: 120, bubbles: true, cancelable: true }));
      const e = new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true });
      c.dispatchEvent(e);
      return e.defaultPrevented;
    });
    assert.equal(horizontal, false);
    await page.waitForTimeout(40);
    assert.equal(await scroll(), 0);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(60);
    assert.equal(await scroll(), 1);
    await assertView();
    await page.keyboard.press("End");
    await page.waitForTimeout(60);
    await assertView();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      await page.waitForTimeout(100);
      await assertView();
    }
    await page.keyboard.press("Home");
    await page.waitForTimeout(60);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    await assertView();
    // Trusted touch events through Chromium's input pipeline at DPR2.
    const mobile = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      viewport: { width: 390, height: 700 },
      reducedMotion: "reduce",
    });
    const touch = await mobile.newPage();
    await touch.route("**/terminal.js", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          /([\w$]+)\.open\(([\w$]+)\),(?=\1\.write)/,
          "$1.open($2),window.__terminal=$1,",
        ),
      });
    });
    await touch.goto(process.env.PREVIEW_URL || server!.url.href);
    await touch.locator('#terminal[data-ready="true"]').waitFor();
    const session = await mobile.newCDPSession(touch);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 180, y: 470 }] });
    for (const y of [465, 460, 450, 430, 410, 390, 370, 350, 330, 310])
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 180, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.waitForTimeout(80);
    results.touchScroll = Number(await touch.locator("#terminal").getAttribute("data-scroll"));
    assert.equal(
      results.touchScroll,
      Math.floor(160 / Number(await touch.locator("#terminal").getAttribute("data-cell-height"))),
    );
    await assertView(touch);
    await touch.screenshot({ path: resolve(evidence, "after-touch.png") });
    assert.equal(new URL(touch.url()).hash, ""); // A swipe must not also activate a link.
    const td = await touch.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
    const th = layout(Number(td.cols), Number(td.rows), {
      route: td.route!,
      scroll: Number(td.scroll),
      focus: -1,
    }).hits.find((h) => h.action === "#gallery")!;
    await touch.touchscreen.tap((th.x + 1) * Number(td.cellWidth), (th.y + 0.5) * Number(td.cellHeight));
    await touch.waitForURL("**/#gallery");
    await touch.waitForTimeout(80);
    await assertView(touch);
    const pd = await page.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
    const install = layout(Number(pd.cols), Number(pd.rows), {
      route: pd.route!,
      scroll: Number(pd.scroll),
      focus: -1,
    }).hits.find((h) => h.action === "#install")!;
    await page.mouse.click((install.x + 1) * Number(pd.cellWidth), (install.y + 0.5) * Number(pd.cellHeight));
    await page.waitForURL("**/#install");
    await page.locator('#terminal[data-route="install"]').waitFor();
    await assertView();
    await page.keyboard.press("a");
    await page.waitForURL("**/text.html#install");
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const plain = await nojs.newPage();
    await plain.goto(process.env.PREVIEW_URL || server!.url.href);
    assert.ok(await plain.locator("#text-content").isVisible());
    const blocked = await context.newPage();
    await blocked.route("**/*.wasm", (route) => route.abort());
    await blocked.goto(process.env.PREVIEW_URL || server!.url.href);
    await blocked.getByText("The terminal could not load. This HTML view has the same content and links.").waitFor();
    assert.ok(await blocked.locator("#text-content").isVisible());
    await page.goto((process.env.PREVIEW_URL || server!.url.href) + "text.html#overview");
    assert.ok(await page.locator("main").isVisible());
    results.checks = [
      "row patch/full layout parity",
      "image pixels/placements and resize",
      "pixel/line/page/horizontal/ctrl wheel",
      "keyboard navigation",
      "DPR2 touch swipe and tap",
      "reduced motion",
      "semantic HTML",
      "mouse install and route-preserving HTML escape",
      "no-JS and blocked-WASM fallbacks",
    ];
  }
  await Bun.write(resolve(evidence, phase + ".json"), JSON.stringify(results, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        ...results,
        metrics: {
          writes: results.metrics.writes.length,
          writeMs: results.metrics.writes.reduce((a: any, b: any) => a + b.ms, 0),
          images: results.metrics.images,
          allocations: results.metrics.allocations,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server?.stop(true);
}
