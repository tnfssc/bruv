import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { launchBrowser } from "./browser";
import { build } from "./build";
import { preview } from "./preview";
import { layout } from "../layout";
import { siteContent } from "../content";
await build("");
const server = preview(0),
  browser = await launchBrowser();
const evidence = resolve(import.meta.dir, "../../wisdom/landing-page/validation/terminal");
await mkdir(evidence, { recursive: true });
const errors: string[] = [],
  requests: string[] = [];
const checks: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    requests.push(r.url());
    assert.equal(new URL(r.url()).origin, server.url.origin);
  });
  page.on("websocket", () => assert.fail("Static site opened a WebSocket"));
  await page.goto(server.url.href);
  await page.locator('#terminal[data-ready="true"]').waitFor();
  const dimensions = () =>
    page.locator("#terminal").evaluate((el) => ({
      cols: Number((el as HTMLElement).dataset.cols),
      rows: Number((el as HTMLElement).dataset.rows),
      scroll: Number((el as HTMLElement).dataset.scroll),
      route: (el as HTMLElement).dataset.route!,
    }));
  async function route(id: string) {
    await page.waitForURL("**/#" + id);
    await page.locator('#terminal[data-route="' + id + '"]').waitFor();
  }
  async function hit(action: string) {
    const d = await dimensions();
    const f = layout(d.cols, d.rows, { route: d.route, scroll: d.scroll, focus: -1 });
    const h = f.hits.find((h) => h.action === action);
    assert.ok(h, "Visible cell action " + action);
    const b = await page.locator("canvas").boundingBox();
    assert.ok(b);
    await page.mouse.click(b.x + ((h.x + 0.5) * b.width) / d.cols, b.y + ((h.y + 0.5) * b.height) / d.rows);
  }
  assert.equal(await page.locator("canvas").count(), 1);
  assert.equal(await page.locator("#text-content").isVisible(), false);
  assert.ok(requests.some((u) => u.endsWith("ghostty-vt.wasm")));
  const wasm = new Uint8Array(await (await fetch(new URL("ghostty-vt.wasm", server.url))).arrayBuffer());
  assert.deepEqual([...wasm.slice(0, 4)], [0, 97, 115, 109]);
  await page.screenshot({ path: resolve(evidence, "desktop.png") });
  checks.push(
    "Actual Ghostty WASM fetched locally; one canvas; semantic content not visible in JS mode; no third-party requests or socket.",
  );
  await hit("#install");
  await route("install");
  assert.equal((await dimensions()).route, "install");
  await page.keyboard.press("Escape");
  await page.waitForURL(server.url.href);
  await page.locator('#terminal[data-route="overview"]').waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#terminal").getAttribute("data-focus"), "1 Overview");
  await page.keyboard.press("Enter");
  await route("overview");
  await page.keyboard.press("3");
  await route("workflows");
  await page.keyboard.press("?");
  await route("help");
  checks.push("Mouse cell hit changes page; Escape/browser history and Tab/Enter, numbered and help navigation.");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 700 : 960 });
    await page.goto(server.url.href + "#overview");
    await page.locator('#terminal[data-ready="true"]').waitFor();
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
      ),
    );
    const d = await dimensions(),
      b = await page.locator("canvas").boundingBox();
    assert.ok(b && b.width <= width && b.height <= (width < 600 ? 700 : 960));
    await hit("#install");
    await route("install");
    await hit("#overview");
    await route("overview");
    if (width <= 390) {
      await hit("#help");
      await route("help");
      await page.keyboard.press("End");
      assert.ok((await dimensions()).scroll > 0);
      await page.keyboard.press("Home");
      assert.equal((await dimensions()).scroll, 0);
      await page.mouse.move(150, 300);
      await page.mouse.wheel(0, 250);
      await page.waitForTimeout(60);
      assert.ok((await dimensions()).scroll > 0);
      await page.keyboard.press("Home");
      await hit("#overview");
      await route("overview");
    }
    if ([320, 390].includes(width)) await page.screenshot({ path: resolve(evidence, "mobile-" + width + ".png") });
  }
  checks.push(
    "320/390/768/1440 viewport reflow, no cropped canvas or horizontal page; mouse routes after resize; End/Home/wheel content scrolling.",
  );
  // Gallery cell links intentionally leave the canvas for a real static image page.
  await page.goto(server.url.href + "#gallery");
  await page.locator('#terminal[data-ready="true"]').waitFor();
  for (const id of ["settings", "help"]) {
    await page.keyboard.press("End");
    if (id === "settings") {
      for (
        let i = 0;
        i < 25 && (await page.locator("#terminal").getAttribute("data-focus")) !== "View local settings menu";
        i++
      )
        await page.keyboard.press("Tab");
      assert.equal(await page.locator("#terminal").getAttribute("data-focus"), "View local settings menu");
      await page.keyboard.press("Enter");
    } else await hit("./shots/" + id + ".html");
    await page.waitForURL("**/shots/" + id + ".html");
    assert.equal(await page.locator("canvas").count(), 0);
    await page.locator("img").evaluate((image: HTMLImageElement) => image.decode());
    assert.ok(await page.locator("img").getAttribute("alt"));
    await page.goBack();
    await page.locator('#terminal[data-ready="true"]').waitFor();
  }
  await page.screenshot({ path: resolve(evidence, "gallery.png") });
  const mobile = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    viewport: { width: 390, height: 700 },
  });
  const touch = await mobile.newPage();
  await touch.goto(server.url.href + "#help");
  await touch.locator('#terminal[data-ready="true"]').waitFor();
  const session = await mobile.newCDPSession(touch);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 180, y: 470 }] });
  for (const y of [440, 400, 360, 320])
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 180, y }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.ok(Number(await touch.locator("#terminal").getAttribute("data-scroll")) > 0);
  const td = await touch.locator("#terminal").evaluate((el) => ({
    cols: Number((el as HTMLElement).dataset.cols),
    rows: Number((el as HTMLElement).dataset.rows),
  }));
  const tf = layout(td.cols, td.rows, { route: "help", scroll: 0, focus: -1 });
  const th = tf.hits.find((h) => h.action === "#install")!;
  const tb = (await touch.locator("canvas").boundingBox())!;
  await touch.touchscreen.tap(tb.x + ((th.x + 0.5) * tb.width) / td.cols, tb.y + ((th.y + 0.5) * tb.height) / td.rows);
  await touch.locator('#terminal[data-route="install"]').waitFor();
  checks.push(
    "Both terminal gallery links open decoded real PNG viewer pages and browser Back returns; Chromium touch swipe scrolls and cell tap navigates at DPR 2.",
  );
  await mobile.close();
  // Link activation is intercepted at the destination, not faked inside the website.
  await page.goto(server.url.href + "#install");
  await page.locator('#terminal[data-ready="true"]').waitFor();
  await page.keyboard.press("End");
  const external = siteContent.pages.find((p) => p.id === "install")!.links.find((l) => l.href.startsWith("https:"))!;
  await page.route(new URL(external.href).origin + "/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Destination intercepted by browser test</h1>" }),
  );
  // Don't count the intentionally intercepted external destination as a runtime dependency.
  page.removeAllListeners("request");
  await hit(external.href);
  await page.waitForURL(external.href);
  await page.goBack();
  await page.locator('#terminal[data-ready="true"]').waitFor();
  await page.keyboard.press("a");
  await page.waitForURL("**/text.html#install");
  assert.equal(await page.locator("#text-content").isVisible(), true);
  assert.equal(await page.locator("canvas").count(), 0);
  checks.push(
    "Real install/source destination navigation (intercepted by test); keyboard A opens plain HTML and browser Back returns.",
  );
  const noJS = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const text = await noJS.newPage();
  await text.goto(server.url.href);
  assert.equal(await text.locator("canvas").count(), 0);
  for (const p of siteContent.pages) {
    assert.equal(await text.locator("#" + p.id + " h2").innerText(), p.title);
    for (const paragraph of p.paragraphs) assert.ok((await text.locator("#" + p.id).innerText()).includes(paragraph));
    for (const link of p.links)
      assert.ok(
        await text
          .locator("#" + p.id + " a")
          .evaluateAll((els, href) => els.some((a) => a.getAttribute("href") === href), link.href),
      );
  }
  await text.locator('nav a[href="#install"]').click();
  assert.equal(new URL(text.url()).hash, "#install");
  await text.screenshot({ path: resolve(evidence, "no-js.png"), fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(
    axe.violations.map((v) => v.id),
    [],
  );
  checks.push(
    "No-JS semantic content equals shared terminal data, real links, heading navigation; automated axe text-view check (not a screen-reader audit).",
  );
  await build("https://example.test/bruv/");
  const html = await (await fetch(server.url)).text();
  assert.ok(html.includes('href="https://example.test/bruv/"'));
  assert.ok(
    (await (await fetch(new URL("sitemap.xml", server.url))).text()).includes("https://example.test/bruv/text.html"),
  );
  await build("");
  assert.equal((await fetch(new URL("sitemap.xml", server.url))).status, 404);
  const subpath = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      return path.startsWith("/bruv/")
        ? fetch(new URL(path.slice(5), server.url))
        : new Response("Missing", { status: 404 });
    },
  });
  const sub = await browser.newPage();
  await sub.goto(subpath.url.href + "bruv/");
  await sub.locator('#terminal[data-ready="true"]').waitFor();
  assert.equal(await sub.locator("canvas").count(), 1);
  await sub.close();
  await subpath.stop(true);
  checks.push("Self-contained JS and WASM also load under a static deployment subpath.");
  assert.deepEqual(errors, []);
  checks.push(
    "Configurable canonical and sitemap; unset URL does not invent production domain; no browser exceptions.",
  );
  await Bun.write(
    resolve(evidence, "results.json"),
    JSON.stringify({ browser: await browser.version(), checks, errors }, null, 2) + "\n",
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
  await server.stop(true);
}
