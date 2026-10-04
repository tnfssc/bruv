import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { layout } from "../layout";
import { FINAL_HOLD } from "../playback";
import { demoIds, demoDuration, type DemoId } from "../demos";
import { preview } from "./preview";
import { launchBrowser } from "./browser";
const out = resolve(import.meta.dir, "../../wisdom/landing-page/validation/polish");
await mkdir(out, { recursive: true });
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
  const snapshot = async () => {
    const d = await page.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
    const demos = JSON.parse(d.demos!);
    return { d, demos, f: layout(+d.cols!, +d.rows!, { scroll: +d.scroll!, focus: -1, demos }) };
  };
  const align = async (id: DemoId) => {
    let s = await snapshot();
    const delta = s.f.captures.find((c) => c.id === id)!.y - 6;
    await page.evaluate(
      ({ delta, height }) =>
        document
          .querySelector("canvas")!
          .dispatchEvent(new WheelEvent("wheel", { deltaY: delta * height, bubbles: true, cancelable: true })),
      { delta, height: +s.d.cellHeight! },
    );
    await page.waitForTimeout(120);
  };
  const click = async (id: DemoId, command: string) => {
    const s = await snapshot(),
      h = s.f.hits.find((h) => h.action === "demo:" + id + ":" + command)!;
    assert(h, id + " control in viewport");
    await page.mouse.click((h.x + 2) * +s.d.cellWidth!, (h.y + 0.5) * +s.d.cellHeight!);
    await page.waitForTimeout(100);
  };
  // Real mouse + keyboard playback. Space operates a focused playback button.
  await align("delegate");
  await page.mouse.move(3, 3);
  for (let i = 0; i < 6 && !(await snapshot()).d.focus?.includes("demo"); i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
  }
  assert((await snapshot()).d.focus?.includes("demo"));
  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  let before = await snapshot();
  assert(before.demos.delegate.paused);
  await page.waitForTimeout(300);
  assert.equal((await snapshot()).demos.delegate.elapsed, before.demos.delegate.elapsed);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  assert((await snapshot()).demos.delegate.elapsed > before.demos.delegate.elapsed);
  results.keyboardPauseResume = true;
  // Visibility signal test: no timer advance and no catch-up after restoring visibility.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  before = await snapshot();
  await page.waitForTimeout(350);
  assert.equal((await snapshot()).demos.delegate.elapsed, before.demos.delegate.elapsed);
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(120);
  assert((await snapshot()).demos.delegate.elapsed - before.demos.delegate.elapsed < 250);
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
    const initial = await snapshot();
    const h = initial.f.hits.find((h) => h.action === "demo:" + id + ":toggle")!;
    await page.mouse.move((h.x + 2) * +initial.d.cellWidth!, (h.y + 0.5) * +initial.d.cellHeight!);
    await page.screenshot({ path: resolve(out, id + "-hover.png") });
    await page.mouse.move(3, 3);
    const elapsed: number[] = [];
    for (const target of [4000, 10000, 18000, demoDuration(id) + FINAL_HOLD - 400]) {
      const current = (await snapshot()).demos[id].elapsed;
      await page.waitForTimeout(Math.max(0, target - current));
      const shot = await snapshot();
      elapsed.push(shot.demos[id].elapsed);
      await page.screenshot({ path: resolve(out, id + "-" + target + ".png") });
    }
    const final = await snapshot();
    assert(final.demos[id].elapsed >= demoDuration(id));
    await page.waitForTimeout(650);
    const reset = await snapshot();
    assert(reset.demos[id].elapsed < 1500, id + " loops after final hold");
    await page.screenshot({ path: resolve(out, id + "-loop-reset.png") });
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(out, id + "-loop-typing.png") });
    results[id] = { elapsed, reset: reset.demos[id].elapsed, finalHold: FINAL_HOLD };
  }
  await align("delegate");
  await page.waitForTimeout(200);
  await page.keyboard.press("End");
  await page.waitForTimeout(120);
  before = await snapshot();
  await page.waitForTimeout(300);
  assert.equal((await snapshot()).demos.delegate.elapsed, before.demos.delegate.elapsed);
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
  let d = await phone.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  assert(demoIds.every((id) => JSON.parse(d.demos!)[id].elapsed === demoDuration(id)));
  const f = layout(+d.cols!, +d.rows!, { scroll: 0, focus: -1 });
  await phone.evaluate(
    ({ delta }) =>
      document
        .querySelector("canvas")!
        .dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true, cancelable: true })),
    { delta: (f.capture.y - 5) * +d.cellHeight! },
  );
  await phone.waitForTimeout(120);
  d = await phone.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  const current = layout(+d.cols!, +d.rows!, { scroll: +d.scroll!, focus: -1, demos: JSON.parse(d.demos!) });
  const h = current.hits.find((h) => h.action === "demo:delegate:toggle")!;
  assert(h);
  await phone.touchscreen.tap((h.x + 2) * +d.cellWidth!, (h.y + 0.5) * +d.cellHeight!);
  await phone.waitForTimeout(300);
  d = await phone.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  assert(JSON.parse(d.demos!).delegate.elapsed < 1000);
  assert(!JSON.parse(d.demos!).delegate.paused);
  await phone.screenshot({ path: resolve(out, "mobile-touch-play.png") });
  results.reducedMotionStaticAndTouchPlay = true;
  await phone.touchscreen.tap((h.x + 2) * +d.cellWidth!, (h.y + 0.5) * +d.cellHeight!);
  await phone.waitForTimeout(100);
  const paused = JSON.parse((await phone.locator("#terminal").getAttribute("data-demos"))!).delegate;
  assert(paused.paused);
  await phone.waitForTimeout(200);
  assert.equal(
    JSON.parse((await phone.locator("#terminal").getAttribute("data-demos"))!).delegate.elapsed,
    paused.elapsed,
  );
  results.touchPause = true;
  assert.deepEqual(errors, []);
  results.errors = errors;
  await mobile.close();
  await Bun.write(resolve(out, "animation-checks.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.stop(true);
}
