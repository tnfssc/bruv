import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { launchBrowser } from "./browser";
const root = resolve(import.meta.dir, "..");
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
  const cells = await page.evaluate(async (text) => {
    // @ts-ignore Browser module is served from the installed, pinned package.
    const { init, Terminal } = await import("/ghostty-web.js");
    await init();
    const t = new Terminal({
      cols: 110,
      rows: 36,
      fontSize: 15,
      fontFamily: "DejaVu Sans Mono",
      theme: { background: "#141820", foreground: "#d5dce5" },
    });
    t.open(document.querySelector("#terminal"));
    await new Promise<void>((done) => t.write(text, done));
    return Array.from({ length: 36 }, (_, y) =>
      Array.from({ length: 110 }, (_, x) => {
        const c = t.buffer.active.getLine(y).getCell(x);
        const rgb = (value: number) => [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(";");
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
        return {
          text: c.getChars() || " ",
          style: [...flags, "38;2;" + rgb(c.getFgColor()), "48;2;" + rgb(c.getBgColor())].join(";"),
        };
      }),
    );
  }, text);

  const rows = cells.slice(19, 34).map((row) => {
    const runs: { text: string; style: string }[] = [];
    for (const cell of row.slice(0, 56)) {
      const prev = runs.at(-1);
      if (prev?.style === cell.style) prev.text += cell.text;
      else runs.push({ ...cell });
    }
    return runs;
  });
  const data = {
    source: "cli-settings.txt",
    sha256: createHash("sha256").update(text).digest("hex"),
    sourceCols: 110,
    sourceRows: 36,
    crop: { x: 0, y: 19, cols: 56, rows: 15 },
    cols: 56,
    rows,
  };
  await Bun.write(resolve(root, "assets/settings-cells.json"), JSON.stringify(data, null, 2) + "\n");
  console.log("Extracted", rows.length, "rows of faithful glyph/color/style runs from Ghostty.");
} finally {
  await browser.close();
  server.stop(true);
}
