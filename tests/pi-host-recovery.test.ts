import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { adaptPiHostFile, piHostPatches } from "../scripts/pi-host-adaptation";
import { preparePiHostWithRecovery } from "../scripts/pi-host-recovery";

const originals = JSON.parse(
  gunzipSync(await readFile(join(import.meta.dir, "fixtures/pi-host/1.0.3-originals.json.gz"))).toString(),
) as Record<string, string>;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const agentPatch = piHostPatches.find((patch) => patch.path === "dist/core/agent-session.js")!;
const marker = agentPatch.replacements!.at(-1)!;
const adapted = Object.fromEntries(
  piHostPatches.map((patch) => [patch.path, adaptPiHostFile(patch, originals[patch.path]!)]),
);
const staleAgent = adapted[agentPatch.path]!.replace(marker[1], marker[0]);
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "bruv-pi-recovery-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture(root: string, files: Record<string, string> = originals, version = "1.0.3") {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ version }));
  for (const patch of piHostPatches) {
    const path = join(root, patch.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, files[patch.path]!);
    await chmod(path, patch.path === "dist/main.js" ? 0o755 : 0o640);
  }
  await writeFile(join(root, "unrelated.js"), "leave other dependency files alone");
}

async function snapshot(
  root: string,
  paths = [...piHostPatches.map((patch) => patch.path), "package.json", "unrelated.js"],
) {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      bytes: await readFile(join(root, path)),
      info: await stat(join(root, path)),
    })),
  );
}
async function unchanged(root: string, before: Awaited<ReturnType<typeof snapshot>>) {
  for (const { path, bytes, info } of before) {
    expect(await readFile(join(root, path))).toEqual(bytes);
    const after = await stat(join(root, path));
    expect(after.ino).toBe(info.ino);
    expect(after.mtimeMs).toBe(info.mtimeMs);
    expect(after.mode).toBe(info.mode);
    expect(after.nlink).toBe(info.nlink);
  }
}
function acquisition(stages: string[]) {
  return async (_projectRoot: string, stage: string) => {
    stages.push(stage);
    const piRoot = join(stage, "pi");
    await fixture(piRoot);
    return piRoot;
  };
}
async function cleaned(stages: string[]) {
  for (const stage of stages) await expect(stat(stage)).rejects.toMatchObject({ code: "ENOENT" });
}

// Exact hashes make the compressed fixture independent of inherited node_modules.
test("clean fixture is pinned; stale fixture reproduces the observed unsupported hash", () => {
  expect(Object.keys(originals).sort()).toEqual(piHostPatches.map((patch) => patch.path).sort());
  for (const patch of piHostPatches) expect(digest(originals[patch.path]!)).toBe(patch.originalSha256);
  expect(digest(staleAgent)).toBe("ef78c937779832d87a5a28bbd339e4c73e210d0b5da7ff570723f1d4313be876");
});

test("recovers private stale branch adaptation once; prepared runs stay offline with stable inode/mtime", async () => {
  const root = await temp();
  await fixture(root, { ...adapted, [agentPatch.path]: staleAgent });
  const before = await snapshot(root);
  const stages: string[] = [];
  const notices: string[] = [];
  const options = { acquireCleanSource: acquisition(stages), notice: (message: string) => notices.push(message) };
  await preparePiHostWithRecovery(root, root, options);
  expect(stages).toHaveLength(1);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("clean isolated install");
  expect(notices[0]).toContain("shared Bun cache was not changed");
  await cleaned(stages);
  for (const patch of piHostPatches)
    expect(digest(await readFile(join(root, patch.path), "utf8"))).toBe(patch.adaptedSha256);
  await unchanged(
    root,
    before.filter((file) => file.path !== agentPatch.path),
  );
  const after = await stat(join(root, agentPatch.path));
  expect(after.ino).not.toBe(before.find((file) => file.path === agentPatch.path)!.info.ino);
  expect(after.mode).toBe(before.find((file) => file.path === agentPatch.path)!.info.mode);
  const prepared = await snapshot(root);
  await preparePiHostWithRecovery(root, root, {
    acquireCleanSource: async () => {
      throw new Error("prepared runs must not acquire");
    },
    notice: (message) => notices.push(message),
  });
  await unchanged(root, prepared);
  expect(notices).toHaveLength(1);
});

