import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { downloadRepositoryResult, type RepositoryResultPage } from "../src/remote/repository-download";
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
test("page bounds, canonical base64, no-progress and metadata stability remain strict", async () => {
  const request = pages(Buffer.alloc(CHUNK + 1, 120));
  for (const change of [
    { data: "eA" },
    { data: "eA==\n" },
    { data: "eB==" },
    { total: -1 },
    { total: 1.5 },
    { total: 129 * 1024 * 1024 },
    { data: Buffer.alloc(CHUNK + 1).toString("base64") },
    { offset: 1 },
    { data: "", offset: 0 },
  ]) {
    await expect(
      downloadRepositoryResult(
        async (offset) => ({ ...(await request(offset)), ...change }),
        snapshot,
        128 * 1024 * 1024,
      ),
    ).rejects.toThrow("page");
  }
  await expect(
    downloadRepositoryResult(
      async (offset) => {
        const r = await request(offset);
        return offset ? { ...r, result: { ...r.result, untracked: ["changed"] } } : r;
      },
      snapshot,
      128 * 1024 * 1024,
    ),
  ).rejects.toThrow("page");
  await expect(
    downloadRepositoryResult(
      async (offset) => ({ ...(await request(offset)), total: 32 * 1024 * 1024 + 1 }),
      snapshot,
      32 * 1024 * 1024,
    ),
  ).rejects.toThrow("page");
});
test("digest/snapshot mismatches and bounded child page exhaustion cannot produce a verified patch", async () => {
  const request = pages(Buffer.from("patch"));
  await expect(downloadRepositoryResult(request, "b".repeat(40), 128 * 1024 * 1024)).rejects.toThrow("mismatch");
  await expect(
    downloadRepositoryResult(
      async (offset) => {
        const r = await request(offset);
        return { ...r, result: { ...r.result, sha256: "0".repeat(64) } };
      },
      snapshot,
      128 * 1024 * 1024,
    ),
  ).rejects.toThrow("mismatch");
  await expect(
    downloadRepositoryResult(pages(Buffer.alloc(CHUNK + 1, 120)), snapshot, 128 * 1024 * 1024, { maxPages: 0 }),
  ).rejects.toThrow("mismatch");
});
test("offline download retries reuse the original request; root error labels stay intact", async () => {
  let offline = true;
  const request = pages(Buffer.from("patch"));
  const remote = async (offset: number) => {
    if (offline) throw Error("offline");
    return request(offset);
  };
  await expect(downloadRepositoryResult(remote, snapshot, 32 * 1024 * 1024)).rejects.toThrow("offline");
  offline = false;
  expect((await downloadRepositoryResult(remote, snapshot, 32 * 1024 * 1024)).patch.toString()).toBe("patch");
  await expect(
    downloadRepositoryResult(request, "different", 32 * 1024 * 1024, {
      integrityError: "Root result digest or source mismatch",
    }),
  ).rejects.toThrow("Root result");
  await expect(
    downloadRepositoryResult(
      async (offset) => ({ ...(await request(offset)), data: "bad" }),
      snapshot,
      32 * 1024 * 1024,
      { pageError: "Invalid root repository result page" },
    ),
  ).rejects.toThrow("Invalid root");
});
