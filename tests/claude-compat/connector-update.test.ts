import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import product from "../../package.json";
import { writeConnectorLauncher } from "../../scripts/build/claude-compat-launcher";
import { RELEASES_URL, updateAssetFor } from "../../src/update";
import { run } from "../helpers/helpers";

// This compiles real root dispatch and uses the shipping launcher generator.
// Downloaded normal bytes are a shell version-probe stand-in, NOT shipping release proof.
const fixture = join(import.meta.dir, "connector-update-fixture.ts");
const releaseVersion = "99.0.0";
const normalAsset = updateAssetFor(process.platform, process.arch)!;
const connectorAsset = normalAsset.replace(/^bruv-/, "bruv-claude-compat-");
let compiledFixtureDir: string;
let installation: { dir: string; normal: string; connector: string; fetchLog: string };

beforeAll(async () => {
  compiledFixtureDir = await mkdtemp(join(tmpdir(), "bruv-connector-update-build-"));
  await writeConnectorLauncher(join(compiledFixtureDir, "bruv-claude-compat"));
  const result = await Bun.build({
    entrypoints: [fixture],
    compile: { outfile: join(compiledFixtureDir, "bruv") },
    minify: true,
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
}, 120_000);

afterAll(async () => {
  await rm(compiledFixtureDir, { recursive: true, force: true });
});
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv connector update "));
  installation = {
    dir,
    normal: join(dir, "bruv"),
    connector: join(dir, "bruv-claude-compat"),
    fetchLog: join(dir, "fetch.log"),
  };
  await copyFile(join(compiledFixtureDir, "bruv"), installation.normal);
  await writeConnectorLauncher(installation.connector);
});
afterEach(async () => {
  await rm(installation.dir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}) {
  // No PATH Bruv, credentials, actual HOME, or real install is reachable.
  return {
    HOME: installation.dir,
    PATH: "/nonexistent",
    BRUV_TEST_FETCH_LOG: installation.fetchLog,
    BRUV_TEST_LAUNCHER: join(compiledFixtureDir, "bruv-claude-compat"),
    ...extra,
  };
}

type Entry = "normal" | "subcommand" | "launcher";
function updateCommand(entry: Entry): string[] {
  switch (entry) {
    case "normal":
      return [installation.normal, "update"];
    case "subcommand":
      return [installation.normal, "claude-compat", "update"];
    case "launcher":
      return [installation.connector, "update"];
  }
}

async function installedBytes() {
  return {
    normal: await readFile(installation.normal),
    connector: await readFile(installation.connector),
  };
}
async function requests() {
  return (await readFile(installation.fetchLog, "utf8")).trim().split("\n");
}
function pairDownloads(version: string) {
  const base = "https://github.com/tnfssc/bruv/releases/download/v" + version + "/";
  return [
    RELEASES_URL,
    base + normalAsset,
    base + normalAsset + ".sha256",
    base + connectorAsset,
    base + connectorAsset + ".sha256",
  ];
}
async function expectStageCleaned() {
  expect((await readdir(installation.dir)).filter((name) => name.startsWith(".bruv-update-"))).toEqual([]);
}
async function expectPairVersion(version: string) {
  const normal = await run([installation.normal, "--version"], { env: env() });
  expect(normal.code).toBe(0);
  expect(normal.stdout.trim()).toBe(version);
  // --version is Claude CLI identity, not the product version the updater checks.
  const connector = await run([installation.connector, "--bruv-version"], { env: env() });
  expect(connector.code).toBe(0);
  expect(connector.stdout.trim()).toBe("bruv-claude-compat " + version);
}

describe("updater entry contracts through the offline compiled root", () => {
  test.each(["normal", "subcommand", "launcher"] as const)(
    "%s: help exits before fetch or bootstrap",
    async (entry) => {
      for (const flag of ["--help", "-h"]) {
        const result = await run([...updateCommand(entry), flag], { env: env() });
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("Usage: bruv update [--check]");
        expect(result.stdout).toContain("SHA256 and version checks");
        expect(result.stdout).toContain("connector CLI identity is unknown to Claude version checks");
        expect(result.stdout).toContain("separate built-in Claude model too-old advisory can remain");
      }
      expect(await Bun.file(installation.fetchLog).exists()).toBe(false);
      expect(await Bun.file(join(installation.dir, ".bruv")).exists()).toBe(false);
    },
  );

  test.each(["subcommand", "launcher"] as const)(
    "%s: rejects mixed stream flags and other arguments before fetch",
    async (entry) => {
      for (const args of [
        ["--input-format", "stream-json"],
        ["--check", "--output-format", "stream-json"],
        ["self"],
        ["--check", "--help"],
      ]) {
        const result = await run([...updateCommand(entry), ...args], { env: env() });
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("Usage: bruv update [--check]");
        expect(result.stdout).not.toContain("Checking");
      }
      expect(await Bun.file(installation.fetchLog).exists()).toBe(false);
    },
  );

  test("source connector reaches the paired updater but refuses before fetch", async () => {
    for (const args of [["update"], ["update", "--check"]]) {
      const result = await run([process.execPath, fixture, "claude-compat", ...args], { env: env() });
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("Checking for Bruv pair updates...");
      expect(result.stderr).toContain(
        "Refusing to self-update a source Bun invocation; run the compiled bruv executable.",
      );
      expect(result.stderr).not.toContain("Unsupported");
    }
    expect(await Bun.file(installation.fetchLog).exists()).toBe(false);
  });
});

describe("offline paired installation (synthetic downloaded normal)", () => {
  test.each(["subcommand", "launcher"] as const)(
    "%s: --check reads only release metadata and preserves both siblings",
    async (entry) => {
      const before = await installedBytes();
      const result = await run([...updateCommand(entry), "--check"], { env: env() });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Bruv pair update/repair available (" + releaseVersion + ")");
      expect(result.stdout).not.toContain("Downloading");
      expect(await installedBytes()).toEqual(before);
      expect(await requests()).toEqual([RELEASES_URL]);
      await expectStageCleaned();
    },
  );

  test.each(["normal", "subcommand", "launcher"] as const)(
    "%s: verifies and publishes both siblings",
    async (entry) => {
      const before = await installedBytes();
      const result = await run(updateCommand(entry), { env: env() });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        "Updated bruv and bruv-claude-compat to " + releaseVersion + ". Restart Bruv/T3 sessions.",
      );
      const progress = result.stdout.split("\n").filter((line) => /^(Downloading|Downloaded) bruv-/.test(line));
      expect(progress).toHaveLength(4);
      expect(progress[0]).toBe("Downloading " + normalAsset + " 0 B");
      expect(progress[1]).toStartWith("Downloaded " + normalAsset + " ");
      expect(progress[2]).toBe("Downloading " + connectorAsset + " 0 B");
      expect(progress[3]).toStartWith("Downloaded " + connectorAsset + " ");
      expect(result.stdout).not.toContain("\x1b");
      expect(result.stdout).not.toContain("\r");
      const after = await installedBytes();
      expect(after.normal).not.toEqual(before.normal);
      expect(after.connector).toEqual(await readFile(join(compiledFixtureDir, "bruv-claude-compat")));
      await expectPairVersion(releaseVersion);
      expect(await requests()).toEqual(pairDownloads(releaseVersion));
      await expectStageCleaned();
    },
  );

  test("subcommand repairs a missing same-version connector", async () => {
    await rm(installation.connector);
    const result = await run(updateCommand("subcommand"), { env: env({ BRUV_TEST_RELEASE_VERSION: product.version }) });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Updated bruv and bruv-claude-compat to " + product.version);
    expect(await readFile(installation.connector)).toEqual(
      await readFile(join(compiledFixtureDir, "bruv-claude-compat")),
    );
    await expectPairVersion(product.version);
    expect(await requests()).toEqual(pairDownloads(product.version));
    await expectStageCleaned();
  });

  test.each(["normal", "connector"] as const)("bad %s checksum leaves the pair unchanged", async (member) => {
    const before = await installedBytes();
    const asset = member === "normal" ? normalAsset : connectorAsset;
    const result = await run(updateCommand("launcher"), { env: env({ BRUV_TEST_BAD_CHECKSUM: asset }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Checksum verification failed for " + asset);
    expect(result.stderr).toContain("Installed files unchanged.");
    expect(result.stdout).not.toContain("Updated bruv");
    expect(await installedBytes()).toEqual(before);
    expect(await requests()).toEqual(pairDownloads(releaseVersion).slice(0, member === "normal" ? 3 : 5));
    await expectStageCleaned();
  });

  test("valid checksums do not bypass the staged connector product probe", async () => {
    const before = await installedBytes();
    const wrongProduct = join(installation.dir, "wrong-product-launcher");
    // The fixture advertises this body's real checksum; only its product version is wrong.
    await writeFile(wrongProduct, '#!/bin/sh\nprintf "%s\\n" "bruv-claude-compat 98.0.0"\n');
    const result = await run(updateCommand("launcher"), { env: env({ BRUV_TEST_LAUNCHER: wrongProduct }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Staged Bruv pair version mismatch (expected " + releaseVersion + ")");
    expect(result.stderr).toContain("Installed files unchanged.");
    expect(result.stdout).not.toContain("Updated bruv");
    expect(await installedBytes()).toEqual(before);
    expect(await requests()).toEqual(pairDownloads(releaseVersion));
    await expectStageCleaned();
  });

  test("subcommand refuses a symlink connector instead of updating its target", async () => {
    const normalBefore = await readFile(installation.normal);
    const target = join(installation.dir, "unrelated-file");
    await writeFile(target, "not part of the installation\n");
    await rm(installation.connector);
    await symlink(target, installation.connector);
    const result = await run(updateCommand("subcommand"), { env: env() });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Installation layout needs manual action");
    expect(result.stdout).not.toContain("Updated bruv");
    expect(await readFile(installation.normal)).toEqual(normalBefore);
    expect(await readFile(target, "utf8")).toBe("not part of the installation\n");
    expect(await readlink(installation.connector)).toBe(target);
    expect(await requests()).toEqual([RELEASES_URL]);
    await expectStageCleaned();
  });
});
