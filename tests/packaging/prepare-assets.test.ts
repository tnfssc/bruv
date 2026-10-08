import { describe, expect, test } from "bun:test";
import { copyFile, cp, mkdir, mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { run } from "../helpers/helpers";

const root = resolve(import.meta.dir, "../..");

async function copyPreparationInputs(fixture: string): Promise<void> {
  for (const path of [
    "package.json",
    "scripts/build/prepare-assets.ts",
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
    const fixture = await mkdtemp(join(tmpdir(), "bruv-prepare-assets-"));
    const assets = join(fixture, "runtime-assets");
    try {
      await copyPreparationInputs(fixture);
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
      ]);

      // Old timestamps make a rewrite observable without relying on a sleep or clock resolution.
      const oldTime = new Date("2000-01-01T00:00:00Z");
      for (const file of generated) await utimes(join(assets, file.path), oldTime, oldTime);
      const before = await filesWithMtimes(assets);
      await prepareAssets(fixture);
      expect(await filesWithMtimes(assets)).toEqual(before);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
