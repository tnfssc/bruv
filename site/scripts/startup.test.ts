import { test, expect } from "bun:test";
import { build } from "./build";
import { preview } from "./preview";
import { launchBrowser } from "./browser";
test("terminal starts without flashing HTML and failures restore it", async () => {
  await build("");
  const server = preview(0),
    browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/terminal.js", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(server.url.href, { waitUntil: "domcontentloaded" });
    expect(await page.locator("#text-content").isVisible()).toBe(false);
    expect(await page.locator("html").getAttribute("class")).toContain("terminal-pending");
    release();
    await page.locator('#terminal[data-ready="true"]').waitFor();
    expect(await page.locator("#text-content").isVisible()).toBe(false);
    await page.close();
    for (const asset of ["terminal.js", "ghostty-vt.wasm"]) {
      const broken = await browser.newPage();
      await broken.route("**/" + asset, (route) => route.abort());
      await broken.goto(server.url.href);
      await broken.locator("#text-content").waitFor({ state: "visible" });
      expect(await broken.locator("h1").textContent()).toBe("Bruv");
      await broken.close();
    }
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noJS.newPage();
    await plain.goto(server.url.href);
    expect(await plain.locator("#text-content").isVisible()).toBe(true);
    await noJS.close();
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30000);
