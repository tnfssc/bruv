/** Replay REAL CLI captures in Ghostty; never synthesize application output.
 * Uses site-scoped dependencies. GHOSTTY_WEB_DIR, PLAYWRIGHT_CORE_DIR and
 * CHROMIUM_BIN can override their locations.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const ghosttyDir = process.env.GHOSTTY_WEB_DIR || resolve(import.meta.dir, "../node_modules/ghostty-web");
const playwrightDir = process.env.PLAYWRIGHT_CORE_DIR || resolve(import.meta.dir, "../node_modules/playwright-core");
const { chromium } = await import(pathToFileURL(resolve(playwrightDir, "index.mjs")).href);
const assets = resolve(import.meta.dir, "../assets");
const captures = [
  { name: "cli-settings", cols: 110, rows: 36, crlf: false },
  { name: "cli-help", cols: 110, rows: 36, crlf: true },
];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/")
      return new Response(
        '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#141820}#terminal{display:inline-block;padding:20px}</style></head><body><div id="terminal"></div></body></html>',
        { headers: { "Content-Type": "text/html" } },
      );
    const files: Record<string, string> = {
      "/ghostty-web.js": resolve(ghosttyDir, "dist/ghostty-web.js"),
      "/ghostty-vt.wasm": resolve(ghosttyDir, "ghostty-vt.wasm"),
      "/__vite-browser-external-2447137e.js": resolve(ghosttyDir, "dist/__vite-browser-external-2447137e.js"),
    };
    const file = files[url.pathname];
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(file), {
      headers: { "Content-Type": file.endsWith(".wasm") ? "application/wasm" : "text/javascript" },
    });
  },
});
const origin = "http://127.0.0.1:" + server.port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
try {
  console.log("Browser:", browser.version());
  for (const capture of captures) {
    const text = await Bun.file(resolve(assets, capture.name + ".txt")).text();
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 1 });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await page.goto(origin);
    await page.evaluate(
      async ({ text, cols, rows, crlf }) => {
        // Browser-side import: serve installed emulator files, not a hand-drawn TUI.
        const { init, Terminal } = await import("/ghostty-web.js");
        await init();
        await document.fonts.ready;
        const terminal = new Terminal({
          cols,
          rows,
          fontSize: 15,
          fontFamily: "DejaVu Sans Mono",
          cursorBlink: false,
          theme: { background: "#141820", foreground: "#d5dce5" },
        });
        terminal.open(document.getElementById("terminal"));
        await new Promise<void>((done) => terminal.write(crlf ? text.replace(/\r?\n/g, "\r\n") : text, done));
        if (crlf) terminal.scrollToTop();
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      },
      { ...capture, text },
    );
    const bounds = await page.locator("#terminal").boundingBox();
    // Settings: honest crop of terminal rows 17–36, excluding startup warning and blank rows.
    const clip =
      capture.name === "cli-settings" ? { ...bounds, y: bounds.y + 282, height: bounds.height - 282 } : bounds;
    await page.screenshot({ path: resolve(assets, capture.name + ".png"), clip, animations: "disabled" });
    console.log(capture.name, clip);
    await page.close();
  }
} finally {
  await browser.close();
  server.stop(true);
}
