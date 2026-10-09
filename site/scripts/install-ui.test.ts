import { test, expect } from "bun:test";
import { build } from "./build";
import { launchBrowser } from "./browser";
import { INSTALL_COMMAND, INSTALL_URL, INSTALL_SOURCE_URL } from "../install-command";
import { layout } from "../layout";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright-core";

async function observeTerminal(page: Page) {
  await page.context().route("**/terminal.js", async (route) => {
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

  const terminalText = () =>
    page.evaluate(() => {
      const t = (window as any).__terminal;
      return Array.from({ length: t.rows }, (_, i) => t.buffer.active.getLine(i)?.translateToString()).join("\n");
    });

  async function copyTarget() {
    const d = await page.locator("#terminal").evaluate((el) => ({ ...(el as HTMLElement).dataset }));
    const f = layout(Number(d.cols), Number(d.rows), {
      scroll: Number(d.scroll),
      focus: -1,
      installCommand: d.installCommand,
      installUrl: d.installUrl,
    });
    expect(f.hits.find((h) => h.action === INSTALL_SOURCE_URL)?.label).toContain("Script");
    const hit = f.hits.find((h) => h.action === "copy-install")!;
    expect(hit).toBeDefined();
    return {
      x: (hit.x + 2) * Number(d.cellWidth),
      y: (hit.y + 0.5) * Number(d.cellHeight),
      rightColumn: hit.x + hit.width,
      columns: Number(d.cols),
    };
  }

  return { text: terminalText, copyTarget };
}

test("README and both views use the one GitHub installer; BASE_URL is SEO only", async () => {
  const readme = await Bun.file(resolve(import.meta.dir, "../../README.md")).text();
  expect(readme.match(/```sh\n(curl[^\n]+)\n```/)?.[1]).toBe(INSTALL_COMMAND);
  expect(INSTALL_COMMAND).toBe("curl -fsSL '" + INSTALL_URL + "' | sh");
  // The concise README keeps the command; both site views also link its source.
  const script = Bun.file(resolve(import.meta.dir, "../../scripts/install.sh"));
  expect(await script.exists()).toBe(true);
  expect((await script.stat()).mode & 0o111).toBe(0o111);
  expect(await Bun.file(resolve(import.meta.dir, "../install.sh")).exists()).toBe(false);
  for (const base of ["https://example.test/tools/bruv", ""]) {
    await build(base);
    for (const page of ["index.html", "text.html"]) {
      const html = await Bun.file(resolve(import.meta.dir, "../dist", page)).text();
      expect(html).toContain(INSTALL_COMMAND);
      expect(html).toContain('href="' + INSTALL_SOURCE_URL + '"');
      expect(html).not.toContain("bruv-install-url");
      expect(html).not.toContain("sh install.sh");
      if (base) expect(html).toContain('rel="canonical"');
    }
    expect(await Bun.file(resolve(import.meta.dir, "../dist/install.sh")).exists()).toBe(false);
  }
});
test("terminal and HTML copy GitHub command at arbitrary origin/subpath; keyboard, mobile and no-JS", async () => {
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
  const url = new URL("preview/bruv/", server.url).href;
  const expected = INSTALL_COMMAND;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const evidence = resolve(import.meta.dir, "../../artifacts/landing-page/install");
  await mkdir(evidence, { recursive: true });
  try {
    const terminal = await observeTerminal(page);
    await page.goto(url);
    await page.locator('#terminal[data-ready="true"]').waitFor();
    expect(await page.locator("#terminal").getAttribute("data-install-command")).toBe(expected);
    expect(await page.locator("#terminal").getAttribute("data-install-url")).toBe(INSTALL_SOURCE_URL);
    expect(await page.locator("canvas").count()).toBe(1);
    expect(await page.locator("#text-content").isVisible()).toBe(false);
    await page.screenshot({ path: resolve(evidence, "desktop-header.png") });
    await page.keyboard.press("End");
    await page.waitForTimeout(100);
    const desktopCopy = await terminal.copyTarget();
    await page.mouse.click(desktopCopy.x, desktopCopy.y);
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    expect(await terminal.text()).toContain("Copied");
    await page.waitForTimeout(1900);
    expect(await terminal.text()).toContain("Copy command");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    expect(await terminal.text()).toContain("Copied");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForTimeout(100);
    await page.keyboard.press("End");
    await page.waitForTimeout(100);
    const mobileCopy = await terminal.copyTarget();
    expect(mobileCopy.rightColumn).toBeLessThanOrEqual(mobileCopy.columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(evidence, "mobile-install.png") });
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
    for (const path of ["", "text.html"]) {
      await plain.goto(new URL(path, url).href);
      expect(await plain.locator("[data-install-command]").textContent()).toBe(expected);
      expect(await plain.locator("[data-copy-install]").isVisible()).toBe(false);
      expect(await plain.getByRole("link", { name: "Script ↗" }).getAttribute("href")).toBe(INSTALL_SOURCE_URL);
      expect(await plain.getByRole("link", { name: "Source guide" }).isVisible()).toBe(true);
    }
    await noJS.close();
  } finally {
    await context.close();
    await browser.close();
    server.stop(true);
  }
}, 30000);
