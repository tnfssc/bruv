import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startWebServer } from "../../src/web/server.ts";
import { loadWebAssets } from "../../src/web/assets.ts";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const proof = resolve(import.meta.dir, "../../artifacts/vesper-theme");
await mkdir(proof, { recursive: true });
// A real shell PTY, with the same built browser assets as the compiled app.
const lines = ["printf '\033[2J\033[HDEFAULT foreground on pure black\n\n'"];
for (let i = 0; i < 16; i++) {
  const code = i < 8 ? 30 + i : 90 + i - 8;
  lines.push("printf '\033[" + code + "mANSI " + i + "   AaBb 0123\033[0m\n'");
}
lines.push("printf '\n\033[38;2;255;199;153mExplicit RGB peach\033[0m\n'; sleep 120");
const app = startWebServer({ port: 0, command: ["/bin/sh", "-c", lines.join("; ")], assets: await loadWebAssets() });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  await page.goto(app.url);
  await page.waitForFunction(() => document.querySelector("#terminal")?.textContent?.includes("Explicit RGB peach"));
  const colors = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".xterm-rows > div")];
    const line = (text) => rows.find((row) => row.textContent.startsWith(text));
    const fg = (row) => getComputedStyle(row.querySelector("span")).color;
    return {
      page: getComputedStyle(document.body).backgroundColor,
      terminal: getComputedStyle(document.querySelector(".xterm-viewport")).backgroundColor,
      defaultFg: fg(line("DEFAULT")),
      ansi: Array.from({ length: 16 }, (_, i) => fg(line("ANSI " + i + " "))),
      rgb: fg(line("Explicit RGB peach")),
    };
  });
  assert.equal(colors.page, "rgb(0, 0, 0)");
  assert.equal(colors.terminal, "rgb(0, 0, 0)");
  assert.equal(colors.defaultFg, "rgb(255, 255, 255)");
  const expected = [
    "101010",
    "f5a191",
    "90b99f",
    "e6b99d",
    "aca1cf",
    "e29eca",
    "ea83a5",
    "a0a0a0",
    "7e7e7e",
    "ff8080",
    "99ffe4",
    "ffc799",
    "b9aeda",
    "ecaad6",
    "f591b2",
    "ffffff",
  ];
  assert.deepEqual(
    colors.ansi,
    expected.map(
      (hex) =>
        "rgb(" +
        hex
          .match(/../g)
          .map((v) => parseInt(v, 16))
          .join(", ") +
        ")",
    ),
  );
  assert.equal(colors.rgb, "rgb(255, 199, 153)");
  await page.screenshot({ path: resolve(proof, "ansi-desktop.png") });
  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(proof, "ansi-phone.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  console.log(JSON.stringify({ pass: true, colors, proof }));
} finally {
  await browser?.close();
  await app.stop();
}
