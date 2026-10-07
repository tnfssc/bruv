import { run as runProcess } from "./helpers";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import { DiskEntryStore, scanJsonl } from "../src/history/disk-entry-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bruv-history-io-"));
  roots.push(root);
  return join(root, "session.jsonl");
}

// Filesystem mocks must never enter the parent test process's module cache.
async function runIsolatedIoFault(fixture: string): Promise<void> {
  const path = await temporaryFile();
  const { stdout, stderr, code } = await runProcess(
    [process.execPath, "test", join(import.meta.dir, "fixtures", fixture)],
    { cwd: join(import.meta.dir, ".."), env: { ...process.env, HISTORY_IO_PATH: path } },
  );
  expect(code, `${fixture} failed:\n${stdout}\n${stderr}`).toBe(0);
}

function header(): SessionHeader {
  return {
    type: "session",
    version: 3,
    id: "session-io",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/io",
  } as SessionHeader;
}

function message(id: string, content: string, parentId: string | null = null): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content, timestamp: 1 },
  } as SessionEntry;
}

function assistant(id: string, parentId: string | null): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "published" }],
      api: "openai-responses",
      provider: "test",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
      stopReason: "stop",
      timestamp: 2,
    },
  } as unknown as SessionEntry;
}

function content(entry: SessionEntry): string {
  return (entry as SessionEntry & { message: { content: string } }).message.content;
}

