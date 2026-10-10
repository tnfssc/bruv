import { describe, expect, test } from "bun:test";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { run } from "../helpers/helpers";

const root = resolve(import.meta.dir, "../..");

async function copyPreparationInputs(fixture: string): Promise<void> {
  for (const path of [
    "package.json",
    "site/assets/brand/bruv-wordmark-light.svg",
    "site/assets/brand/bruv-icon.svg",
    "scripts/build/prepare-assets.ts",
    "scripts/build/web-assets.ts",
    "src/web/browser.ts",
    "src/web/browser-terminal-touch.ts",
    "src/web/browser-terminal-accessibility.ts",
    "src/web/browser-audio.ts",
    "src/live/browser-protocol.ts",
    "src/web/index.html",
    "src/web/browser.css",
    "src/web/controls.css",
    "src/web/terminal-font.css",
    "src/web/fonts/JetBrainsMonoNerdFontMono-Regular.woff2",
    "scripts/build/pi-host-adaptation.ts",
    "scripts/build/pi-host-recovery.ts",
    "node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm",
  ]) {
    const target = join(fixture, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, path), target);
  }
  // Host adaptation may write to Pi. Copy it; never link the shared dependency into this fixture.
  const piPackage = "node_modules/@earendil-works/pi-coding-agent";
  await cp(join(root, piPackage), join(fixture, piPackage), { recursive: true });
  for (const name of ["ghostty-web", "daisyui", "sortablejs"]) {
    await cp(join(root, "node_modules", name), join(fixture, "node_modules", name), { recursive: true });
  }
}

async function filesWithMtimes(assets: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  const entries = await readdir(assets, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = join(entry.parentPath, entry.name);
        return { path: relative(assets, path), mtimeMs: (await stat(path)).mtimeMs };
      }),
  );
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function prepareAssets(fixture: string): Promise<void> {
  const result = await run([process.execPath, join(fixture, "scripts/build/prepare-assets.ts")], { cwd: fixture });
  expect(result).toMatchObject({ code: 0 });
}

describe("build asset preparation", () => {
  test("keeps only required assets and does not rewrite unchanged files", async () => {
    await mkdir(join(root, ".tmp"), { recursive: true });
    const fixture = await mkdtemp(join(root, ".tmp/bruv-prepare-assets-"));
    const assets = join(fixture, "dist", "runtime-assets");
    const retained = join(fixture, "artifacts", "retained-run.txt");
    try {
      await copyPreparationInputs(fixture);
      await mkdir(dirname(retained), { recursive: true });
      await writeFile(retained, "retained run evidence");
      await prepareAssets(fixture);
      const generated = await filesWithMtimes(assets);
      expect(generated.map((file) => file.path)).toEqual([
        "assets/clankolas.png",
        "export-html/template.html",
        "export-html/vendor/highlight.min.js",
        "export-html/vendor/marked.min.js",
        "package.json",
        "photon_rs_bg.wasm",
        "theme/dark.json",
        "theme/light.json",
        "theme/theme-schema.json",
        "web/ghostty-vt.wasm.asset",
        "web/index.html.asset",
        "web/JetBrainsMonoNerdFontMono-Regular.woff2.asset",
        "web/terminal.css.asset",
        "web/terminal.js.asset",
      ]);

      expect(await readdir(fixture)).not.toContain("runtime-assets");
      // Path-only staging changes must preserve the exact upstream bytes, including
      // bundled vendor license banners. Only package metadata is generated here.
      for (const { path } of generated) {
        if (path === "package.json" || path.startsWith("web/")) continue;
        const source =
          path === "photon_rs_bg.wasm"
            ? join(fixture, "node_modules/@silvia-odwyer/photon-node", path)
            : join(
                fixture,
                "node_modules/@earendil-works/pi-coding-agent/dist",
                path.startsWith("export-html/") ? "core" : "modes/interactive",
                path,
              );
        expect(await readFile(join(assets, path))).toEqual(await readFile(source));
      }

      const html = await readFile(join(assets, "web/index.html.asset"), "utf8");
      const wordmark = await readFile(join(fixture, "site/assets/brand/bruv-wordmark-light.svg"), "utf8");
      const icon = await readFile(join(fixture, "site/assets/brand/bruv-icon.svg"), "utf8");
      expect(html).toBe(
        (await readFile(join(fixture, "src/web/index.html"), "utf8"))
          .replaceAll("<!-- BRUV_WORDMARK -->", wordmark)
          .replace("__BRUV_ICON__", "data:image/svg+xml," + encodeURIComponent(icon)),
      );
      expect(html).toContain(wordmark);
      expect(html).not.toContain("<!-- BRUV_WORDMARK -->");
      const wasm = await readFile(join(fixture, "node_modules/ghostty-web/ghostty-vt.wasm"));
      expect(await readFile(join(assets, "web/ghostty-vt.wasm.asset"))).toEqual(wasm);
      const css = await readFile(join(assets, "web/terminal.css.asset"), "utf8");
      expect(css).toContain("daisyUI 5.7.47 - MIT License");
      expect(css).toContain(".btn");
      expect(css).toContain(".input");
      expect(css).not.toContain(".modal-box");
      expect(css).not.toContain("@import");
      // Bun lowers logical corners and nesting. Keep the selective build well below the full 1.14 MB bundle.
      expect(Buffer.byteLength(css)).toBeLessThan(250_000);
      const browserCode = await readFile(join(assets, "web/terminal.js.asset"), "utf8");
      expect(browserCode).toContain("/ghostty-vt.wasm");
      expect(browserCode).not.toContain(wasm.toString("base64").slice(0, 256));

      // Old timestamps make a rewrite observable without relying on a sleep or clock resolution.
      const oldTime = new Date("2000-01-01T00:00:00Z");
      for (const file of generated) await utimes(join(assets, file.path), oldTime, oldTime);
      const before = await filesWithMtimes(assets);
      await prepareAssets(fixture);
      expect(await filesWithMtimes(assets)).toEqual(before);
      // Cleaning disposable staging must not erase retained run evidence.
      await rm(join(fixture, "dist"), { recursive: true });
      expect(await readFile(retained, "utf8")).toBe("retained run evidence");
      await prepareAssets(fixture);
      expect((await filesWithMtimes(assets)).map((file) => file.path)).toEqual(generated.map((file) => file.path));
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
