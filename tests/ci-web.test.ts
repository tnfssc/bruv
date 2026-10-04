import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const root = await mkdtemp(resolve(tmpdir(), "bruv-ci-web-"));
  temporary.push(root);
  for (const file of webInputs) await Bun.write(resolve(root, file), file);
  return root;
}
// These historical producer unit tests do not install the retired CI toolchain.
// Resolve fixture executables, never substitute a tool in the real producer.
async function withProducerTools<T>(root: string, run: () => Promise<T>): Promise<T> {
  for (const tool of ["node", "pnpm"]) {
    await writeFile(resolve(root, tool), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  }
  const previous = process.env.PATH;
  process.env.PATH = root;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
}
const tools = { bun: "pinned", node: "pinned", pnpm: "pinned", compiler: "pinned", os: "pinned", libc: "pinned" };
test("historical web key is workspace/run independent, CLI source independent, and owns every producer input", async () => {
  await withProducerTools(await fixture(), async () => {
    // Release runners legitimately set this for their own T3 build. Exercise that
    // inherited state, retain the custom-source guard, then use a clean fixture env.
    const previousSource = process.env.BRUV_T3_SOURCE;
    try {
      process.env.BRUV_T3_SOURCE = "/release/runner/custom-t3-source";
      await expect(ciWebInputKey(await fixture(), tools)).rejects.toThrow("owns BRUV_T3_SOURCE");
      delete process.env.BRUV_T3_SOURCE;

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
    } finally {
      if (previousSource === undefined) delete process.env.BRUV_T3_SOURCE;
      else process.env.BRUV_T3_SOURCE = previousSource;
    }
  });
});
test("producer environment does not inherit credentials, workflow identity or Vite configuration", async () => {
  const root = await fixture();
  await withProducerTools(root, async () => {
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
});
test("historical producer still fails closed when pnpm is missing", async () => {
  const root = await fixture();
  await withProducerTools(root, async () => {
    await rm(resolve(root, "pnpm"));
    expect(() => producerEnvironment(root)).toThrow("Missing producer tool: pnpm");
    await expect(ciWebInputKey(root)).rejects.toThrow("Missing producer tool: pnpm");
  });
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
test("production CI caches downloads only and delegates paired validation to the shared runner", async () => {
  const workflow = await Bun.file(resolve(import.meta.dir, "../.github/workflows/ci.yml")).text();
  expect(workflow).not.toContain("ci-web.ts");
  expect(workflow).not.toContain("PNPM_CONFIG_STORE_DIR");
  expect(workflow).not.toContain("pnpm/action-setup");
  expect(workflow).not.toContain("Compute pinned web producer key");
  const parsed = Bun.YAML.parse(workflow) as {
    jobs: Record<string, { steps: { uses?: string; run?: string; with?: Record<string, string> }[] }>;
  };
  let downloadCaches = 0;
  for (const job of Object.values(parsed.jobs)) {
    for (const step of job.steps.filter((step) => step.uses?.startsWith("actions/cache"))) {
      downloadCaches++;
      expect(step.with?.path).toBe("${{ runner.temp }}/bruv-bun-cache");
      expect(step.with?.key).toContain("bun-1.4.2-");
    }
  }
  expect(downloadCaches).toBeGreaterThan(0);
  expect(parsed.jobs.test!.steps.some((step) => step.run === "bun run ci")).toBe(true);
  const runner = await Bun.file(resolve(import.meta.dir, "../scripts/ci.sh")).text();
  for (const gate of [
    "bun install --frozen-lockfile",
    "bun run format:check",
    "bun run lint",
    "bun run check",
    "bun run build",
    "bun scripts/offline-openai-default-transport.ts",
    "bun test --parallel=3 ./tests",
    "bun run smoke -- --reuse-build",
  ])
    expect(runner).toContain(gate);
  expect(runner).not.toContain("ci-web-validation.sh");
  expect(runner).not.toContain("--reuse-packed-web");
});
