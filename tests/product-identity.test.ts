import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import product from "../package.json";
import { RELEASES_URL, UPDATE_ASSETS } from "../src/update";
import { run } from "./helpers";

test("package exposes the Bruv executable pair", () => {
  expect(product.name).toBe("bruv");
  expect(product.bin).toEqual({ bruv: "dist/bruv", "bruv-claude-compat": "dist/bruv-claude-compat" });
});

test("updater uses the canonical Bruv repository and supported release assets", () => {
  expect(RELEASES_URL).toBe("https://api.github.com/repos/tnfssc/bruv/releases/latest");
  expect(UPDATE_ASSETS).toEqual({
    "linux-x64": "bruv-linux-x64",
    "linux-arm64": "bruv-linux-arm64",
    "darwin-arm64": "bruv-darwin-arm64",
    "android-arm64": "bruv-android-arm64",
  });
});

describe("compiled product identity", () => {
  const normal = resolve(import.meta.dir, "../dist/bruv");
  const wrapper = resolve(import.meta.dir, "../dist/bruv-claude-compat");
  let home: string;
  let env: Record<string, string | undefined>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bruv-identity-"));
    // No user's home, PATH Bruv, or connector override; the wrapper must use its sibling.
    env = { HOME: home, PATH: "/nonexistent", BRUV_CLAUDE_COMPAT_BRUV_PATH: undefined };
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("help bootstraps Bruv runtime without touching old die data", async () => {
    const legacyState = join(home, ".die", "runtime", product.version);
    await mkdir(legacyState, { recursive: true });
    const sentinel = join(legacyState, "package.json");
    const oldBytes = "old product data: deliberately not valid package JSON\n";
    await writeFile(sentinel, oldBytes);

    const result = await run([normal, "--help"], { env });
    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith("bruv - AI coding assistant");
    expect(await readFile(sentinel, "utf8")).toBe(oldBytes);
    const metadata = await Bun.file(join(home, ".bruv", "runtime", product.version, "package.json")).json();
    expect(metadata.name).toBe("bruv");
  });

  test("bruv --version reports the package version", async () => {
    expect(await run([normal, "--version"], { env })).toEqual({
      code: 0,
      stdout: product.version + "\n",
      stderr: "",
    });
  });

  describe.each([
    ["bruv claude-compat", [normal, "claude-compat"]],
    ["bruv-claude-compat", [wrapper]],
  ] as const)("%s", (_name, entry) => {
    test.each(["--version", "-v"])("%s reports display identity, not a Claude update version", async (flag) => {
      const result = await run([...entry, flag], { env });
      expect(result).toEqual({ code: 0, stdout: "Bruv connector\n", stderr: "" });
      // T3 scans for any dotted semver, not just one at the start of output.
      expect(result.stdout + result.stderr).not.toMatch(/\d+\.\d+\.\d+/);
    });

    test("--bruv-version reports the connector's Bruv package version", async () => {
      expect(await run([...entry, "--bruv-version"], { env })).toEqual({
        code: 0,
        stdout: "bruv-claude-compat " + product.version + "\n",
        stderr: "",
      });
    });
  });
});
