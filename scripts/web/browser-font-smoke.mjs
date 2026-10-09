import { watchRenderer, paintedTerminal } from "./browser-renderer-proof.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const project = resolve(import.meta.dir, "../..");
const proof = join(project, "artifacts/ghostty/font");
const isolated = await mkdtemp(join(tmpdir(), "bruv-font-proof-"));
await mkdir(proof, { recursive: true });
const binary = join(isolated, "font-server");
const build = Bun.spawn(
  [process.execPath, "build", "--compile", join(project, "tests/web/fixtures/font-server.ts"), "--outfile", binary],
  { stdout: "inherit", stderr: "inherit" },
);
assert.equal(await build.exited, 0);
const proc = Bun.spawn([binary], {
  cwd: isolated,
  env: { ...process.env, FONT_TEST_BUN: process.execPath },
  stdout: "pipe",
  stderr: "inherit",
});
let output = "";
void (async () => {
  for await (const c of proc.stdout) output += new TextDecoder().decode(c);
})();
async function until(check, message) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > end) throw Error(message);
    await Bun.sleep(25);
  }
}
let browser;
try {
  await until(() => output.includes("#token="), "No fixture URL");
  const url = output.match(/http:\/\/\S+/)[0];
  const fontPath = "/fonts/JetBrainsMonoNerdFontMono-Regular.woff2";
  const font = await fetch(new URL(fontPath, url));
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.match(font.headers.get("content-security-policy"), /font-src 'self'/);
  const bytes = new Uint8Array(await font.arrayBuffer());
  assert.equal(bytes.length, 1083072);
  assert.equal(
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    "2b777374f6ba42c46919fb5f8bb1f607ccff116bf54d44c7a453ebeb70b794a8",
  );
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN, headless: true, args: ["--no-sandbox"] });
  const results = [];
  for (const [name, viewport] of [
    ["desktop", { width: 1100, height: 720 }],
    ["phone", { width: 390, height: 680 }],
  ]) {
    const page = await browser.newPage({ viewport });
    await watchRenderer(page);
    const failures = [],
      sent = [];
    let text = "",
      fontRequested = false,
      release;
    page.on("pageerror", (e) => failures.push(String(e)));
    page.on("websocket", (socket) => {
      socket.on("framesent", (event) => {
        try {
          sent.push(JSON.parse(event.payload));
        } catch {}
      });
      socket.on("framereceived", (event) => {
        const m = JSON.parse(event.payload);
        if (m.type === "output") text += Buffer.from(m.data, "base64").toString();
      });
    });
    await page.route("**" + fontPath, async (route) => {
      fontRequested = true;
      await new Promise((r) => (release = r));
      await route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await until(() => fontRequested, "Font not requested");
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".terminal-pane canvas").count(), 0, "Terminal measured before font ready");
    release();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Connected");
    await until(() => sent.some((m) => m.type === "resize"), "No fitted resize");
    await page.waitForTimeout(300);
    const size = sent.filter((m) => m.type === "resize").at(-1);
    await until(() => text.includes("SIZE " + size.cols + " " + size.rows), "PTY did not match browser fit");
    await page.waitForTimeout(200);
    const geometry = await page.evaluate(() => {
      const family = '"JetBrainsMono Nerd Font Mono"';
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d");
      ctx.font = "14px " + family;
      const widths = [..."Mi0\uf07b\uf120\uf013\ue0b0"].map((c) => ctx.measureText(c).width);
      const screen = document.querySelector(".terminal-pane:not([hidden]) canvas");
      const cells = [...window.terminalPaint.get(screen).values()];
      const font = cells.find((c) => c.text.trim()).font;
      ctx.font = font;
      const ys = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
      const cellHeight = Math.min(...ys.slice(1).map((y, i) => y - ys[i]));
      return {
        loaded: document.fonts.check("14px " + family),
        widths,
        family: font,
        rowWidth: screen.getBoundingClientRect().width,
        rowHeight: cellHeight,
        rows: screen.getBoundingClientRect().height / cellHeight,
        text: document.querySelector(".terminal-pane:not([hidden]) .terminal-accessible-output").textContent,
        paintedGlyphs: [...new Set(cells.map((c) => c.text))],
        overflow: document.documentElement.scrollWidth > innerWidth,
        fontLoads: performance.getEntriesByType("resource").filter((e) => e.name.endsWith(".woff2")).length,
        ink: [..."\uf07b\uf120\uf013\ue0b0"].map((c) => {
          const m = ctx.measureText(c);
          return m.actualBoundingBoxRight + m.actualBoundingBoxLeft;
        }),
      };
    });
    assert(geometry.loaded);
    assert.match(geometry.family, /JetBrainsMono Nerd Font Mono/);
    assert(geometry.widths.every((w) => Math.abs(w - geometry.widths[0]) < 0.01));
    assert(geometry.ink.every((w) => w > 0));
    assert(!geometry.overflow);
    assert.equal(geometry.rows, size.rows);
    assert(Math.abs(geometry.rowWidth / size.cols - Math.ceil(geometry.widths[0])) < 0.02);
    assert(geometry.text.includes("\uf07b"));
    assert(geometry.paintedGlyphs.includes("\uf07b"), "Nerd glyph was not painted");
    const paint = await paintedTerminal(page);
    assert.equal(geometry.fontLoads, 1);
    await page.locator(".terminal-pane:not([hidden]) textarea").focus();
    text = "";
    await page.keyboard.type("k");
    await until(() => text.includes("INPUT k"), "Keyboard input missing");
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(proof, name + ".png") });
    // A later fit must keep the same rows and columns, not drift after font paint.
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(250);
    assert.deepEqual(sent.filter((m) => m.type === "resize").at(-1), size);
    assert.deepEqual(failures, []);
    results.push({ name, size, geometry, paint: { ink: paint.ink, width: paint.width, height: paint.height } });
    await page.close();
  }
  await writeFile(join(proof, "measurements.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  proc.kill();
  await proc.exited;
}
