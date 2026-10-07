import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import product from "../package.json";
import { RELEASES_URL, UPDATE_ASSETS } from "../src/update";
import { run } from "./helpers";

test("bruv package and update assets use the canonical repository", () => {
  expect(product.name).toBe("bruv");
  expect(product.bin).toEqual({ bruv: "dist/bruv", "bruv-claude-compat": "dist/bruv-claude-compat" });
  expect(RELEASES_URL).toBe("https://api.github.com/repos/tnfssc/bruv/releases/latest");
  for (const [target, asset] of Object.entries(UPDATE_ASSETS)) {
    expect(String(asset)).toBe(`bruv-${target}`);
  }
});

test("compiled bruv starts a fresh namespace without touching old die data", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-identity-"));
  try {
    const legacyState = join(home, ".die", "runtime", product.version);
    await mkdir(legacyState, { recursive: true });
    const sentinel = join(legacyState, "package.json");
    const oldBytes = "old product data: deliberately not valid package JSON\n";
    await writeFile(sentinel, oldBytes);
    const result = await run([resolve(import.meta.dir, "../dist/bruv"), "--help"], {
      env: { HOME: home, PATH: "/nonexistent" },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith("bruv - AI coding assistant");
    expect(await readFile(sentinel, "utf8")).toBe(oldBytes);
    const metadata = await Bun.file(join(home, ".bruv", "runtime", product.version, "package.json")).json();
    expect(metadata.name).toBe("bruv");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// Probe both shipped entry paths with no access to the user's home or PATH bruv.
test("compiled product and connector keep separate display and product identities", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-version-identity-"));
  const normal = resolve(import.meta.dir, "../dist/bruv");
  const wrapper = resolve(import.meta.dir, "../dist/bruv-claude-compat");
  const env = { HOME: home, PATH: "/nonexistent", BRUV_CLAUDE_COMPAT_BRUV_PATH: undefined };
  try {
    expect(await run([normal, "--version"], { env })).toEqual({
      code: 0,
      stdout: product.version + "\n",
      stderr: "",
    });
    for (const entry of [[normal, "claude-compat"], [wrapper]]) {
      for (const flag of ["--version", "-v"]) {
        const result = await run([...entry, flag], { env });
        expect(result).toEqual({ code: 0, stdout: "Bruv connector\n", stderr: "" });
        // T3 scans for any dotted semver, not just one at the start of output.
        expect(result.stdout + result.stderr).not.toMatch(/\d+\.\d+\.\d+/);
      }
      expect(await run([...entry, "--bruv-version"], { env })).toEqual({
        code: 0,
        stdout: "bruv-claude-compat " + product.version + "\n",
        stderr: "",
      });
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
