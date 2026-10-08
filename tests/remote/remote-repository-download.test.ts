import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { downloadRepositoryResult, type RepositoryResultPage } from "../../src/remote/repository-download";

const CHUNK = 256 * 1024;
const snapshot = "a".repeat(40);
function pages(patch: Buffer) {
  const result = {
    snapshot,
    patch: "/remote/result.patch",
    sha256: createHash("sha256").update(patch).digest("hex"),
    untracked: [],
  };
  return (offset: number): Promise<RepositoryResultPage> =>
    Promise.resolve({
      result,
      total: patch.length,
      offset: Math.min(offset + CHUNK, patch.length),
      data: patch.subarray(offset, offset + CHUNK).toString("base64"),
    });
}
test("empty and multi-page patches preserve verified bytes under each client byte limit", async () => {
  for (const max of [32 * 1024 * 1024, 128 * 1024 * 1024]) {
    for (const patch of [Buffer.alloc(0), Buffer.alloc(CHUNK + 31, 120)]) {
      const downloaded = await downloadRepositoryResult(pages(patch), snapshot, max);
      expect(downloaded.patch).toEqual(patch);
      expect(downloaded.result.snapshot).toBe(snapshot);
    }
  }
});

test.each([
  ["missing padding", "eA"],
  ["trailing whitespace", "eA==\n"],
  ["nonzero padding bits", "eB=="],
])("rejects non-canonical base64: %s", async (_reason, data) => {
  const request = pages(Buffer.from("x"));
  await expect(
    downloadRepositoryResult(async (offset) => ({ ...(await request(offset)), data }), snapshot, 128 * 1024 * 1024),
  ).rejects.toThrow("page");
});

test.each([
  { violation: "negative total", change: { total: -1 } },
  { violation: "fractional total", change: { total: 1.5 } },
  {
    violation: "oversized chunk",
    change: { data: Buffer.alloc(CHUNK + 1, 120).toString("base64"), offset: CHUNK + 1 },
  },
  { violation: "offset disagrees with decoded length", change: { offset: 1 } },
  { violation: "unfinished page makes no progress", change: { data: "", offset: 0 } },
])("rejects invalid pagination: $violation", async ({ change }) => {
  const request = pages(Buffer.alloc(CHUNK + 1, 120));
  await expect(
    downloadRepositoryResult(
      async (offset) => ({ ...(await request(offset)), ...change }),
      snapshot,
      128 * 1024 * 1024,
    ),
  ).rejects.toThrow("page");
});

test.each([32, 128])("rejects a total above the %i MiB client limit", async (limitMiB) => {
  const maxBytes = limitMiB * 1024 * 1024;
  const request = pages(Buffer.alloc(CHUNK + 1, 120));
  await expect(
    downloadRepositoryResult(
      async (offset) => ({ ...(await request(offset)), total: maxBytes + 1 }),
      snapshot,
      maxBytes,
    ),
  ).rejects.toThrow("page");
});

test("a later page cannot change the result descriptor", async () => {
  const request = pages(Buffer.alloc(CHUNK + 1, 120));
  const offsets: number[] = [];
  await expect(
    downloadRepositoryResult(
      async (offset) => {
        offsets.push(offset);
        const page = await request(offset);
        return offset ? { ...page, result: { ...page.result, untracked: ["changed"] } } : page;
      },
      snapshot,
      128 * 1024 * 1024,
    ),
  ).rejects.toThrow("page");
  expect(offsets).toEqual([0, CHUNK]);
});

test("assembled bytes must match the result digest and requested snapshot", async () => {
  const request = pages(Buffer.from("patch"));
  await expect(downloadRepositoryResult(request, "b".repeat(40), 128 * 1024 * 1024)).rejects.toThrow("mismatch");
  await expect(
    downloadRepositoryResult(
      async (offset) => {
        const page = await request(offset);
        return { ...page, result: { ...page.result, sha256: "0".repeat(64) } };
      },
      snapshot,
      128 * 1024 * 1024,
    ),
  ).rejects.toThrow("mismatch");
});

test("exhausting the child page budget cannot return a partial patch", async () => {
  const request = pages(Buffer.alloc(CHUNK + 1, 120));
  const offsets: number[] = [];
  await expect(
    downloadRepositoryResult(
      (offset) => {
        offsets.push(offset);
        return request(offset);
      },
      snapshot,
      128 * 1024 * 1024,
      { maxPages: 0 },
    ),
  ).rejects.toThrow("mismatch");
  expect(offsets).toEqual([0]);
});

test.each<{ failAt: number; offsets: number[] }>([
  { failAt: 0, offsets: [0, 0, CHUNK] },
  { failAt: CHUNK, offsets: [0, CHUNK, 0, CHUNK] },
])("offline failure at offset $failAt propagates; retry starts a fresh download", async ({ failAt, offsets }) => {
  const patch = Buffer.alloc(CHUNK + 1, 120);
  const request = pages(patch);
  const requested: number[] = [];
  let offline = true;
  const remote = async (offset: number) => {
    requested.push(offset);
    if (offline && offset === failAt) throw Error("offline");
    return request(offset);
  };
  await expect(downloadRepositoryResult(remote, snapshot, 32 * 1024 * 1024)).rejects.toThrow("offline");
  offline = false;
  expect((await downloadRepositoryResult(remote, snapshot, 32 * 1024 * 1024)).patch).toEqual(patch);
  expect(requested).toEqual(offsets);
});

test("root callers retain their page and integrity error labels", async () => {
  const request = pages(Buffer.from("patch"));
  await expect(
    downloadRepositoryResult(request, "different", 32 * 1024 * 1024, {
      integrityError: "Root result digest or source mismatch",
    }),
  ).rejects.toThrow("Root result digest or source mismatch");
  await expect(
    downloadRepositoryResult(
      async (offset) => ({ ...(await request(offset)), data: "bad" }),
      snapshot,
      32 * 1024 * 1024,
      { pageError: "Invalid root repository result page" },
    ),
  ).rejects.toThrow("Invalid root repository result page");
});
