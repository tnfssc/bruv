/**
 * Looks at the page for real: starts the fake server (built page), opens it in Chrome at phone and desktop
 * sizes, does the usual things, and saves screenshots to `.tmp/web-shots/`. Prints a few numbers that
 * matter for a long conversation: rows in the page, layout shifts.
 *
 *   bun web/scripts/shots.ts
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const root = join(import.meta.dir, "../..");
const out = join(root, ".tmp/web-shots");
mkdirSync(out, { recursive: true });
const port = 7911;
const fake = Bun.spawn(["node", "web/scripts/fake-server.ts", "--port", String(port), "--quiet"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
await Bun.sleep(800);
const url = `http://localhost:${port}/?t=test`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || "/usr/bin/google-chrome-stable" });

const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`) });
const rows = (page: Page) => page.evaluate(() => document.querySelectorAll("[data-index]").length);
const shifts = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
            if (!entry.hadRecentInput) total += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 300);
      }),
  );
const errors: string[] = [];

try {
  for (const [name, viewport, mobile] of [
    ["phone", { width: 390, height: 844 }, true],
    ["desktop", { width: 1280, height: 800 }, false],
  ] as const) {
    const context = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${name}: ${message.text()}`);
    });
    await page.goto(url);
    await page.waitForSelector("[data-index]");
    await page.waitForTimeout(1800);
    await shot(page, `${name}-1-start`);
    console.log(name, "rows in page:", await rows(page), "layout shift:", (await shifts(page)).toFixed(4));

    // Send a message with a picture and watch the reply stream in.
    await page.setInputFiles('input[type="file"]', join(root, "site/assets/brand/bruv-social.png"));
    await page.getByLabel("Message").fill("Fix the login redirect and add rate limits to the API.");
    await page.waitForTimeout(400);
    await shot(page, `${name}-2-composer`);
    await page.getByLabel("Send").click();
    await page.waitForTimeout(1500);
    await shot(page, `${name}-3-streaming`);
    await page.waitForTimeout(2500);

    // Scroll far back: older lines load and the view stays put.
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(viewport.width / 3, viewport.height / 2);
      await page.mouse.wheel(0, -3000);
      await page.waitForTimeout(250);
    }
    await shot(page, `${name}-4-scrolled-back`);
    const loaded = await page.evaluate(() => document.querySelector("[data-index]")?.textContent?.slice(0, 40));
    console.log(name, "rows in page after scrolling back:", await rows(page), "first row:", loaded);

    // The activity panel: beside on desktop, a sheet on the phone.
    if (mobile) await page.getByLabel("Activity").click();
    await page.waitForTimeout(400);
    await page.locator('button[aria-expanded="false"]').nth(1).click();
    await page.waitForTimeout(200);
    await shot(page, `${name}-5-activity`);
    await context.close();
  }
} finally {
  await browser.close();
  fake.kill();
}
if (errors.length) console.log("page errors:\n", errors.join("\n"));
console.log("screenshots in", out);
