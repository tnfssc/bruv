import { test, expect } from "bun:test";
import { build } from "./build";
import { launchBrowser } from "./browser";
import { installCommand } from "../install-command";
import { layout } from "../layout";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
test("BASE_URL uses exact subpath, shell quoting, and static download script", async () => {
  await build("https://example.test/tools/bruv");
  const html = await Bun.file(resolve(import.meta.dir, "../dist/text.html")).text();
  expect(html).toContain('content="https://example.test/tools/bruv/install.sh"');
  expect(html).toContain("curl -fsSL 'https://example.test/tools/bruv/install.sh' | sh");
  expect(await Bun.file(resolve(import.meta.dir, "../dist/install.sh")).text()).toBe(
    await Bun.file(resolve(import.meta.dir, "../install.sh")).text(),
  );
  expect(installCommand("https://example.test/it's/install.sh")).toContain("'\"'\"'");
});
test("terminal and HTML copy the served subpath; keyboard, mobile and no-JS download", async () => {
  await build("");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname.replace(/^\/preview\/bruv\//, "");
      return new Response(Bun.file(resolve(import.meta.dir, "../dist", path || "index.html")));
    },
  });
  const browser = await launchBrowser();
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1440, height: 960 },
    reducedMotion: "reduce",
  });
  await context.route("**/terminal.js", async (route) => {
    const response = await route.fetch(),
      source = await response.text();
    const hook = /([\w$]+)\.open\(([\w$]+)\),(?=\1\.write)/;
    const start = source.lastIndexOf(".open(") - 30,
      tail = source.slice(start);
    expect(hook.test(tail)).toBe(true);
    await route.fulfill({
      response,
      body: source.slice(0, start) + tail.replace(hook, "$1.open($2),window.__terminal=$1,"),
    });
  });
  const url = new URL("preview/bruv/", server.url).href;
  const expected = installCommand(new URL("install.sh", url).href);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const evidence = resolve(import.meta.dir, "../../wisdom/landing-page/validation/install");
  await mkdir(evidence, { recursive: true });
  try {
    await page.goto(url);
    await page.locator('#terminal[data-ready="true"]').waitFor();
    expect(await page.locator("#terminal").getAttribute("data-install-command")).toBe(expected);
    expect(await page.locator("canvas").count()).toBe(1);
    expect(await page.locator("#text-content").isVisible()).toBe(false);
    await page.screenshot({ path: resolve(evidence, "desktop-header.png") });
    await page.keyboard.press("End");
    await page.waitForTimeout(100);
    async function copyHit() {
      const d = await page.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
      const f = layout(Number(d.cols), Number(d.rows), {
        scroll: Number(d.scroll),
        focus: -1,
        installCommand: d.installCommand,
        installUrl: d.installUrl,
      });
      const hit = f.hits.find((h) => h.action === "copy-install")!;
      expect(hit).toBeDefined();
      return { hit, d };
    }
    let { hit, d } = await copyHit();
    await page.mouse.click((hit.x + 2) * Number(d.cellWidth), (hit.y + 0.5) * Number(d.cellHeight));
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    const terminalText = () =>
      page.evaluate(() => {
        const t = (window as any).__terminal;
        return Array.from({ length: t.rows }, (_, i) => t.buffer.active.getLine(i)?.translateToString()).join("\n");
      });
    expect(await terminalText()).toContain("Copied");
    await page.waitForTimeout(1900);
    expect(await terminalText()).toContain("Copy command");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    expect(await terminalText()).toContain("Copied");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForTimeout(100);
    await page.keyboard.press("End");
    await page.waitForTimeout(100);
    ({ hit, d } = await copyHit());
    expect(hit.x + hit.width).toBeLessThanOrEqual(Number(d.cols));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(evidence, "mobile-install.png") });
    const scriptResponse = await page.request.get(new URL("install.sh", url).href);
    expect(scriptResponse.ok()).toBe(true);
    expect(await scriptResponse.text()).toContain("#!/bin/sh");
    await page.goto(new URL("text.html", url).href);
    const code = page.locator("[data-install-command]");
    expect(await code.textContent()).toBe(expected);
    const button = page.getByRole("button", { name: "Copy command", exact: true });
    await button.click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor({ state: "visible" });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    await page.waitForTimeout(1900);
    await button.focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor({ state: "visible" });
    await page.screenshot({ path: resolve(evidence, "mobile-html-install.png") });
    expect(errors).toEqual([]);
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noJS.newPage();
    await plain.goto(new URL("text.html", url).href);
    expect(await plain.locator("[data-install-command]").textContent()).toBe("sh install.sh");
    expect(await plain.locator("[data-copy-install]").isVisible()).toBe(false);
    expect(await plain.getByRole("link", { name: "Download script" }).getAttribute("href")).toBe("./install.sh");
    expect(await plain.getByRole("link", { name: "Source guide" }).isVisible()).toBe(true);
    await noJS.close();
  } finally {
    await context.close();
    await browser.close();
    server.stop(true);
  }
}, 30000);
