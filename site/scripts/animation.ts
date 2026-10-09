import { requireValue } from "../../scripts/lib/require-value";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright-core";
import { type DemoId, demoDuration, demoIds } from "../demos";
import { layout } from "../layout";
import { FINAL_HOLD, type Playback } from "../playback";
import { launchBrowser } from "./browser";
import { preview } from "./preview";

const out = resolve(import.meta.dir, "../../artifacts/landing-page/polish");
await mkdir(out, { recursive: true });

async function snapshot(page: Page) {
  const data = await page.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  const demos: Record<DemoId, Playback> = JSON.parse(requireValue(data.demos));
  return {
    focus: data.focus,
    cellWidth: +requireValue(data.cellWidth),
    cellHeight: +requireValue(data.cellHeight),
    demos,
    frame: layout(+requireValue(data.cols), +requireValue(data.rows), {
      scroll: +requireValue(data.scroll),
      focus: -1,
      demos,
    }),
  };
}

function demoControlPoint(state: Awaited<ReturnType<typeof snapshot>>, id: DemoId) {
  const hit = state.frame.hits.find((hit) => hit.action === `demo:${id}:toggle`);
  assert(hit, `${id} control in viewport`);
  return { x: (hit.x + 2) * state.cellWidth, y: (hit.y + 0.5) * state.cellHeight };
}

async function scrollCells(page: Page, rows: number, cellHeight: number) {
  await page.evaluate((deltaY) => {
    function requireValue<T>(value: T | null | undefined): T {
      if (value === null || value === undefined) throw new Error("Expected a value");
      return value;
    }
    return requireValue(document.querySelector("canvas")).dispatchEvent(
      new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
    );
  }, rows * cellHeight);
  await page.waitForTimeout(120);
}

async function checkReducedMotionTouch(page: Page) {
  const initial = await snapshot(page);
  assert(demoIds.every((id) => initial.demos[id].elapsed === demoDuration(id)));
  await scrollCells(page, initial.frame.capture.y - 5, initial.cellHeight);
  const point = demoControlPoint(await snapshot(page), "delegate");
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForTimeout(300);
  const playing = await snapshot(page);
  assert(playing.demos.delegate.elapsed < 1000);
  assert(!playing.demos.delegate.paused);
  await page.screenshot({ path: resolve(out, "mobile-touch-play.png") });
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForTimeout(100);
  const paused = (await snapshot(page)).demos.delegate;
  assert(paused.paused);
  await page.waitForTimeout(200);
  assert.equal((await snapshot(page)).demos.delegate.elapsed, paused.elapsed);
  return { reducedMotionStaticAndTouchPlay: true, touchPause: true };
}

const server = preview(0),
  browser = await launchBrowser();
const results: Record<string, unknown> = {};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(server.url.href);
  await page.locator('#terminal[data-ready="true"]').waitFor();
  const align = async (id: DemoId) => {
    const state = await snapshot(page);
    const delta = requireValue(state.frame.captures.find((capture) => capture.id === id)).y - 6;
    await scrollCells(page, delta, state.cellHeight);
  };
  // Real mouse + keyboard playback. Space operates a focused playback button.
  await align("delegate");
  await page.mouse.move(3, 3);
  for (let i = 0; i < 6 && !(await snapshot(page)).focus?.includes("demo"); i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
  }
  assert((await snapshot(page)).focus?.includes("demo"));
  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  const keyboardPaused = (await snapshot(page)).demos.delegate;
  assert(keyboardPaused.paused);
  await page.waitForTimeout(300);
  assert.equal((await snapshot(page)).demos.delegate.elapsed, keyboardPaused.elapsed);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  assert((await snapshot(page)).demos.delegate.elapsed > keyboardPaused.elapsed);
  results.keyboardPauseResume = true;
  // Visibility signal test: no timer advance and no catch-up after restoring visibility.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = (await snapshot(page)).demos.delegate;
  await page.waitForTimeout(350);
  assert.equal((await snapshot(page)).demos.delegate.elapsed, hidden.elapsed);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(120);
  assert((await snapshot(page)).demos.delegate.elapsed - hidden.elapsed < 250);
  results.visibilitySignal = true;
  // Tab leaves the terminal after the last visible link; no focus trap.
  for (
    let i = 0;
    i < 8 && !(await page.locator(".plain-switch").evaluate((el) => el === document.activeElement));
    i++
  ) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
  }
  assert(await page.locator(".plain-switch").evaluate((el) => el === document.activeElement));
  await page.locator("#terminal").focus();
  results.keyboardExit = true;
  for (const id of demoIds) {
    await align(id);
    const initial = await snapshot(page);
    const point = demoControlPoint(initial, id);
    await page.mouse.move(point.x, point.y);
    await page.screenshot({ path: resolve(out, `${id}-hover.png`) });
    await page.mouse.move(3, 3);
    const elapsed: number[] = [];
    for (const target of [4000, 10000, 18000, demoDuration(id) + FINAL_HOLD - 400]) {
      const current = (await snapshot(page)).demos[id].elapsed;
      await page.waitForTimeout(Math.max(0, target - current));
      const shot = await snapshot(page);
      elapsed.push(shot.demos[id].elapsed);
      await page.screenshot({ path: resolve(out, `${id}-${target}.png`) });
    }
    const final = await snapshot(page);
    assert(final.demos[id].elapsed >= demoDuration(id));
    await page.waitForTimeout(650);
    const reset = await snapshot(page);
    assert(reset.demos[id].elapsed < 1500, `${id} loops after final hold`);
    await page.screenshot({ path: resolve(out, `${id}-loop-reset.png`) });
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(out, `${id}-loop-typing.png`) });
    results[id] = { elapsed, reset: reset.demos[id].elapsed, finalHold: FINAL_HOLD };
  }
  await align("delegate");
  await page.waitForTimeout(200);
  await page.keyboard.press("End");
  await page.waitForTimeout(120);
  const offscreen = (await snapshot(page)).demos.delegate;
  await page.waitForTimeout(300);
  assert.equal((await snapshot(page)).demos.delegate.elapsed, offscreen.elapsed);
  results.offscreenPause = true;
  await context.close();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const phone = await mobile.newPage();
  await phone.goto(server.url.href);
  await phone.locator('#terminal[data-ready="true"]').waitFor();
  Object.assign(results, await checkReducedMotionTouch(phone));
  assert.deepEqual(errors, []);
  results.errors = errors;
  await mobile.close();
  await Bun.write(resolve(out, "animation-checks.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.stop(true);
}
