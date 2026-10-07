import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import {
  retainTranscriptSnapshot,
  SNAPSHOT_DIR,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_FILES,
  SNAPSHOT_TTL_MS,
} from "../../src/session/transcript-snapshots";

// This fixture removes the whole store between cases; never run it against the
// process-shared live store. The parent test creates and removes this private root.
if (!process.env.BRUV_SNAPSHOT_TEST_ROOT || process.env.TMPDIR !== process.env.BRUV_SNAPSHOT_TEST_ROOT)
  throw new Error("Run through tests/transcript-snapshots.test.ts with an isolated temporary store");

const lock = join(SNAPSHOT_DIR, ".lock");
const pathFor = (content: string) => join(SNAPSHOT_DIR, createHash("sha256").update(content).digest("hex") + ".json");
async function exists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}

beforeEach(async () => {
  await fs.rm(SNAPSHOT_DIR, { recursive: true, force: true });
});
afterEach(() => mock.restore());

test("content identity is immutable; reuse renews the queued reader lifetime without rewriting", async () => {
  const content = JSON.stringify({ entries: [{ text: "received voice text" }] });
  const path = await retainTranscriptSnapshot(content);
  expect(path).toBe(pathFor(content));
  expect((await fs.lstat(SNAPSHOT_DIR)).mode & 0o077).toBe(0);
  expect((await fs.lstat(path)).mode & 0o077).toBe(0);
  const original = await fs.lstat(path);
  const old = new Date(Date.now() - SNAPSHOT_TTL_MS + 10_000);
  await fs.utimes(path, old, old);
  const renewed = await retainTranscriptSnapshot(content);
  expect(renewed).toBe(path);
  expect((await fs.lstat(path)).mtimeMs).toBeGreaterThan(old.getTime());
  expect((await fs.lstat(path)).ino).toBe(original.ino);
  expect(await fs.readFile(path, "utf8")).toBe(content);
  expect(await exists(lock)).toBe(false);
});

test("expiry reclaims only snapshots at or beyond TTL; unrelated files and queued readers remain", async () => {
  const expired = await retainTranscriptSnapshot("expired");
  const queued = await retainTranscriptSnapshot("queued reader");
  const now = Date.now();
  await fs.utimes(expired, new Date(now - SNAPSHOT_TTL_MS), new Date(now - SNAPSHOT_TTL_MS));
  await fs.utimes(queued, new Date(now - SNAPSHOT_TTL_MS + 1_000), new Date(now - SNAPSHOT_TTL_MS + 1_000));
  const unrelated = join(SNAPSHOT_DIR, "unrelated.txt");
  await fs.writeFile(unrelated, "not a snapshot");
  spyOn(Date, "now").mockReturnValue(now);
  await retainTranscriptSnapshot("later handoff");
  expect(await exists(expired)).toBe(false);
  expect(await fs.readFile(queued, "utf8")).toBe("queued reader");
  expect(await fs.readFile(unrelated, "utf8")).toBe("not a snapshot");
});

test("file admission never evicts unexpired readers; existing content reuses a full store", async () => {
  for (let i = 0; i < SNAPSHOT_MAX_FILES; i++) await retainTranscriptSnapshot("queued " + i);
  const reused = await retainTranscriptSnapshot("queued 0");
  expect(reused).toBe(pathFor("queued 0"));
  await expect(retainTranscriptSnapshot("one too many")).rejects.toThrow("budget exhausted");
  expect((await fs.readdir(SNAPSHOT_DIR)).length).toBe(SNAPSHOT_MAX_FILES);
  expect(await fs.readFile(reused, "utf8")).toBe("queued 0");
  expect(await exists(pathFor("one too many"))).toBe(false);
  expect(await exists(lock)).toBe(false);
});

test("byte admission measures UTF-8 bytes and still permits reuse at the exact budget", async () => {
  const content = "é".repeat(SNAPSHOT_MAX_BYTES / 2);
  const path = await retainTranscriptSnapshot(content);
  expect((await fs.lstat(path)).size).toBe(SNAPSHOT_MAX_BYTES);
  expect(await retainTranscriptSnapshot(content)).toBe(path);
  await expect(retainTranscriptSnapshot("new")).rejects.toThrow("budget exhausted");
  expect(await fs.readFile(path, "utf8")).toBe(content);
});

test("oversized content fails before taking the store lock", async () => {
  await expect(retainTranscriptSnapshot("é".repeat(SNAPSHOT_MAX_BYTES / 2 + 1))).rejects.toThrow("exceeds 16 MiB");
  expect(await exists(SNAPSHOT_DIR)).toBe(false);
});

