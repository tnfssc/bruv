import { withBrowserProbe } from "./browser-probe.mjs";
import { watchRenderer, paintedTerminal } from "./browser-renderer-proof.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startWebServer } from "../../src/web/server.ts";
import { loadWebAssets } from "../../src/web/assets.ts";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const proof = resolve(import.meta.dir, "../../artifacts/ghostty/theme");
await mkdir(proof, { recursive: true });
// A real shell PTY, with the same built browser assets as the compiled app.
const lines = ["printf '\x1b[2J\x1b[HDEFAULT foreground on pure black\n\n'"];
for (let i = 0; i < 16; i++) {
  const code = i < 8 ? 30 + i : 90 + i - 8;
  lines.push("printf '\x1b[" + code + "mANSI " + i + "   AaBb 0123\x1b[0m\n'");
}
lines.push("printf '\n\x1b[38;2;255;199;153mExplicit RGB peach\x1b[0m\n'; sleep 120");
await withBrowserProbe("browser-theme", async (owned) => {
  const app = startWebServer({ port: 0, command: ["/bin/sh", "-c", lines.join("; ")], assets: await loadWebAssets() });
  owned.servers.push(app);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_BIN,
      headless: true,
      args: ["--no-sandbox"],
    });
    owned.browser = browser;
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    await watchRenderer(page);
    await page.goto(app.url);
    await page.waitForFunction(() => document.querySelector("#terminal")?.textContent?.includes("Explicit RGB peach"));
    await page.waitForTimeout(200);
    const paint = await paintedTerminal(page);
    const colors = await page.evaluate(() => {
      const canvas = document.querySelector(".terminal-pane:not([hidden]) canvas");
      const cells = [...window.terminalPaint.get(canvas).values()];
      const ys = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
      const rows = ys.map((y) => cells.filter((c) => c.y === y).sort((a, b) => a.x - b.x));
      const fg = (text) => {
        const row = rows.find((r) =>
          r
            .map((c) => c.text)
            .join("")
            .startsWith(text),
        );
        return row?.find((c) => c.text.trim())?.color;
      };
      return {
        page: getComputedStyle(document.body).backgroundColor,
        terminal:
          "rgb(" +
          [...canvas.getContext("2d").getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data]
            .slice(0, 3)
            .join(", ") +
          ")",
        defaultFg: fg("DEFAULT"),
        ansi: Array.from({ length: 16 }, (_, i) => fg("ANSI " + i + " ")),
        rgb: fg("Explicit RGB peach"),
      };
    });
    // Canvas normalizes fillStyle to #rrggbb, not CSS computed rgb().
    const rgb = (hex) =>
      "rgb(" +
      hex
        .slice(1)
        .match(/../g)
        .map((v) => parseInt(v, 16))
        .join(", ") +
      ")";
    colors.defaultFg = rgb(colors.defaultFg);
    colors.ansi = colors.ansi.map(rgb);
    colors.rgb = rgb(colors.rgb);
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
    console.log(JSON.stringify({ pass: true, colors, ink: paint.ink, proof }));
  } finally {
    await owned.stop();
  }
});
