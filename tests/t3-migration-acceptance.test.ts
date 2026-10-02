import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertMigrationDependencies } from "../integrations/t3/gates/migration-dependencies";

const root = resolve(import.meta.dir, "..");
const gate = join(root, "integrations/t3/gates/migration-acceptance.ts");
const shippedPatch = () =>
  execFileSync("git", ["show", "92f1f2bc543ef148a5d254c20c95e6ba8b9aa4be:integrations/t3/upstream/bruv.patch"], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });

async function rejectBeforeFixtureCopy(patch: Uint8Array, expectedError: string) {
  const temporary = await mkdtemp(join(tmpdir(), "bruv-migration-preflight-test-"));
  const production = join(temporary, "production");
  const preview = join(temporary, "preview");
  try {
    await Promise.all([mkdir(production), mkdir(preview)]);
    // An unrelated HEAD exercises revision enforcement without touching any T3 checkout.
    execFileSync("git", ["init", "--quiet", production]);
    execFileSync("git", [
      "-C",
      production,
      "-c",
      "user.name=Migration test",
      "-c",
      "user.email=migration@example.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "Unrelated source",
    ]);
    const patchPath = join(temporary, "production.patch");
    await writeFile(patchPath, patch);
    const child = Bun.spawn([process.execPath, gate], {
      cwd: root,
      env: {
        ...process.env,
        TMPDIR: temporary,
        T3_V2_MIGRATION_PRODUCTION: production,
        T3_V2_MIGRATION_PREVIEW: preview,
        T3_V2_MIGRATION_PRODUCTION_PATCH: patchPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).not.toBe(0);
    expect(stdout + stderr).toContain(expectedError);
    expect(await readdir(preview)).toEqual([]);
    expect(await readdir(production)).toEqual([".git"]);
    expect((await readdir(temporary)).sort()).toEqual(["preview", "production", "production.patch"]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test("migration gate rejects an override differing from the shipped patch before copying fixtures", async () => {
  await rejectBeforeFixtureCopy(
    Buffer.concat([shippedPatch(), Buffer.from("\n# not the shipped patch\n")]),
    "current-production canonical patch hash mismatch",
  );
});

test("migration gate accepts the historical patch checksum but rejects an unrelated production HEAD before copying fixtures", async () => {
  await rejectBeforeFixtureCopy(shippedPatch(), "current-production checkout HEAD mismatch");
});

function pinnedLocks() {
  const source = {
    lockfileVersion: "9.0",
    importers: {
      "apps/server": {
        dependencies: { contracts: { version: "link:../../packages/contracts" }, alias: { version: "runtime@1.0.0" } },
      },
      "packages/contracts": { dependencies: { effect: { version: "1.0.0" } } },
    },
    packages: {
      "runtime@1.0.0": { resolution: { integrity: "runtime" } },
      "effect@1.0.0": { resolution: { integrity: "effect" } },
      "unused@1.0.0": {},
    },
    snapshots: { "runtime@1.0.0": { dependencies: { effect: "1.0.0" } }, "effect@1.0.0": {}, "unused@1.0.0": {} },
  };
  const installed = structuredClone(source);
  delete (installed.packages as Record<string, unknown>)["unused@1.0.0"];
  delete (installed.snapshots as Record<string, unknown>)["unused@1.0.0"];
  return { source, installed };
}

test("migration dependency provenance allows only pinned pruning outside the server runtime closure", () => {
  const { source, installed } = pinnedLocks();
  expect(() => assertMigrationDependencies(JSON.stringify(source), JSON.stringify(installed))).not.toThrow();
  installed.packages["effect@1.0.0"].resolution.integrity = "different bytes";
  expect(() => assertMigrationDependencies(JSON.stringify(source), JSON.stringify(installed))).toThrow("entry differs");
});

test("migration dependency provenance rejects missing required dependencies and changed importer pins", () => {
  for (const section of ["packages", "snapshots"] as const) {
    const { source, installed } = pinnedLocks();
    delete (installed[section] as Record<string, unknown>)["effect@1.0.0"];
    expect(() => assertMigrationDependencies(JSON.stringify(source), JSON.stringify(installed))).toThrow(
      "missing installed dependency",
    );
  }
  const { source, installed } = pinnedLocks();
  installed.importers["apps/server"].dependencies.alias.version = "runtime@2.0.0";
  expect(() => assertMigrationDependencies(JSON.stringify(source), JSON.stringify(installed))).toThrow(
    "metadata/importers differ",
  );
});
