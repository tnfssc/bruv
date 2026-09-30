import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  cacheDigest,
  ciWebInputKey,
  producerEnvironment,
  rejectRootConfiguration,
  saveCache,
  verifyProducerSource,
  webInputs,
} from "../scripts/ci-web";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "die-ci-web-"));
  temporary.push(root);
  for (const file of webInputs) await Bun.write(resolve(root, file), file);
  return root;
}
const tools = { bun: "pinned", node: "pinned", pnpm: "pinned", compiler: "pinned", os: "pinned", libc: "pinned" };
test("CI web key is workspace/run independent, CLI source independent, and owns every producer input", async () => {
  const a = await fixture(),
    b = await fixture();
  const key = await ciWebInputKey(a, tools);
  expect(await ciWebInputKey(b, tools)).toBe(key);
  await Bun.write(a + "/src/cli.ts", "current CLI behavioral changes");
  expect(await ciWebInputKey(a, tools)).toBe(key);
  for (const file of webInputs) {
    await Bun.write(resolve(a, file), file + " changed");
    expect(await ciWebInputKey(a, tools)).not.toBe(key);
    await Bun.write(resolve(a, file), file);
  }
  await chmod(a + "/integrations/t3/upstream/bootstrap.mjs", 0o755);
  expect(await ciWebInputKey(a, tools)).not.toBe(key);
  expect(await ciWebInputKey(b, { ...tools, node: "other" })).not.toBe(key);
});
test("producer environment does not inherit credentials, workflow identity or Vite configuration", async () => {
  const root = await fixture();
  const env = producerEnvironment(root);
  expect(Object.keys(env).sort()).toEqual(
    [
      "CI",
      "HOME",
      "LANG",
      "LC_ALL",
      "PATH",
      "PNPM_CONFIG_STORE_DIR",
      "SOURCE_DATE_EPOCH",
      "TMPDIR",
      "TZ",
      "npm_config_userconfig",
      "npm_config_globalconfig",
      "npm_config_registry",
    ].sort(),
  );
  expect(env.CI).toBe("true");
  expect(env.HOME).toBe(resolve(root, ".cache/ci-web-home"));
  await Bun.write(root + "/.env.production", "SECRET=not-cacheable");
  await expect(rejectRootConfiguration(root)).rejects.toThrow("outside its contract");
});
test("exact receipt and digest required; every cache failure is a miss", async () => {
  const root = await fixture(),
    cache = root + "/cache",
    archive = root + "/archive.gz";
  expect(await cacheDigest(cache, "key")).toBeUndefined();
  await Bun.write(archive, "payload");
  await saveCache(cache, "key", archive);
  expect(await cacheDigest(cache, "key")).toBeTruthy();
  expect(await cacheDigest(cache, "different")).toBeUndefined();
  await Bun.write(cache + "/payload.gz", "corrupt");
  expect(await cacheDigest(cache, "key")).toBeUndefined();
  await Bun.write(cache + "/receipt.json", "invalid json");
  expect(await cacheDigest(cache, "key")).toBeUndefined();
});
test("pinned source validation rejects ignored build configuration before install/bundle", async () => {
  const root = await fixture();
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q");
  await Bun.write(root + "/input", "original\n");
  await Bun.write(root + "/.gitignore", ".env*\nnode_modules/\ndist/\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.org", "commit", "-qm", "fixture");
  await Bun.write(root + "/input", "patched\n");
  const patch = root + "/../" + root.split("/").at(-1) + "-patch";
  temporary.push(patch);
  await Bun.write(patch, git("diff"));
  await Bun.write(root + "/node_modules/generated", "installed");
  await verifyProducerSource(root, patch);
  await Bun.write(root + "/.env.local", "VITE_SECRET=outside contract");
  await expect(verifyProducerSource(root, patch)).rejects.toThrow("ignored input");
});
test("workflow uses exact read-only restore, trusted default-branch save and preserves both test groups", async () => {
  const workflow = await Bun.file(resolve(import.meta.dir, "../.github/workflows/ci.yml")).text();
  const section = workflow
    .split("      - name: Compute pinned web producer key")[1]!
    .split("      - name: Upload failure logs")[0]!;
  expect(section).toContain("actions/cache/restore@");
  expect(section).not.toContain("restore-keys:");
  expect(section).toContain("actions/cache/save@");
  expect(section).toContain("github.event_name != 'pull_request'");
  expect(section).toContain("github.event.repository.default_branch");
  const runner = await Bun.file(resolve(import.meta.dir, "../scripts/ci.sh")).text();
  expect(runner).toContain('wait "$web_pid" || status=1');
  expect(runner).toContain('wait "$root_pid" || status=1');
  expect(runner).toContain("bun test --parallel=3 ./tests");
  expect(runner).toContain("--reuse-packed-web");
  const validation = await Bun.file(resolve(import.meta.dir, "../scripts/ci-web-validation.sh")).text();
  expect(validation).not.toContain("Typecheck web backend");
  expect(validation).not.toContain("Typecheck web client");
  expect(validation).toContain("Typecheck terminal client");
  expect(validation).toContain("NativeDieIntegration.production.test.ts");
});
