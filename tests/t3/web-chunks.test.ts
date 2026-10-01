import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const gate = resolve(import.meta.dir, "../../integrations/t3/upstream/chunks-startup.test.mjs");
async function check(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "bruv-chunks-"));
  try {
    await mkdir(join(directory, "assets"));
    for (const [name, code] of Object.entries(files)) await writeFile(join(directory, "assets", name), code);
    const result = Bun.spawnSync(["node", "--test", gate], {
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