test("contaminated hardlink recovery changes only local patch paths, retaining modes", async () => {
  const base = await temp();
  const local = join(base, "local");
  const cache = join(base, "cache");
  const sibling = join(base, "sibling");
  await fixture(cache, { ...originals, [agentPatch.path]: staleAgent });
  for (const root of [local, sibling]) {
    await mkdir(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.0.3" }));
    await writeFile(join(root, "unrelated.js"), "leave other dependency files alone");
    for (const patch of piHostPatches) {
      await mkdir(dirname(join(root, patch.path)), { recursive: true });
      await link(join(cache, patch.path), join(root, patch.path));
    }
  }
  const before = await snapshot(local);
  const cacheBefore = await snapshot(cache);
  const siblingBefore = await snapshot(sibling);
  const stages: string[] = [];
  await preparePiHostWithRecovery(base, local, { acquireCleanSource: acquisition(stages), notice: () => {} });
  await cleaned(stages);
  for (const patch of piHostPatches) {
    const info = await stat(join(local, patch.path));
    const previous = before.find((file) => file.path === patch.path)!.info;
    expect(previous.nlink).toBe(3);
    expect(info.nlink).toBe(1);
    expect(info.ino).not.toBe(previous.ino);
    expect(info.mode).toBe(previous.mode);
    expect(digest(await readFile(join(local, patch.path), "utf8"))).toBe(patch.adaptedSha256);
  }
  // Unlinking the local name lowers peer link counts, but never changes their
  // bytes, inode, mode or mtime.
  for (const beforePeer of [cacheBefore, siblingBefore]) {
    for (const file of beforePeer) if (piHostPatches.some((patch) => patch.path === file.path)) file.info.nlink = 2;
  }
  await unchanged(cache, cacheBefore);
  await unchanged(sibling, siblingBefore);
  await unchanged(
    local,
    before.filter((file) => !piHostPatches.some((patch) => patch.path === file.path)),
  );
});

test("normal pristine preparation also stays offline", async () => {
  const root = await temp();
  await fixture(root);
  await preparePiHostWithRecovery(root, root, {
    acquireCleanSource: async () => {
      throw new Error("normal preparation must not acquire");
    },
    notice: () => {
      throw new Error("normal preparation must not report recovery");
    },
  });
  for (const patch of piHostPatches)
    expect(digest(await readFile(join(root, patch.path), "utf8"))).toBe(patch.adaptedSha256);
});

for (const failure of ["unsupported version", "malformed metadata", "I/O error"] as const) {
  test(failure + " fails without acquisition or target writes, even alongside source drift", async () => {
    const root = await temp();
    await fixture(root, { ...originals, [agentPatch.path]: staleAgent });
    const missing = piHostPatches.at(-1)!.path;
    if (failure === "unsupported version") await writeFile(join(root, "package.json"), '{"version":"2.0.0"}');
    if (failure === "malformed metadata") await writeFile(join(root, "package.json"), "{");
    if (failure === "I/O error") await rm(join(root, missing));
    const before = await snapshot(root, [
      ...piHostPatches.map((patch) => patch.path).filter((path) => failure !== "I/O error" || path !== missing),
      "package.json",
      "unrelated.js",
    ]);
    let acquired = false;
    await expect(
      preparePiHostWithRecovery(root, root, {
        acquireCleanSource: async () => {
          acquired = true;
          throw new Error("must not acquire");
        },
      }),
    ).rejects.toThrow(
      failure === "unsupported version" ? "Unsupported Pi host version" : failure === "I/O error" ? "ENOENT" : "JSON",
    );
    expect(acquired).toBe(false);
    await unchanged(root, before);
  });
}

for (const failure of ["version", "source", "metadata", "I/O"] as const) {
  test("failing staged " + failure + " validation leaves target untouched and removes stage", async () => {
    const root = await temp();
    await fixture(root, { ...originals, [agentPatch.path]: staleAgent });
    const before = await snapshot(root);
    const stages: string[] = [];
    const acquire = acquisition(stages);
    await expect(
      preparePiHostWithRecovery(root, root, {
        acquireCleanSource: async (projectRoot, stage) => {
          const cleanRoot = await acquire(projectRoot, stage);
          if (failure === "version") await writeFile(join(cleanRoot, "package.json"), '{"version":"2.0.0"}');
          if (failure === "metadata") await writeFile(join(cleanRoot, "package.json"), "{");
          if (failure === "source") await writeFile(join(cleanRoot, piHostPatches.at(-1)!.path), "unknown bytes");
          if (failure === "I/O") await rm(join(cleanRoot, piHostPatches.at(-1)!.path));
          return cleanRoot;
        },
        notice: () => {
          throw new Error("must not report success");
        },
      }),
    ).rejects.toThrow(
      failure === "version"
        ? "Unsupported Pi host version"
        : failure === "source"
          ? "Unsupported Pi host file"
          : failure === "I/O"
            ? "ENOENT"
            : "JSON",
    );
    expect(stages).toHaveLength(1);
    await cleaned(stages);
    await unchanged(root, before);
  });
}

for (const failure of ["anchor", "result"] as const) {
  test("malformed adaptation " + failure + " still fails without recovery or target writes", async () => {
    const root = await temp();
    await fixture(root, { ...originals, [agentPatch.path]: staleAgent });
    const before = await snapshot(root);
    const patch = piHostPatches[1]!;
    const saved = { ...patch };
    let acquired = false;
    try {
      if (failure === "anchor") patch.replacements = [["missing anchor", "replacement"]];
      else patch.adaptedSha256 = "0".repeat(64);
      await expect(
        preparePiHostWithRecovery(root, root, {
          acquireCleanSource: async () => {
            acquired = true;
            throw new Error("must not acquire");
          },
        }),
      ).rejects.toThrow("Pi host adaptation " + (failure === "anchor" ? "anchor" : "result") + " changed");
      expect(acquired).toBe(false);
      await unchanged(root, before);
    } finally {
      Object.assign(patch, saved);
    }
  });
}

test("acquisition/network failure reports retry action, leaves target untouched and cleans partial stage", async () => {
  const root = await temp();
  await fixture(root, { ...originals, [agentPatch.path]: staleAgent });
  const before = await snapshot(root);
  const stages: string[] = [];
  await expect(
    preparePiHostWithRecovery(root, root, {
      acquireCleanSource: async (_projectRoot, stage) => {
        stages.push(stage);
        await writeFile(join(stage, "partial-download"), "partial");
        throw new Error("registry unavailable");
      },
      notice: () => {
        throw new Error("must not report success");
      },
    }),
  ).rejects.toThrow(
    "local host files were not changed. Check network/registry access and package.json, bun.lock and patches, then retry bun run prepare:assets. Error: registry unavailable",
  );
  expect(stages).toHaveLength(1);
  await cleaned(stages);
  await unchanged(root, before);
});

for (const source of ["original", "stale"] as const)
  test(`preparation refuses borrowed ${source} dependencies without acquisition or writes`, async () => {
    const project = await temp();
    const borrowed = await temp();
    await fixture(borrowed, source === "stale" ? { ...originals, [agentPatch.path]: staleAgent } : originals);
    const before = await snapshot(borrowed);
    const linked = join(project, "pi");
    await symlink(borrowed, linked, "dir");
    await expect(
      preparePiHostWithRecovery(project, linked, {
        acquireCleanSource: async () => {
          throw new Error("must not acquire for borrowed dependencies");
        },
        notice: () => {
          throw new Error("must not report recovery");
        },
      }),
    ).rejects.toThrow("checkout-local dependencies");
    await unchanged(borrowed, before);
  });
