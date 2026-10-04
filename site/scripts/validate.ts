import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { launchBrowser } from "./browser";
import { build } from "./build";
import { preview } from "./preview";

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
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(server.url.href);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("main").count(), 1);
    assert.equal(await page.locator("canvas, input, [role=application]").count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "No horizontal overflow at " + width,
    );
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    for (const image of await page.locator("main img").all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((el: HTMLImageElement) => el.decode());
    }
    await page.evaluate(() => scrollTo(0, 0));
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    assert.deepEqual(
      axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      [],
      "axe at width " + width,
    );
    if ([320, 390, 1440].includes(width)) {
      await page.screenshot({
        path: resolve(evidence, width === 1440 ? "desktop.png" : width === 320 ? "mobile-narrow.png" : "mobile.png"),
        fullPage: true,
        animations: "disabled",
      });
    }
    // Exercise the viewer at every layout, not just the desktop screenshot path.
    await page.locator(".image-link").first().click();
    assert.equal(await page.locator("dialog").evaluate((el: HTMLDialogElement) => el.open), true);
    assert.equal(
      await page.locator("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
      "Viewer fits " + width,
    );
    const viewerAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    assert.deepEqual(
      viewerAxe.violations.map((v) => v.id),
      [],
      "Viewer axe at " + width,
    );
    await page.keyboard.press("Escape");
    checks.push(
      width +
        "px: no horizontal clipping; images loaded; axe A/AA + best-practice clean; viewer opens/closes and fits; reduced motion respected",
    );
  }
  await page.goto(server.url.href);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".skip-link").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).hash, "#main");
  assert.equal(await page.locator("main").evaluate((el) => el === document.activeElement), true);
  const workflow = page.getByRole("navigation", { name: "Page sections" }).getByRole("link", { name: /Workflow/ });
  await workflow.focus();
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).hash, "#workflow");
  await page.goBack();
  assert.equal(new URL(page.url()).hash, "#main");
  const enlarge = page.locator("figcaption a[data-viewer]").first();
  await enlarge.focus();
  assert.equal(await enlarge.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
  await page.locator("#overview").screenshot({ path: resolve(evidence, "keyboard-focus.png") });
  await page.keyboard.press("Enter");
  const close = page.getByRole("button", { name: /Close/ });
  assert.equal(await close.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#viewer-original").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await close.evaluate((el) => el === document.activeElement), true);
  await page.locator(".brand").evaluate((el: HTMLElement) => el.focus());
  assert.equal(await close.evaluate((el) => el === document.activeElement), true, "Modal makes background inert");
  await page.screenshot({ path: resolve(evidence, "image-viewer.png") });
  await page.keyboard.press("Escape");
  assert.equal(await enlarge.evaluate((el) => el === document.activeElement), true);
  const second = page.locator("figcaption a[data-viewer]").last();
  await second.click();
  assert.match((await page.locator("#viewer-image").getAttribute("src")) || "", /wisdom.png$/);
  await close.click();
  assert.equal(await page.locator("dialog").evaluate((el: HTMLDialogElement) => el.open), false);
  const newTabPromise = context.waitForEvent("page");
  await second.click({ modifiers: ["ControlOrMeta"] });
  const newTab = await newTabPromise;
  await newTab.waitForLoadState();
  assert.equal(new URL(newTab.url()).pathname, "/assets/wisdom.png");
  await newTab.close();
  assert.equal(await page.locator("dialog").evaluate((el: HTMLDialogElement) => el.open), false);
  checks.push("Browser modifier gesture: image Ctrl/Cmd-click opens original in a new tab, not the viewer");
  const summary = page.getByText("Can I use a web frontend with Bruv?", { exact: true });
  await summary.focus();
  await page.keyboard.press("Enter");
  assert.equal(await summary.evaluate((el) => el.parentElement?.hasAttribute("open")), true);
  await page.keyboard.press("Space");
  assert.equal(await summary.evaluate((el) => el.parentElement?.hasAttribute("open")), false);
  checks.push(
    "Keyboard: skip link focuses main; section anchors and browser Back; visible focus; both image links, modal focus containment/return, Escape/Close; native Enter/Space disclosures",
  );

  const noJS = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const staticPage = await noJS.newPage();
  await staticPage.goto(server.url.href);
  assert.match(await staticPage.locator("main").innerText(), /coding agent built on Pi/);
  for (const id of ["overview", "workflow", "wisdom", "install"]) {
    await staticPage.locator('nav a[href="#' + id + '"]').click();
    assert.equal(new URL(staticPage.url()).hash, "#" + id);
    assert.equal(await staticPage.locator("#" + id).isVisible(), true);
  }
  await staticPage.getByText("Can I use a web frontend with Bruv?", { exact: true }).click();
  assert.equal(await staticPage.getByText(/T3 is not bundled with Bruv/).isVisible(), true);
  assert.equal(
    await staticPage.getByRole("link", { name: "Open install guide" }).getAttribute("href"),
    "https://github.com/tnfssc/bruv#install",
  );
  await staticPage.locator(".image-link").first().click();
  assert.equal(new URL(staticPage.url()).pathname, "/assets/delegation.png");
  await staticPage.goBack();
  assert.equal(await staticPage.locator("main").isVisible(), true);
  await staticPage.evaluate(() => scrollTo(0, 0));
  await staticPage.screenshot({ path: resolve(evidence, "no-js.png"), fullPage: true });
  checks.push(
    "JavaScript disabled: every section link, product copy, install href, disclosures, full-size image navigation and browser Back work",
  );

  const html = await (await fetch(server.url)).text();
  assert.ok(html.includes("<h1") && html.includes("project wisdom"));
  assert.ok(!html.includes('rel="canonical"') && !html.includes('og:image"'));
  assert.ok(!html.includes("demo.js") && !html.includes("scene-controls"));
  const anchors = await page.locator('a[href^="#"]').evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  for (const anchor of anchors) assert.equal(await page.locator(anchor!).count(), 1, "Local anchor " + anchor);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedRequests, []);
  checks.push(
    "Static semantic HTML, single h1/main and local anchors checked; no simulator/canvas, browser errors, failed assets or third-party requests",
  );
  await build("https://example.test/bruv/");
  const configured = await (await fetch(server.url)).text();
  assert.ok(configured.includes('rel="canonical" href="https://example.test/bruv/"'));
  assert.ok(configured.includes("https://example.test/bruv/assets/social.png"));
  assert.ok(
    (await (await fetch(new URL("sitemap.xml", server.url))).text()).includes("<loc>https://example.test/bruv/</loc>"),
  );
  assert.ok(
    (await (await fetch(new URL("robots.txt", server.url))).text()).includes(
      "\nSitemap: https://example.test/bruv/sitemap.xml\n",
    ),
  );
  checks.push("Configured production URL: canonical, absolute social image, sitemap and robots emitted");
  await build("");
  assert.equal((await fetch(new URL("sitemap.xml", server.url))).status, 404);
  checks.push("Rebuild without BASE_URL removes prior URL-specific output");
  await Bun.write(
    resolve(evidence, "results.json"),
    JSON.stringify({ browser: await browser.version(), checks, pageErrors, failedRequests }, null, 2) + "\n",
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
  await server.stop(true);
}
