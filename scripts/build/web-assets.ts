import { resolve } from "node:path";

/** Bundle browser code at build time; the installed binary needs no node_modules. */
export async function prepareWebAssets(
  root: string,
  write: (target: string, content: string | Uint8Array) => Promise<void>,
) {
  const build = await Bun.build({
    entrypoints: [resolve(root, "src/web/browser.ts")],
    target: "browser",
    minify: true,
  });
  if (!build.success) throw new Error(build.logs.map(String).join("\n"));
  const out = resolve(root, "dist/runtime-assets/web");
  const javascript = build.outputs[0];
  if (!javascript) throw new Error("Browser build output missing");
  await write(resolve(out, "terminal.js.asset"), await javascript.text());
  await write(
    resolve(out, "ghostty-vt.wasm.asset"),
    await Bun.file(resolve(root, "node_modules/ghostty-web/ghostty-vt.wasm")).bytes(),
  );
  const wordmark = await Bun.file(resolve(root, "site/assets/brand/bruv-wordmark-light.svg")).text();
  const icon = await Bun.file(resolve(root, "site/assets/brand/bruv-icon.svg")).text();
  const html = (await Bun.file(resolve(root, "src/web/index.html")).text())
    .replace("<!-- BRUV_WORDMARK -->", wordmark)
    .replace("__BRUV_ICON__", "data:image/svg+xml," + encodeURIComponent(icon));
  await write(resolve(out, "index.html.asset"), html);
  await write(
    resolve(out, "JetBrainsMonoNerdFontMono-Regular.woff2.asset"),
    await Bun.file(resolve(root, "src/web/fonts/JetBrainsMonoNerdFontMono-Regular.woff2")).bytes(),
  );
  const controls = await Bun.build({
    entrypoints: [resolve(root, "src/web/controls.css")],
    target: "browser",
    minify: true,
  });
  if (!controls.success) throw new Error(controls.logs.map(String).join("\n"));
  const css = controls.outputs[0];
  if (!css) throw new Error("Browser controls output missing");
  await write(
    resolve(out, "terminal.css.asset"),
    (await css.text()) +
      "\n" +
      (await Bun.file(resolve(root, "src/web/browser.css")).text()) +
      "\n" +
      (await Bun.file(resolve(root, "src/web/terminal-font.css")).text()),
  );
}
