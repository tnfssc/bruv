import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { launchBrowser } from "./browser";
// Disposable browser probe: native Ghostty support is not evidence for this package.
const root = resolve(import.meta.dir, ".."),
  scratch = await mkdtemp(resolve(tmpdir(), "bruv-image-probe-"));
const evidence = resolve(root, "../wisdom/landing-page/validation/vesper");
await mkdir(evidence, { recursive: true });
const entry = resolve(scratch, "probe.ts");
await Bun.write(
  entry,
  [
    "import { Ghostty, Terminal } from " +
      JSON.stringify(resolve(root, "node_modules/ghostty-web/dist/ghostty-web.js")) +
      ";",
    'const ghostty = await Ghostty.load("/ghostty-vt.wasm");',
    'const term = new Terminal({ ghostty, cols: 60, rows: 20, fontSize: 16, theme: { background: "#101010", foreground: "#ffffff" } });',
    'term.open(document.getElementById("probe")); window.term = term;',
    'term.write("\\x1b[?25l\\x1b[2J\\x1b[H"); window.ready = true;',
  ].join("\n"),
);
const bundle = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm" });
if (!bundle.success) throw new Error(String(bundle.logs));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/probe.js")
      return new Response(bundle.outputs[0], { headers: { "Content-Type": "text/javascript" } });
    if (path === "/ghostty-vt.wasm")
      return new Response(Bun.file(resolve(root, "node_modules/ghostty-web/ghostty-vt.wasm")));
    return new Response(
      '<!doctype html><html><head><style>body{margin:0;background:#101010}</style></head><body><div id="probe"></div><script type="module" src="/probe.js"></script></body></html>',
      { headers: { "Content-Type": "text/html" } },
    );
  },
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.goto(server.url.href);
  await page.waitForFunction(() => (window as any).ready);
  const results: Record<string, unknown> = {
    package: "ghostty-web@0.4.0",
    note: "Basic direct-display probes, not a protocol conformance suite.",
  };
  for (const protocol of ["kitty", "sixel"]) {
    const result = await page.evaluate(async (protocol) => {
      const term = (window as any).term;
      term.write("\x1b[?25l\x1b[2J\x1b[H");
      await new Promise((r) => setTimeout(r, 150));
      const canvas = term.renderer.getCanvas();
      const before = canvas.toDataURL();
      const image = document.createElement("canvas");
      image.width = image.height = 8;
      const ctx = image.getContext("2d")!;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 8, 8);
      const png = image.toDataURL("image/png").split(",")[1];
      const sequence =
        protocol === "kitty" ? "\x1b_Ga=T,f=100,c=6,r=3;" + png + "\x1b\\" : "\x1bPq#1;2;100;0;0#1!60~-!60~-!60~\x1b\\";
      term.write(sequence);
      await new Promise((r) => setTimeout(r, 200));
      return {
        unchanged: canvas.toDataURL() === before,
        sequenceBytes: sequence.length,
        width: canvas.width,
        height: canvas.height,
      };
    }, protocol);
    results[protocol] = result;
    await page.screenshot({ path: resolve(evidence, "probe-" + protocol + ".png") });
  }
  await Bun.write(resolve(evidence, "protocol-probe.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(results);
} finally {
  await browser.close();
  server.stop(true);
  await rm(scratch, { recursive: true, force: true });
}
