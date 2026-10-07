import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { launchBrowser } from "./browser";
const root = resolve(import.meta.dir, "..");
const terminalSize = { cols: 110, rows: 36 };
const crop = { x: 0, y: 19, cols: 56, rows: 15 };
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/")
      return new Response('<!doctype html><div id="terminal"></div>', { headers: { "Content-Type": "text/html" } });
    const files: Record<string, string> = {
      "/ghostty-web.js": "dist/ghostty-web.js",
      "/ghostty-vt.wasm": "ghostty-vt.wasm",
      "/__vite-browser-external-2447137e.js": "dist/__vite-browser-external-2447137e.js",
    };
    if (!files[path]) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(resolve(root, "node_modules/ghostty-web", files[path])), {
      headers: { "Content-Type": path.endsWith("wasm") ? "application/wasm" : "text/javascript" },
    });
  },
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort(),
  );
  await page.goto(server.url.href);
  const text = await Bun.file(resolve(root, "assets/cli-settings.txt")).text();
  const rows = await page.evaluate(
    async ({ text, terminalSize, crop }) => {
      // @ts-ignore Browser module is served from the installed, pinned package.
      const { init, Terminal } = await import("/ghostty-web.js");
      await init();
      const t = new Terminal({
        ...terminalSize,
        fontSize: 15,
        fontFamily: "DejaVu Sans Mono",
        theme: { background: "#141820", foreground: "#d5dce5" },
      });
      t.open(document.querySelector("#terminal"));
      await new Promise<void>((done) => t.write(text, done));
      const rgb = (value: number) => [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(";");
      return Array.from({ length: crop.rows }, (_, y) => {
        const line = t.buffer.active.getLine(crop.y + y);
        const runs: { text: string; style: string }[] = [];
        for (let x = 0; x < crop.cols; x++) {
          const c = line.getCell(crop.x + x);
          const flags = [
            [c.isBold(), 1],
            [c.isDim(), 2],
            [c.isItalic(), 3],
            [c.isUnderline(), 4],
            [c.isInverse(), 7],
            [c.isInvisible(), 8],
            [c.isStrikethrough(), 9],
          ]
            .filter(([v]) => v)
            .map(([, flag]) => flag);
          const cell = {
            text: c.getChars() || " ",
            style: [...flags, "38;2;" + rgb(c.getFgColor()), "48;2;" + rgb(c.getBgColor())].join(";"),
          };
          const prev = runs.at(-1);
          if (prev?.style === cell.style) prev.text += cell.text;
          else runs.push(cell);
        }
        return runs;
      });
    },
    { text, terminalSize, crop },
  );

  const data = {
    source: "cli-settings.txt",
    sha256: createHash("sha256").update(text).digest("hex"),
    sourceCols: terminalSize.cols,
    sourceRows: terminalSize.rows,
    crop,
    cols: crop.cols,
    rows,
  };
  await Bun.write(resolve(root, "assets/settings-cells.json"), JSON.stringify(data, null, 2) + "\n");
  console.log("Extracted", rows.length, "rows of faithful glyph/color/style runs from Ghostty.");
} finally {
  await browser.close();
  server.stop(true);
}