test("concurrent retainers serialize budget admission without overwriting or evicting", async () => {
  const a = "a".repeat(SNAPSHOT_MAX_BYTES / 2 + 1);
  const b = "b".repeat(SNAPSHOT_MAX_BYTES / 2 + 1);
  const results = await Promise.allSettled([retainTranscriptSnapshot(a), retainTranscriptSnapshot(b)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  expect(failure.reason.message).toContain("budget exhausted");
  const winner = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<string>;
  expect(await fs.readFile(winner.value, "utf8")).toBe(winner.value === pathFor(a) ? a : b);
  expect((await fs.readdir(SNAPSHOT_DIR)).length).toBe(1);
});

test("concurrent handoffs of identical content share one immutable file", async () => {
  const paths = await Promise.all(Array.from({ length: 8 }, () => retainTranscriptSnapshot("shared")));
  expect(new Set(paths).size).toBe(1);
  expect(await fs.readFile(paths[0]!, "utf8")).toBe("shared");
  expect(await fs.readdir(SNAPSHOT_DIR)).toEqual([pathFor("shared").split("/").at(-1)!]);
});

test("a held lock delays writes; an abandoned lock is reclaimed", async () => {
  await fs.mkdir(SNAPSHOT_DIR, { mode: 0o700 });
  await fs.mkdir(lock, { mode: 0o700 });
  const waiting = retainTranscriptSnapshot("waited");
  await Bun.sleep(60);
  expect(await exists(pathFor("waited"))).toBe(false);
  await fs.rm(lock, { recursive: true });
  await expect(waiting).resolves.toBe(pathFor("waited"));
  await fs.mkdir(lock, { mode: 0o700 });
  const stale = new Date(Date.now() - 10 * 60 * 1000 - 1_000);
  await fs.utimes(lock, stale, stale);
  await expect(retainTranscriptSnapshot("after crash")).resolves.toBe(pathFor("after crash"));
  expect(await exists(lock)).toBe(false);
});

test("a live lock times out without removing its owner or publishing a snapshot", async () => {
  await fs.mkdir(SNAPSHOT_DIR, { mode: 0o700 });
  await fs.mkdir(lock, { mode: 0o700 });
  await expect(retainTranscriptSnapshot("blocked")).rejects.toThrow("store busy");
  expect((await fs.lstat(lock)).isDirectory()).toBe(true);
  expect(await exists(pathFor("blocked"))).toBe(false);
}, 10_000);

test("unsafe directory and snapshot symlinks are rejected without following their targets", async () => {
  await fs.mkdir(SNAPSHOT_DIR, { mode: 0o755 });
  await fs.chmod(SNAPSHOT_DIR, 0o755);
  await expect(retainTranscriptSnapshot("private")).rejects.toThrow("Unsafe transcript snapshot directory");
  await fs.chmod(SNAPSHOT_DIR, 0o700);
  const target = join(SNAPSHOT_DIR, "target.txt");
  await fs.writeFile(target, "private target");
  await fs.symlink(target, pathFor("private"));
  await expect(retainTranscriptSnapshot("private")).rejects.toThrow("Unsafe transcript snapshot file");
  expect(await fs.readFile(target, "utf8")).toBe("private target");
  expect(await exists(lock)).toBe(false);
});

test("corrupt addressed content is rejected rather than renewed or replaced", async () => {
  const path = await retainTranscriptSnapshot("original");
  await fs.writeFile(path, "corrupted");
  await expect(retainTranscriptSnapshot("original")).rejects.toThrow("snapshot corrupted");
  expect(await fs.readFile(path, "utf8")).toBe("corrupted");
  expect(await exists(lock)).toBe(false);
});

test("a failed partial write is removed and the lock is released so a later attempt can succeed", async () => {
  const queued = await retainTranscriptSnapshot("queued reader");
  const realWrite = fs.writeFile;
  const write = spyOn(fs, "writeFile").mockImplementation(async (path, _content, options) => {
    await realWrite(path, "partial", options);
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
  });
  await expect(retainTranscriptSnapshot("complete")).rejects.toThrow("disk full");
  expect(await exists(pathFor("complete"))).toBe(false);
  expect(await exists(lock)).toBe(false);
  expect(await fs.readFile(queued, "utf8")).toBe("queued reader");
  write.mockRestore();
  const path = await retainTranscriptSnapshot("complete");
  expect(await fs.readFile(path, "utf8")).toBe("complete");
});

test("exclusive-write collision does not roll back a file owned by another writer", async () => {
  const realWrite = fs.writeFile;
  spyOn(fs, "writeFile").mockImplementation(async (path, _content, options) => {
    await realWrite(path, "other writer", options);
    await realWrite(path, _content, options);
  });
  await expect(retainTranscriptSnapshot("collision")).rejects.toThrow("EEXIST");
  expect(await fs.readFile(pathFor("collision"), "utf8")).toBe("other writer");
  expect(await exists(lock)).toBe(false);
});