describe("disk entry store I/O correctness", () => {
  test("scanJsonl propagates visitor exceptions rather than treating them as malformed JSON", async () => {
    const path = await temporaryFile();
    await writeFile(path, JSON.stringify(header()) + "\n");
    const sentinel = new Error("visitor storage failure");

    expect(() =>
      scanJsonl(path, () => {
        throw sentinel;
      }),
    ).toThrow(sentinel);
  });

  test("scans Unicode, CRLF, records larger than the scan buffer, and repairs a valid unterminated tail before append", async () => {
    const path = await temporaryFile();
    const unicode = "🙂漢字e\u0301".repeat(12_000);
    const first = message("large", unicode);
    const tail = message("tail", "unterminated ✅", "large");
    await writeFile(
      path,
      [JSON.stringify(header()), JSON.stringify(first), "{not json", JSON.stringify(tail)].join("\r\n"),
    );

    const store = DiskEntryStore.open(path, 256);
    expect(store.entries.map(({ id }) => id)).toEqual(["large", "tail"]);
    expect(content(store.materialize(store.entries[0]!))).toBe(unicode);
    expect(content(store.materialize(store.entries[1]!))).toBe("unterminated ✅");

    store.append(message("after", "after tail", "tail"));
    const bytes = await readFile(path);
    expect(
      bytes.includes(Buffer.from(JSON.stringify(tail) + "\n" + JSON.stringify(message("after", "after tail", "tail")))),
    ).toBe(true);

    const reopened = DiskEntryStore.open(path, 256);
    expect(reopened.entries.map(({ id }) => id)).toEqual(["large", "tail", "after"]);
    expect(content(reopened.materialize("after"))).toBe("after tail");
  });

  test("retries short writes and rolls back failed partial appends in an isolated subprocess", async () => {
    await runIsolatedIoFault("history-io-short-writes.ts");
  });

  test.each([
    ["user", message("first", "published", "setup")],
    ["assistant", assistant("first", "setup")],
  ] as const)("a pending journal publishes on its first %s, not setup entries", async (_role, first) => {
    const path = await temporaryFile();
    const store = DiskEntryStore.pending(path, header());
    store.append({
      type: "thinking_level_change",
      id: "setup",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      thinkingLevel: "off",
    } as SessionEntry);
    expect(await Bun.file(path).exists()).toBe(false);
    expect(store.flushed).toBe(false);

    store.append(first);

    expect(store.flushed).toBe(true);
    expect(DiskEntryStore.open(path).materializeAll()).toEqual([store.materialize("setup"), first]);
  });

  test("failed first-user publication rolls back the pending append and can be retried", async () => {
    const path = await temporaryFile();
    const store = DiskEntryStore.pending(path, header(), 1024);
    store.append({
      type: "thinking_level_change",
      id: "before",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      thinkingLevel: "off",
    } as SessionEntry);
    store.materialize("before");
    const internals = store as unknown as {
      cache: Map<string, Buffer>;
      cacheBytes: number;
      spoolPath: string;
    };
    const cachedBefore = [...internals.cache].map(([key, bytes]) => [key, Buffer.from(bytes)] as const);
    const cacheBytesBefore = internals.cacheBytes;
    const pendingBytesBefore = await readFile(internals.spoolPath);
    await writeFile(path, "collision sentinel\n");

    expect(() => store.append(message("failed", "must retry", "before"))).toThrow();

    expect(await readFile(path, "utf8")).toBe("collision sentinel\n");
    expect(store.entries.map(({ id }) => id)).toEqual(["before"]);
    expect(store.byId.has("failed")).toBe(false);
    expect(() => store.materialize("failed")).toThrow("not found");
    expect(store.flushed).toBe(false);
    expect(await readFile(internals.spoolPath)).toEqual(pendingBytesBefore);
    expect(internals.cacheBytes).toBe(cacheBytesBefore);
    expect([...internals.cache].map(([key, bytes]) => [key, bytes] as const)).toEqual(cachedBefore);

    await rm(path);
    store.append(message("recovered", "persisted", "before"));
    expect(store.flushed).toBe(true);
    expect(store.entries.map(({ id }) => id)).toEqual(["before", "recovered"]);
    expect(DiskEntryStore.open(path).entries.map(({ id }) => id)).toEqual(["before", "recovered"]);
  });

  test("a failed spool unlink does not undo successful publication", async () => {
    await runIsolatedIoFault("history-io-cleanup-failure.ts");
  });

  test("failed atomic replacement leaves a published journal usable and appendable", async () => {
    const path = await temporaryFile();
    const store = DiskEntryStore.pending(path, header());
    store.append(message("before", "must survive"));
    const invalid = { ...message("bad", "never written"), cannotSerialize: 1n } as unknown as SessionEntry;

    expect(() => DiskEntryStore.fromEntries(path, header(), [invalid], true)).toThrow();
    store.append(assistant("after", "before"));

    const records: Array<Record<string, unknown>> = [];
    scanJsonl(path, ({ entry }) => records.push(entry as unknown as Record<string, unknown>));
    expect(records.map(({ type }) => type)).toEqual(["session", "message", "message"]);
    expect(records.map(({ id }) => id)).toEqual(["session-io", "before", "after"]);
    expect(content(DiskEntryStore.open(path).materialize("before"))).toBe("must survive");
  });

  test("duplicate IDs retain distinct physical records while ID lookup resolves to the last record", async () => {
    const path = await temporaryFile();
    const first = message("duplicate", "first physical body");
    const second = message("duplicate", "second physical body", "duplicate");
    const store = DiskEntryStore.fromEntries(path, header(), [first, second], true, 1024 * 1024);

    expect(store.entries).toHaveLength(2);
    expect(content(store.materialize(store.entries[0]!))).toBe("first physical body");
    expect(content(store.materialize(store.entries[1]!))).toBe("second physical body");
    expect(content(store.materialize("duplicate"))).toBe("second physical body");
    expect(store.materializeAll().map(content)).toEqual(["first physical body", "second physical body"]);
  });
  test("cache retains exact bounded serialized buffers rather than parsed graphs", async () => {
    const path = await temporaryFile();
    const store = DiskEntryStore.fromEntries(path, header(), [], true, 1024);
    for (let i = 0; i < 20; i++) store.append(message(String(i), "body".repeat(50)));
    const cache = store as unknown as { cache: Map<string, Buffer>; cacheBytes: number };
    expect([...cache.cache.values()].every(Buffer.isBuffer)).toBe(true);
    expect([...cache.cache.values()].reduce((total, bytes) => total + bytes.length, 0)).toBe(cache.cacheBytes);
    expect(cache.cacheBytes).toBeLessThanOrEqual(1024);
    store.append(message("oversized", "x".repeat(2048)));
    expect(cache.cacheBytes).toBeLessThanOrEqual(1024);
    expect(content(store.materialize("0"))).toBe("body".repeat(50));
  });
});
