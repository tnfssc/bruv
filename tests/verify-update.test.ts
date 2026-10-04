import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { updateAssetFor } from "../src/update";

const asset = updateAssetFor(process.platform, process.arch);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(connectorVersion = "0.3.0") {
  const root = await mkdtemp(join(tmpdir(), "bruv-paired-update-gate-test-"));
  roots.push(root);
  const names = [asset!, asset!.replace(/^bruv-/, "bruv-claude-compat-")];
  for (const [i, name] of names.entries()) {
    const source = join(root, name + ".ts");
    const version = i === 0 ? "0.3.0" : "bruv-claude-compat " + connectorVersion;
    await writeFile(source, "console.log(" + JSON.stringify(version) + ");\n");
    const build = await Bun.build({ entrypoints: [source], compile: { outfile: join(root, name) } });
    expect(build.success, build.logs.join("\n")).toBe(true);
    const digest = createHash("sha256")
      .update(await readFile(join(root, name)))
      .digest("hex");
    await writeFile(join(root, name + ".sha256"), digest + "  " + name + "\n");
  }
  const run = async () => {
    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, "../scripts/verify-update.ts"), join(root, names[0]!), "0.3.0"],
      {
        stdout: "pipe",
        stderr: "pipe",
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
    expect(passed.output).toContain("matched versions 0.3.0 passed");
    for (const name of names) {
      const checksum = join(root, name + ".sha256");
      const original = await readFile(checksum);
      await writeFile(checksum, "0".repeat(64) + "  " + name);
      const failed = await run();
      expect(failed.code).not.toBe(0);
      expect(failed.errors).toContain("Staged release checksum mismatch: " + name);
      await writeFile(checksum, original);
    }
    await rm(join(root, names[1]!));
    expect((await run()).code).not.toBe(0);
  },
  30_000,
);

test.skipIf(!asset)(
  "release updater gate rejects an otherwise checksummed mismatched connector",
  async () => {
    const { run } = await fixture("0.2.0");
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.errors).toContain("Staged Bruv pair version mismatch");
  },
  30_000,
);
