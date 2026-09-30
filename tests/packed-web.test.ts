import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  invalidatePackedWeb,
  packedWebInputKey,
  prepareWebPayload,
  recordVerifiedPackedWeb,
  verifyPackedWeb,
} from "../scripts/packed-web";
import { packWebArchive } from "../src/t3/web/archive";

const temporary: string[] = [];
const originalSource = process.env.DIE_T3_SOURCE;
afterEach(async () => {
  if (originalSource === undefined) delete process.env.DIE_T3_SOURCE;
  else process.env.DIE_T3_SOURCE = originalSource;
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "die-packed-test-"));
  temporary.push(root);
  const source = resolve(root, "source");
  await mkdir(source);
  const git = (...args: string[]) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  await Bun.write(source + "/input", "original\n");
  await Bun.write(source + "/.gitignore", ".env*\nnode_modules/\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.org", "commit", "-qm", "fixture");
  await Bun.write(source + "/input", "patched\n");
  const patch = git("diff") + "\n";
  for (const file of [
    "package.json",
    "bun.lock",
    "mise.toml",
    "src/t3/web/archive.ts",
    "scripts/packed-web.ts",
    "scripts/build.ts",
    "integrations/t3/build/build.ts",
    "integrations/t3/upstream/bootstrap.mjs",
  ])
    await Bun.write(resolve(root, file), file === "package.json" ? '{"type":"module"}' : file);
  await Bun.write(root + "/integrations/t3/upstream/die.patch", patch);
  await Bun.write(
    root + "/integrations/t3/upstream/source.json",
    JSON.stringify({ revision: git("rev-parse", "HEAD") }),
  );
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "add", "bun.lock"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.org",
    "commit",
    "-qm",
    "producer",
  ]);
  const payload = root + "/dist/die-web";
  await Bun.write(payload + "/bootstrap.mjs", "console.log('fixture');");
  const archive = root + "/dist/die-web.archive.gz";
  let packs = 0;
  const pack = async () => {
    packs++;
    return packWebArchive(payload, archive);
  };
  process.env.DIE_T3_SOURCE = source;
  await prepareWebPayload(root, "fresh", {
    fresh: async () => {
      await pack();
      await recordVerifiedPackedWeb(root, source);
    },
    repack: async () => {
      throw new Error("unexpected repack");
    },
  });
  return { root, source, payload, archive, packs: () => packs };
}

test("one verified packing supports four compile targets without touching archive or mutable dist", async () => {
  const f = await fixture();
  const bytes = await Bun.file(f.archive).bytes();
  const before = await stat(f.archive);
  await rm(f.payload, { recursive: true }); // mutable staging tree is not authority
  for (const target of ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-x64", "bun-darwin-arm64"]) {
    await prepareWebPayload(f.root, "packed", {
      fresh: async () => {
        throw new Error("unexpected fresh for " + target);
      },
      repack: async () => {
        throw new Error("unexpected repack for " + target);
      },
    });
    expect(await verifyPackedWeb(f.root)).toBe(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    expect(await Bun.file(f.archive).bytes()).toEqual(bytes);
  }
  expect(f.packs()).toBe(1);
  expect((await stat(f.archive)).mtimeMs).toBe(before.mtimeMs);
});

for (const file of [
  "integrations/t3/upstream/bootstrap.mjs",
  "integrations/t3/upstream/source.json",
  "integrations/t3/upstream/die.patch",
  "integrations/t3/build/build.ts",
  "src/t3/web/archive.ts",
  "scripts/packed-web.ts",
  "bun.lock",
  "mise.toml",
  "source/input",
  "source/.env.local",
  "source/node_modules/.modules.yaml",
  "dist/die-web.archive.gz",
]) {
  test("reject changed input: " + file, async () => {
    const f = await fixture();
    await Bun.write(resolve(f.root, file), "changed");
    await expect(verifyPackedWeb(f.root)).rejects.toThrow("Cannot reuse packed web");
  });
}
test("reject missing, malformed, expired, foreign workspace and invalidated receipts", async () => {
  const f = await fixture();
  const receipt = f.root + "/dist/die-web.archive.manifest.json";
  const original = await Bun.file(receipt).json();
  for (const change of [
    { created: 0 },
    { version: 2 },
    { producer: "reuse-web" },
    { identity: { ...original.identity, workspace: "/elsewhere" } },
  ]) {
    await Bun.write(receipt, JSON.stringify({ ...original, ...change }));
    await expect(verifyPackedWeb(f.root)).rejects.toThrow();
  }
  await Bun.write(receipt, "not json");
  await expect(verifyPackedWeb(f.root)).rejects.toThrow();
  await invalidatePackedWeb(f.root);
  await expect(verifyPackedWeb(f.root)).rejects.toThrow();
});
test("reject build environment changes", async () => {
  const f = await fixture();
  const old = process.env.VITE_HTTP_URL;
  process.env.VITE_HTTP_URL = "https://changed.invalid";
  try {
    await expect(verifyPackedWeb(f.root)).rejects.toThrow("build inputs changed");
  } finally {
    if (old === undefined) delete process.env.VITE_HTTP_URL;
    else process.env.VITE_HTTP_URL = old;
  }
});
test("verified archive embeds into a real native compiled executable unchanged", async () => {
  const f = await fixture();
  const digest = await verifyPackedWeb(f.root);
  const entry = f.root + "/smoke.ts";
  await Bun.write(
    entry,
    'import archive from "./dist/die-web.archive.gz" with { type: "file" }; console.log(new Bun.CryptoHasher("sha256").update(await Bun.file(archive).bytes()).digest("hex"));',
  );
  const outfile = f.root + "/compiled-smoke";
  const result = await Bun.build({ entrypoints: [entry], compile: { outfile } });
  expect(result.success).toBe(true);
  expect(execFileSync(outfile, [], { encoding: "utf8" }).trim()).toBe(digest);
  expect(await verifyPackedWeb(f.root)).toBe(digest);
}, 30_000);

test("missing archive fails closed", async () => {
  const f = await fixture();
  await rm(f.archive);
  await expect(verifyPackedWeb(f.root)).rejects.toThrow();
});

test("bootstrap executable mode is a packed input", async () => {
  const f = await fixture();
  await chmod(f.root + "/integrations/t3/upstream/bootstrap.mjs", 0o755);
  await expect(verifyPackedWeb(f.root)).rejects.toThrow("build inputs changed");
});
test("legacy repack invalidates receipt before it can fail", async () => {
  const f = await fixture();
  await expect(
    prepareWebPayload(f.root, "repack", {
      fresh: async () => {},
      repack: async () => {
        throw new Error("repack failed");
      },
    }),
  ).rejects.toThrow("repack failed");
  await expect(verifyPackedWeb(f.root)).rejects.toThrow();
});

test("CLI-only edits do not change web content key or invalidate reuse", async () => {
  const f = await fixture();
  const key = await packedWebInputKey(f.root);
  await Bun.write(f.root + "/src/cli.ts", "changed CLI only");
  expect(await packedWebInputKey(f.root)).toBe(key);
  expect(await verifyPackedWeb(f.root)).toBeTruthy();
});

test("npm install configuration is a guarded input", async () => {
  const f = await fixture();
  const old = process.env.npm_config_registry;
  process.env.npm_config_registry = "https://changed.invalid";
  try {
    await expect(verifyPackedWeb(f.root)).rejects.toThrow("build inputs changed");
  } finally {
    if (old === undefined) delete process.env.npm_config_registry;
    else process.env.npm_config_registry = old;
  }
});
