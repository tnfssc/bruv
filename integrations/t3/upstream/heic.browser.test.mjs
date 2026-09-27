import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { test } from "node:test";

// Run against a real production build, not mocked canvas or decoder APIs.
// T3_WEB_DIST, T3_HEIC_SAMPLE and PLAYWRIGHT_MODULE identify disposable test inputs.
test("emitted codec workers decode HEIC and highlight lazy C++/Elisp grammars", { timeout: 60000 }, async () => {
  const dist = resolve(process.env.T3_WEB_DIST);
  const sample = await readFile(process.env.T3_HEIC_SAMPLE);
  const manifest = JSON.parse(await readFile(resolve(dist, ".vite/manifest.json"), "utf8"));
  const entry = manifest["src/lib/heicToWasm.ts"];
  assert.equal(entry.isDynamicEntry, true);
  const grammar = (name) =>
    Object.entries(manifest).find(([id]) => id.endsWith(`/@shikijs/langs/dist/${name}.mjs`))?.[1].file;
  const worker = (await readdir(resolve(dist, "assets"))).find((name) => /^worker-[\w-]+\.js$/.test(name));
  assert.ok(grammar("cpp") && grammar("emacs-lisp") && worker);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/probe") return response.end("<!doctype html><title>HEIC probe</title>");
      if (url.pathname === "/sample.heic") return response.end(sample);
      const file = resolve(dist, `.${url.pathname}`);
      if (!file.startsWith(dist + sep)) {
        response.writeHead(403);
        return response.end();
      }
      const mime = { ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" }[
        extname(file)
      ];
      response.setHeader("Content-Type", mime ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let deadline;
  try {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
    deadline = setTimeout(() => browser.close(), 45000);
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/probe`);
    const result = await page.evaluate(
      async ({ entry, cpp, el, worker }) => {
        const { heicTo } = await import(`/${entry}`);
        const blob = await (await fetch("/sample.heic")).blob();
        const converted = await Promise.all(
          Array.from({ length: 3 }, () => heicTo({ blob, type: "image/jpeg", quality: 0.8 })),
        );
        const dimensions = await Promise.all(
          converted.map(async (jpeg) => {
            const image = await createImageBitmap(jpeg);
            const value = { type: jpeg.type, size: jpeg.size, width: image.width, height: image.height };
            image.close();
            return value;
          }),
        );
        let rejected = false;
        try {
          await heicTo({ blob: new Blob(["not a HEIC"]), type: "image/jpeg", quality: 0.8 });
        } catch {
          rejected = true;
        }
        const recovered = await heicTo({ blob, type: "image/jpeg", quality: 0.8 });
        const cppData = (await import(`/${cpp}`)).default;
        const elData = (await import(`/${el}`)).default;
        const highlighter = new Worker(`/assets/${worker}`, { type: "module" });
        let nextId = 0;
        function ask(request) {
          return new Promise((resolve, reject) => {
            const id = ++nextId;
            const deadline = setTimeout(() => reject(new Error("highlight worker timeout")), 15000);
            const handler = (event) => {
              if (event.data.id !== id) return;
              clearTimeout(deadline);
              highlighter.removeEventListener("message", handler);
              if (event.data.type === "error") reject(new Error(event.data.error));
              else resolve(event.data);
            };
            highlighter.addEventListener("message", handler);
            highlighter.postMessage({ ...request, id });
          });
        }
        let highlights;
        try {
          const theme = {
            name: "test",
            type: "dark",
            colors: { "editor.background": "#111111", "editor.foreground": "#ffffff" },
            tokenColors: [
              { scope: "comment", settings: { foreground: "#AA00AA" } },
              { scope: "keyword", settings: { foreground: "#FF0000" } },
            ],
          };
          await ask({
            type: "initialize",
            preferredHighlighter: "shiki-wasm",
            renderOptions: { theme: "test", useTokenTransformer: false, tokenizeMaxLineLength: 1000 },
            resolvedThemes: [theme],
            resolvedLanguages: [
              { name: "cpp", data: cppData },
              { name: "emacs-lisp", data: elData },
            ],
          });
          const cppResult = await ask({
            type: "file",
            file: { name: "test.cpp", lang: "cpp", contents: "// comment\nint value = 42;" },
          });
          const elResult = await ask({
            type: "file",
            file: { name: "test.el", lang: "emacs-lisp", contents: ";;; comment\n(defun example () 42)" },
          });
          highlights = {
            cpp: JSON.stringify(cppResult.result.code).includes("#FF0000"),
            elisp: JSON.stringify(elResult.result.code).includes("#AA00AA"),
          };
        } finally {
          highlighter.terminate();
        }
        return { dimensions, rejected, recoveredType: recovered.type, highlights };
      },
      { entry: entry.file, cpp: grammar("cpp"), el: grammar("emacs-lisp"), worker },
    );
    assert.equal(result.rejected, true);
    assert.equal(result.recoveredType, "image/jpeg");
    assert.deepEqual(result.highlights, { cpp: true, elisp: true });
    for (const image of result.dimensions) {
      assert.equal(image.type, "image/jpeg");
      assert.ok(image.size > 100);
      assert.ok(image.width > 0 && image.height > 0);
    }
    console.log(JSON.stringify(result));
  } finally {
    clearTimeout(deadline);
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
