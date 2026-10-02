import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const gate = resolve(import.meta.dir, "../../integrations/t3/upstream/chunks-startup.test.mjs");
async function check(files: Record<string, string>, selectedGate = gate, manifest?: object) {
  const directory = await mkdtemp(join(tmpdir(), "bruv-chunks-"));
  try {
    await mkdir(join(directory, "assets"));
    for (const [name, code] of Object.entries(files)) await writeFile(join(directory, "assets", name), code);
    if (manifest) {
      await mkdir(join(directory, ".vite"));
      await writeFile(join(directory, ".vite/manifest.json"), JSON.stringify(manifest));
    }
    const result = Bun.spawnSync(["node", "--test", selectedGate], {
      env: { ...process.env, T3_WEB_DIST: directory },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("production graph gate rejects the release's cyclic static binding pattern", async () => {
  const result = await check({
    "effect-array.js": 'import { dual } from "./effect-function.js"; export const append = dual(2);',
    "effect-function.js": 'import { append } from "./effect-array.js"; export var dual = () => append;',
  });
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("cyclic chunks:");
});

test("production graph gate accepts a static DAG and lazy back references", async () => {
  const result = await check({
    "main.js": 'import "./shared.js"; export const lazy = () => import("./lazy.js");',
    "shared.js": "export const shared = 1;",
    "lazy.js": 'import "./main.js";',
  });
  expect(result.code).toBe(0);
});

test("production graph gate rejects incomplete or empty output", async () => {
  expect((await check({})).code).not.toBe(0);
  const result = await check({ "main.js": 'export { missing } from "./missing.js";' });
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("missing static dependency");
});

test("upstream payload gate requires real lazy files, including shared C++", async () => {
  const payloadGate = resolve(import.meta.dir, "../../integrations/t3/upstream/chunks-large-data.test.mjs");
  const heic = "vendor/node_modules/heic-to/dist/csp/heic-to.js";
  const manifest = {
    "src/main.tsx": { file: "assets/main.js", imports: ["shared"] },
    shared: { file: "assets/shared.js" },
    [heic]: { file: "assets/heic.js", isDynamicEntry: true },
    "vendor/node_modules/shiki/dist/wasm.mjs": { file: "assets/wasm.js", isDynamicEntry: true },
    "_cpp-hash.js": { file: "assets/cpp-hash.js" },
    "vendor/node_modules/@shikijs/langs/dist/emacs-lisp.mjs": {
      file: "assets/emacs-lisp-hash.js",
      isDynamicEntry: true,
    },
    "src/routes/_chat.tsx?tsr-split=component": { file: "assets/chat.js", isDynamicEntry: true },
  };
  const files = Object.fromEntries(Object.values(manifest).map(({ file }) => [file.slice(7), "export {};"]));
  expect((await check(files, payloadGate, manifest)).code).toBe(0);
  const { [heic]: _omitted, ...missing } = manifest;
  const absent = await check(files, payloadGate, missing);
  expect(absent.code).not.toBe(0);
  expect(absent.output).toContain("missing payload:");
  const { ["cpp-hash.js"]: _missingFile, ...incomplete } = files;
  expect((await check(incomplete, payloadGate, manifest)).code).not.toBe(0);
  const empty = await check({ ...files, "cpp-hash.js": "" }, payloadGate, manifest);
  expect(empty.code).not.toBe(0);
  expect(empty.output).toContain("empty emitted file:");
  // An eager alias to the shared C++ file must fail too, not just direct package imports.
  for (const eager of [heic, "cpp-alias"]) {
    const result = await check(files, payloadGate, {
      ...manifest,
      "cpp-alias": manifest["_cpp-hash.js"],
      shared: { ...manifest.shared, imports: [eager] },
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("startup payload:");
  }
});
