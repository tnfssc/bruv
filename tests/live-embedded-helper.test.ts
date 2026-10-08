import { nativeHelperPlugin } from "../scripts/live-helper-bundle";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, lstat, mkdir, symlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { extractNativeHelper, resolveEmbeddedNativeHelper } from "../src/live/helper";

const bytes = Buffer.from("inert fake helper fixture"); // Never executed; no device or credentials.
const hash = createHash("sha256").update(bytes).digest("hex");
test("private per-launch extraction is verified and independently cleaned up", async () => {
  const root = await mkdtemp(join(tmpdir(), "live-helper-test-"));
  try {
    const [first, second] = await Promise.all([
      extractNativeHelper(bytes, hash, root),
      extractNativeHelper(bytes, hash, root),
    ]);
    expect(first.path).not.toBe(second.path);
    expect(await readFile(first.path)).toEqual(bytes);
    expect((await lstat(join(first.path, ".."))).mode & 0o777).toBe(0o700);
    expect((await lstat(first.path)).mode & 0o777).toBe(0o700);
    await writeFile(first.path, "tampered");
    expect(await readFile(second.path)).toEqual(bytes);
    await Promise.all([first.cleanup(), second.cleanup()]);
    expect(await Bun.file(first.path).exists()).toBe(false);
    expect(await Bun.file(second.path).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("reject corrupt content before writing and never follow a hostile shared cache symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "live-helper-test-"));
  const victim = join(root, "victim");
  try {
    await mkdir(victim);
    await writeFile(join(victim, "live-audio"), "preserve");
    await symlink(victim, join(root, "bruv-live-cache"));
    await expect(extractNativeHelper(Buffer.from("corrupt"), hash, root)).rejects.toThrow("integrity");
    const fresh = await extractNativeHelper(bytes, hash, root);
    expect(fresh.path).not.toContain(join(root, "bruv-live-cache"));
    expect(await readFile(join(victim, "live-audio"), "utf8")).toBe("preserve");
    await fresh.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("platform gating leaves stable targets untouched and missing or tampered assets fail closed", async () => {
  const missing = { path: join(tmpdir(), "nonexistent-bruv-live"), sha256: hash };
  expect(await resolveEmbeddedNativeHelper("linux", "arm64", missing)).toBeUndefined();
  expect(await resolveEmbeddedNativeHelper("darwin", "x64", missing)).toBeUndefined();
  await expect(resolveEmbeddedNativeHelper("darwin", "arm64", missing)).rejects.toThrow();
  const root = await mkdtemp(join(tmpdir(), "live-helper-test-"));
  try {
    const source = join(root, "payload");
    await writeFile(source, "corrupt");
    await expect(resolveEmbeddedNativeHelper("darwin", "arm64", { path: source, sha256: hash })).rejects.toThrow(
      "integrity",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real compiled bundle extracts embedded bytes after original payload disappears", async () => {
  // Retain this owned fixture, including the probe's HOME/config/SDK, for inspection.
  const root = await mkdtemp(join(tmpdir(), "live-helper-compiled-"));
  const home = join(root, "home");
  const config = join(root, "config");
  const sdk = join(root, "sdk");
  await Promise.all([home, config, sdk].map((path) => mkdir(path)));

  // Only header-shaped inert bytes: never execute this synthetic Mach-O fixture.
  const payload = Buffer.alloc(64);
  payload.writeUInt32LE(0xfeedfacf, 0);
  payload.writeUInt32LE(0x0100000c, 4);
  payload.writeUInt32LE(2, 12);
  const source = join(root, "native");
  await writeFile(source, payload);
  await expect(nativeHelperPlugin(source, "bun-linux-arm64")).rejects.toThrow("bun-darwin-arm64");
  const bad = join(root, "bad");
  await writeFile(bad, "not a native executable");
  await expect(nativeHelperPlugin(bad, "bun-darwin-arm64")).rejects.toThrow("Mach-O");
  const linked = join(root, "linked");
  await symlink(source, linked);
  await expect(nativeHelperPlugin(linked, "bun-darwin-arm64")).rejects.toThrow("symlink");

  const entry = join(root, "entry.ts");
  await writeFile(
    entry,
    `import { resolveEmbeddedNativeHelper } from ${JSON.stringify(join(import.meta.dir, "../src/live/helper.ts"))};

const helper = await resolveEmbeddedNativeHelper("darwin", "arm64");
if (!helper) throw new Error("missing");
try {
  const bytes = Buffer.from(await Bun.file(helper.path).bytes()).toString("hex");
  console.log(JSON.stringify({ path: helper.path, bytes }));
} finally {
  await helper.cleanup();
}
`,
  );
  const executable = join(root, "probe");
  const result = await Bun.build({
    entrypoints: [entry],
    compile: { outfile: executable },
    minify: true,
    plugins: [await nativeHelperPlugin(source, "bun-darwin-arm64")],
  });
  expect(result.success).toBe(true);
  await rm(source);
  const run = spawnSync(executable, [], {
    encoding: "utf8",
    cwd: root,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: config,
      BRUV_CODING_AGENT_DIR: sdk,
      PI_CODING_AGENT_DIR: sdk,
      TMPDIR: root,
      PATH: "/usr/bin:/bin",
    },
  });
  expect(run.status, run.stderr).toBe(0);
  const extracted = JSON.parse(run.stdout);
  expect(dirname(dirname(extracted.path))).toBe(root);
  expect(extracted.bytes).toBe(payload.toString("hex"));
  expect(await Bun.file(extracted.path).exists()).toBe(false);
});
