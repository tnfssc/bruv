import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import product from "../package.json";
import { writeConnectorLauncher } from "../scripts/claude-compat-launcher";
import { updateAssetFor } from "../src/update";
import { run } from "./helpers";

let buildDir: string;
let dir: string;
let binary: string;
let wrapper: string;
let log: string;
const fixture = join(import.meta.dir, "connector-update-fixture.ts");

beforeAll(async () => {
  buildDir = await mkdtemp(join(tmpdir(), "bruv-connector-update-build-"));
  await writeConnectorLauncher(join(buildDir, "bruv-claude-compat"));
  const result = await Bun.build({
    entrypoints: [fixture],
    compile: { outfile: join(buildDir, "bruv") },
    minify: true,
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
}, 120_000);

afterAll(async () => {
  await rm(buildDir, { recursive: true, force: true });
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bruv connector update "));
  binary = join(dir, "bruv");
  wrapper = join(dir, "bruv-claude-compat");
  log = join(dir, "fetch.log");
  await copyFile(join(buildDir, "bruv"), binary);
  await writeConnectorLauncher(wrapper);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}) {
  // No PATH Bruv, credentials, actual HOME, or real install is reachable.
  return {
    HOME: dir,
    PATH: "/nonexistent",
    BRUV_TEST_FETCH_LOG: log,
    BRUV_TEST_LAUNCHER: join(buildDir, "bruv-claude-compat"),
    ...extra,
  };
}
const invocations = () => [
  [binary, "update"],
  [binary, "claude-compat", "update"],
  [wrapper, "update"],
];

test("all updater entries share compiled help without fetching or bootstrap", async () => {
  for (const command of invocations()) {
    for (const flag of ["--help", "-h"]) {
      const result = await run([...command, flag], { env: env() });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: bruv update [--check]");
      expect(result.stdout).toContain("SHA256 and version checks");
      expect(result.stdout).toContain("connector CLI identity is unknown to Claude version checks");
      expect(result.stdout).toContain("separate built-in Claude model too-old advisory can remain");
    }
  }
  expect(await Bun.file(log).exists()).toBe(false);
  expect(await Bun.file(join(dir, ".bruv")).exists()).toBe(false);
});

test("connector updater rejects mixed stream flags and other arguments before fetch", async () => {
  for (const command of invocations().slice(1)) {
    for (const args of [
      ["--input-format", "stream-json"],
      ["--check", "--output-format", "stream-json"],
      ["self"],
      ["--check", "--help"],
    ]) {
      const result = await run([...command, ...args], { env: env() });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Usage: bruv update [--check]");
      expect(result.stdout).not.toContain("Checking");
    }
  }
  expect(await Bun.file(log).exists()).toBe(false);
});

test("source connector update reaches paired updater and refuses honestly before fetch", async () => {
  for (const args of [["update"], ["update", "--check"]]) {
    const result = await run([process.execPath, fixture, "claude-compat", ...args], { env: env() });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Checking for Bruv pair updates...");
    expect(result.stderr).toContain(
      "Refusing to self-update a source Bun invocation; run the compiled bruv executable.",
    );
    expect(result.stderr).not.toContain("Unsupported");
  }
  expect(await Bun.file(log).exists()).toBe(false);
});

test("connector --check reads fake official pair metadata without replacing files", async () => {
  const before = await readFile(binary);
  const launcher = await readFile(wrapper);
  for (const command of invocations().slice(1)) {
    const result = await run([...command, "--check"], { env: env() });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Bruv pair update/repair available (99.0.0)");
  }
  expect(await readFile(binary)).toEqual(before);
  expect(await readFile(wrapper)).toEqual(launcher);
  expect((await readFile(log, "utf8")).trim().split("\n")).toEqual(
    Array(2).fill("https://api.github.com/repos/tnfssc/bruv/releases/latest"),
  );
});

test("standalone connector updates both temporary siblings with real checksum/version probes", async () => {
  const result = await run([wrapper, "update"], { env: env() });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Updated bruv and bruv-claude-compat to 99.0.0. Restart Bruv/T3 sessions.");
  expect((await run([binary, "--version"], { env: env() })).stdout.trim()).toBe("99.0.0");
  const requests = (await readFile(log, "utf8")).trim().split("\n");
  expect(requests).toHaveLength(5);
  expect(requests.filter((url) => url.endsWith(".sha256"))).toHaveLength(2);
  expect(await readFile(wrapper, "utf8")).toContain("exec");
  expect((await readdir(dir)).some((name) => name.startsWith(".bruv-update-"))).toBe(false);
});

test("subcommand repairs a missing same-version connector using the paired updater", async () => {
  await rm(wrapper);
  const result = await run([binary, "claude-compat", "update"], {
    env: env({ BRUV_TEST_RELEASE_VERSION: product.version }),
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Updated bruv and bruv-claude-compat to " + product.version);
  expect(await Bun.file(wrapper).exists()).toBe(true);
  expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(5);
});

test("bad connector checksum fails honestly and leaves the temporary pair unchanged", async () => {
  const before = await readFile(binary);
  const launcher = await readFile(wrapper);
  const connectorAsset = updateAssetFor(process.platform, process.arch)!.replace(/^bruv-/, "bruv-claude-compat-");
  const result = await run([wrapper, "update"], { env: env({ BRUV_TEST_BAD_CHECKSUM: connectorAsset }) });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Checksum verification failed for " + connectorAsset);
  expect(result.stderr).toContain("Installed files unchanged.");
  expect(result.stdout).not.toContain("Updated bruv");
  expect(await readFile(binary)).toEqual(before);
  expect(await readFile(wrapper)).toEqual(launcher);
  expect((await readdir(dir)).some((name) => name.startsWith(".bruv-update-"))).toBe(false);
});
