import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { build } from "./build";
import { preview } from "./preview";
import { launchBrowser } from "./browser";
await build("");
const server = preview(0);
const browser = await launchBrowser();
const evidence = resolve(import.meta.dir, "../../wisdom/landing-page/validation");
await mkdir(evidence, { recursive: true });
const checks: string[] = [];
const pageErrors: string[] = [];
const failedRequests: string[] = [];
try {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedRequests.push(response.url());
  });
  page.on("request", (request) => {
    assert.equal(new URL(request.url()).origin, server.url.origin, "No third-party requests");
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(server.url.href);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "No horizontal overflow at " + width,
    );
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    // Load lazy images before checking their pixels and capturing the complete page.
    for (const image of await page.locator("img").all()) await image.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => scrollTo(0, 0));
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    assert.deepEqual(
      axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      [],
      "axe at width " + width,
    );
    if ([390, 1440].includes(width))
      await page.screenshot({
        path: resolve(evidence, width === 1440 ? "desktop.png" : "mobile.png"),
        fullPage: true,
        animations: "disabled",
      });
    checks.push(
      width + "px: no horizontal overflow; images loaded; axe A/AA + best-practice clean; reduced motion respected",
    );
  }
  await page.goto(server.url.href);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".skip-link").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).hash, "#main");
  const delegate = page.getByRole("button", { name: /Share the work/ });
  await delegate.focus();
  await page.keyboard.press("Enter");
  assert.equal(await delegate.evaluate((el) => getComputedStyle(el).outlineColor), "rgb(100, 117, 46)");
  await page.locator(".demo-sidebar").screenshot({ path: resolve(evidence, "keyboard-focus.png") });
  assert.equal(await delegate.getAttribute("aria-pressed"), "true");
  assert.match(await page.locator("#scene").innerText(), /Research the approach/);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  assert.match(await page.locator("#scene").innerText(), /What we decided/);
  assert.equal(await page.locator('.scene-controls button[aria-pressed="true"]').count(), 1);
  const summary = page.locator("summary").filter({ hasText: "Is this running Bruv in my browser?" });
  await summary.focus();
  await page.keyboard.press("Enter");
  assert.equal(await summary.evaluate((el) => el.parentElement?.hasAttribute("open")), true);
  checks.push("Keyboard: skip link, scene Enter/Space controls and native FAQ disclosure passed");
  const noJS = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const staticPage = await noJS.newPage();
  await staticPage.goto(server.url.href);
  assert.match(await staticPage.locator("main").innerText(), /coding agent built on Pi/);
  assert.match(await staticPage.locator("#scene").innerText(), /Read the project notes/);
  assert.equal(await staticPage.locator(".scene-controls").isVisible(), false);
  assert.equal(await staticPage.locator(".no-script").isVisible(), true);
  await staticPage.getByText("What about a web interface?", { exact: true }).click();
  assert.equal(await staticPage.getByText(/T3 is not bundled with Bruv/).isVisible(), true);
  checks.push("JavaScript disabled: substantive copy, default scene, links and FAQ remain usable");
  const html = await (await fetch(server.url)).text();
  assert.ok(html.includes("<h1") && html.includes("project wisdom"));
  assert.ok(!html.includes('rel="canonical"') && !html.includes('og:image"'));
  const anchors = await page
    .locator('a[href^="#"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")).filter((href) => href !== "#"));
  for (const anchor of anchors) assert.equal(await page.locator(anchor!).count(), 1, "Local anchor " + anchor);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedRequests, []);
  checks.push("Static HTML and local anchors checked; no browser errors, failed assets or third-party requests");
  await build("https://example.test/bruv/");
  const configured = await (await fetch(server.url)).text();
  assert.ok(configured.includes("https://example.test/bruv/assets/social.png"));
  assert.ok(
    (await (await fetch(new URL("sitemap.xml", server.url))).text()).includes("<loc>https://example.test/bruv/</loc>"),
  );
  assert.ok(!(await (await fetch(new URL("robots.txt", server.url))).text()).includes("\\n"));
  checks.push("Configured URL build: canonical, absolute social image, sitemap and robots emitted");
  await build("");
  assert.equal((await fetch(new URL("sitemap.xml", server.url))).status, 404);
  checks.push("Rebuilding without BASE_URL removes prior URL-specific output");
  await Bun.write(
    resolve(evidence, "results.json"),
    JSON.stringify({ browser: await browser.version(), checks, pageErrors, failedRequests }, null, 2) + "\n",
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
  await server.stop(true);
}
