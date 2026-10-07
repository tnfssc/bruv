import { expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childJournalEntries } from "../src/claude-compat/task-child-journal";

async function fixture(run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "bruv-child-tail-"));
  try {
    await run(join(dir, "child.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function collect(path: string, offset = 0) {
  const entries = [];
  for await (const entry of childJournalEntries(path, offset)) entries.push(entry);
  return entries;
}
test("child tail uses byte offsets and retries incomplete final records", async () =>
  fixture(async (path) => {
    const first = JSON.stringify({ type: "message", id: "first", text: "é🙂" }) + "\n";
    const second = JSON.stringify({ type: "message", id: "second", text: "second" });
    await writeFile(path, first + second.slice(0, -1));
    const initial = await collect(path);
    expect(initial.map((row) => row.entry?.id)).toEqual(["first"]);
    expect(initial[0].endOffset).toBe(Buffer.byteLength(first));
    await appendFile(path, "}\n");
    expect((await collect(path, initial[0].endOffset)).map((row) => row.entry?.id)).toEqual(["second"]);
    expect(await collect(path, Buffer.byteLength(first + second + "\n"))).toEqual([]);
  }));
test("child tail only reads the suffix, including records crossing chunk boundaries", async () =>
  fixture(async (path) => {
    const prefix = "deliberately not JSON\n";
    const record = JSON.stringify({ type: "message", id: "large", text: "🙂".repeat(40_000) }) + "\n";
    await writeFile(path, prefix + record + "\n");
    const rows = await collect(path, Buffer.byteLength(prefix));
    expect(rows[0].entry).toEqual(JSON.parse(record));
    expect(rows[0].endOffset).toBe(Buffer.byteLength(prefix + record));
    expect(rows[1]).toEqual({ entry: undefined, endOffset: Buffer.byteLength(prefix + record + "\n") });
  }));
test("child originals cannot be silently truncated behind a saved cursor", async () =>
  fixture(async (path) => {
    await writeFile(path, "");
    await expect(collect(path, 10)).rejects.toThrow("truncated");
  }));
