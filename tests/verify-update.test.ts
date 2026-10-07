import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { updateAssetFor } from "../src/update";

const asset = updateAssetFor(process.platform, process.arch);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(connectorVersion = "0.17.0") {
  const root = await mkdtemp(join(tmpdir(), "bruv-paired-update-gate-test-"));
  roots.push(root);
  const names = {
    normal: asset!,
    connector: asset!.replace(/^bruv-/, "bruv-claude-compat-"),
  };
  const normalSource = join(root, "normal.ts");
  await writeFile(
    normalSource,
    `const connector = process.argv[2] === "claude-compat";
const flag = process.argv[connector ? 3 : 2];
if (connector) {
  if (flag === "--version") console.log("Bruv connector");
  else if (flag === "--bruv-version") console.log("bruv-claude-compat ${connectorVersion}");
  else process.exit(2);
} else {
  if (flag !== "--version") process.exit(2);
  console.log("0.17.0");
}
`,
  );
  const build = await Bun.build({ entrypoints: [normalSource], compile: { outfile: join(root, names.normal) } });
  expect(build.success, build.logs.join("\n")).toBe(true);
  const launcher = await readFile(
    process.env.BRUV_TEST_LAUNCHER_TEMPLATE ?? resolve(import.meta.dir, "../scripts/bruv-claude-compat.sh"),
    "utf8",
  );
  await writeFile(join(root, names.connector), launcher);
  for (const name of Object.values(names)) {
    const digest = createHash("sha256")
      .update(await readFile(join(root, name)))
      .digest("hex");
    await writeFile(join(root, name + ".sha256"), digest + "  " + name + "\n");
  }
  const run = async ({
    updater = "current",
    temporaryDirectory,
  }: {
    updater?: "current" | "frozen 0.16.3";
    temporaryDirectory?: string;
  } = {}) => {
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../scripts/verify-update.ts"),
        join(root, names.normal),
        "0.17.0",
        ...(updater === "frozen 0.16.3" ? ["--legacy-updater"] : []),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: temporaryDirectory ? { ...process.env, TMPDIR: temporaryDirectory } : process.env,
      },
    );
    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { output, errors, code };
  };
  return { root, names, run };
}

test.skipIf(!asset)(
  "release updater gate requires both host candidates and checksums before exercising replacement",
  async () => {
    const { root, names, run } = await fixture();
    const passed = await run();
    expect(passed.code, passed.errors).toBe(0);
    expect(passed.output).toContain("checksum failures preserved BOTH installed files");
    expect(passed.output).toContain("matched versions 0.17.0 passed");
    for (const name of Object.values(names)) {
      const checksum = join(root, name + ".sha256");
      const original = await readFile(checksum);
      await writeFile(checksum, "0".repeat(64) + "  " + name);
      const failed = await run();
      expect(failed.code).not.toBe(0);
      expect(failed.errors).toContain("Staged release checksum mismatch: " + name);
      await writeFile(checksum, original);
    }
    await rm(join(root, names.connector));
    expect((await run()).code).not.toBe(0);
  },
  30_000,
);

test.skipIf(!asset)(
  "release updater gate rejects an otherwise checksummed mismatched connector",
  async () => {
    const { root, run } = await fixture("0.2.0");
    const temporary = join(root, "gate-tmp");
    await mkdir(temporary);
    const result = await run({ temporaryDirectory: temporary });
    expect(result.code).not.toBe(0);
    expect(result.errors).toContain("Staged Bruv pair version mismatch");
    const diagnostic = JSON.parse(result.errors.match(/error: Compiled updater failed rollback gate: (.+)/)![1]!);
    expect(diagnostic.status).toBe(1);
    expect(diagnostic.signal).toBeNull();
    expect(diagnostic.error).toBeNull();
    expect(diagnostic.stdout).toBe("");
    expect(diagnostic.args).toEqual(["--fail-normal-rename"]);
    expect(diagnostic.stderr).toContain("Staged Bruv pair version mismatch");
    expect(diagnostic.stderr).not.toContain("Previous installation restored");
    expect(await readdir(temporary)).toEqual([]);
  },
  30_000,
);

test.skipIf(!asset)(
  "frozen 0.16.3 compiled updater migrates to a thin wrapper",
  async () => {
    const frozen = await readFile(resolve(import.meta.dir, "update-v0.16.3-fixture.ts"));
    expect(createHash("sha256").update(frozen).digest("hex")).toBe(
      "cab60e412c13277cf8a415d0c09fb0dbdfd69c9d000c42d21b2695f5b03230aa",
    );
    const { run } = await fixture();
    const result = await run({ updater: "frozen 0.16.3" });
    expect(result.code, result.errors).toBe(0);
    expect(result.output).toContain("Frozen v0.16.3 updater");
  },
  30_000,
);

for (const updater of ["current", "frozen 0.16.3"] as const) {
  test.skipIf(!asset)(
    `compiled ${updater} updater gate injects rollback through an aliased TMPDIR`,
    async () => {
      const { root, run } = await fixture();
      const temporary = join(root, "real-tmp");
      const alias = join(root, "alias-tmp");
      await mkdir(temporary);
      await symlink(temporary, alias, "dir");
      expect(await realpath(alias)).not.toBe(alias);
      const result = await run({ updater, temporaryDirectory: alias });
      expect(result.code, result.errors).toBe(0);
      expect(result.output).toContain("checksum failures preserved BOTH installed files");
      expect(result.output).toContain("second-rename rollback restored pair");
      expect(result.output).toContain("matched versions 0.17.0 passed");
      expect(await readdir(temporary)).toEqual([]);
    },
    30_000,
  );
}
