import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const patch = readFileSync(resolve(root, "integrations/t3/upstream/bruv.patch"), "utf8");
const build = readFileSync(resolve(root, "integrations/t3/build/build.ts"), "utf8");

// Test the shipped canonical patch, not a loose upstream checkout.
test("Android optional native dependency is staged and verified", () => {
  expect(patch).toContain("+  os: [current, android, darwin, linux, win32]");
  expect(build).toContain('"@yuuang/ffi-rs-android-arm64"');
  // The official lockfile is unchanged, so dependency records need not be in the delta.
  // The build must inspect the actual deployed optional dependency graph.
  expect(build).toContain("await verifyPortableOptionalDependencies(output)");
});

test("fff-node is loaded on demand and unsupported Android search is a typed failure", () => {
  const index = patch
    .split("diff --git a/apps/server/src/workspace/WorkspaceSearchIndex.ts ")[1]
    ?.split("diff --git ")[0];
  expect(index).toBeDefined();
  expect(index).toContain('-const { FileFinder } = requireForFff("@ff-labs/fff-node")');
  expect(index).toContain('+      if (process.platform === "android") {');
  const additions = index!
    .split("\n")
    .filter((line) => line.startsWith("+"))
    .map((line) => line.slice(1))
    .join("\n");
  expect(additions).toMatch(/throw new Error\(\s*"Workspace search is unavailable on Android/);
  expect(additions).toMatch(/const \{ FileFinder \} = requireForFff\(\s*"@ff-labs\/fff-node"/);
  expect(index).toContain("new WorkspaceSearchIndexCreateFailed({");
});
