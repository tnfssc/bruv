import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ownedFixtureEnv } from "../helpers/helpers";

// Run the real builder in an owned Git repo. Only asset preparation and compilation
// are stubs: this checks CLI/provenance mechanics, not a compiled native UI.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tasks-ui-proof-build-"));
  // Git, the builder, and its nested Git children share only fixture-owned authority.
  // Retain source, SDK/config directories, and proof evidence even on failure.
  const env = ownedFixtureEnv(root);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    if (result.status !== 0) throw Error(result.stderr);
    return result.stdout.trim();
  };
  await mkdir(join(root, "scripts/tui"), { recursive: true });
  await mkdir(join(root, "scripts/build"), { recursive: true });
  await mkdir(join(root, "src"));
  const pi = join(root, "node_modules/@earendil-works/pi-coding-agent");
  await mkdir(pi, { recursive: true });
  await writeFile(join(pi, "host.js"), "adapted");
  await writeFile(join(root, ".gitignore"), "node_modules/\nout/\nruntime-assets/\n");
  await writeFile(join(root, "src/cli.ts"), "// owned source fixture\n");
  await writeFile(
    join(root, "scripts/tui/tasks-ui-proof-build.ts"),
    await readFile(resolve(import.meta.dir, "../../scripts/tui/tasks-ui-proof-build.ts")),
  );
  await writeFile(
    join(root, "scripts/build/pi-host-adaptation.ts"),
    'export const piHostPatches = [{ path: "host.js" }]; export const adaptPiHostFile = () => "adapted";',
  );
  await writeFile(
    join(root, "scripts/build/prepare-assets.ts"),
    'await Bun.write(new URL("../../runtime-assets/prepared", import.meta.url), "prepared");',
  );
  await writeFile(
    join(root, "scripts/stub-build.ts"),
    [
      "Bun.build = async (options) => {",
      'await Bun.write(new URL("../out/build-options.json", import.meta.url), JSON.stringify(options));',
      'if (process.env.PROOF_STUB === "fail") return { success: false, logs: [Error("stub compile failure")] };',
      'await Bun.write(options.compile.outfile, "stub binary, not native UI proof");',
      'if (process.env.PROOF_STUB === "change") await Bun.write(new URL("../src/cli.ts", import.meta.url), "changed");',
      "return { success: true, logs: [] };",
      "};",
    ].join("\n"),
  );
  git("init", "--quiet");
  git("add", ".");
  git("-c", "user.name=Proof fixture", "-c", "user.email=proof@example.invalid", "commit", "--quiet", "-m", "fixture");
  const sourceCommit = git("rev-parse", "HEAD");
  const binary = join(root, "out/native");
  const run = (args = [binary], mode = "") =>
    spawnSync(
      process.execPath,
      ["--preload", "./scripts/stub-build.ts", "scripts/tui/tasks-ui-proof-build.ts", ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...env, PROOF_STUB: mode },
      },
    );
  return { root, pi, sourceCommit, binary, run };
}

test("one output argument builds source/binary provenance without a web archive", async () => {
  const f = await fixture();
  const result = f.run();
  expect(result.status).toBe(0);
  const record = JSON.parse(await readFile(f.binary + ".build.json", "utf8"));
  expect(record).toEqual({
    purpose: "local native UI proof, not packaging or release",
    sourceCommit: f.sourceCommit,
    sourceRoot: f.root,
    trackedSourceClean: true,
    binary: f.binary,
    binarySha256: createHash("sha256")
      .update(await readFile(f.binary))
      .digest("hex"),
    bunVersion: Bun.version,
    builtAt: expect.any(String),
  });
  expect(JSON.parse(result.stdout)).toEqual(record);
  expect(JSON.parse(await readFile(join(f.root, "out/build-options.json"), "utf8"))).toEqual({
    entrypoints: [join(f.root, "src/cli.ts")],
    compile: { outfile: f.binary },
    minify: true,
  });
  expect(await Bun.file(join(f.root, "runtime-assets/prepared")).text()).toBe("prepared");
  expect(await Bun.file(join(f.pi, "host.js")).text()).toBe("adapted");
  expect(await Bun.file(join(f.root, "dist/bruv-web.archive.gz")).exists()).toBe(false);
});

test("old archive/output invocation is explicitly rejected before preparation", async () => {
  const f = await fixture();
  const result = f.run([join(f.root, "unused.archive.gz"), f.binary]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Usage: bun scripts/tui/tasks-ui-proof-build.ts OUTPUT_BINARY");
  expect(await Bun.file(join(f.root, "runtime-assets/prepared")).exists()).toBe(false);
});

test("dirty tracked source and unadapted dependencies still stop before preparation", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "src/cli.ts"), "dirty");
  expect(f.run().stderr).toContain("Commit tracked source before building proof");
  await writeFile(join(f.root, "src/cli.ts"), "// owned source fixture\n");
  await writeFile(join(f.pi, "host.js"), "unadapted");
  expect(f.run().stderr).toContain("Cached Pi host needs adaptation; refuse dependency writes");
  expect(await Bun.file(join(f.pi, "host.js")).text()).toBe("unadapted");
  expect(await Bun.file(join(f.root, "runtime-assets/prepared")).exists()).toBe(false);
});

test("failed compile and source mutation during compile publish no proof record", async () => {
  const f = await fixture();
  const failed = f.run([f.binary], "fail");
  expect(failed.status).not.toBe(0);
  expect(failed.stderr).toContain("stub compile failure");
  expect(await Bun.file(f.binary + ".build.json").exists()).toBe(false);
  const changed = f.run([f.binary], "change");
  expect(changed.status).not.toBe(0);
  expect(changed.stderr).toContain("Source changed during compilation; discard binary");
  expect(await Bun.file(f.binary + ".build.json").exists()).toBe(false);
});
