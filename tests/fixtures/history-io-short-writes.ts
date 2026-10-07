import { expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";

const realWriteSync = fs.writeSync.bind(fs);
let calls = 0;
let writesUntilFailure = Infinity;
function shortWrite(
  fd: number,
  buffer: string | NodeJS.ArrayBufferView,
  offset?: number,
  length?: number,
  position?: number | null,
): number {
  if (typeof buffer === "string") return realWriteSync(fd, buffer, offset);
  calls++;
  if (--writesUntilFailure === 0) throw new Error("simulated disk full");
  const start = typeof offset === "number" ? offset : 0;
  const requested = typeof length === "number" ? length : buffer.byteLength - start;
  const shortLength = Math.max(1, Math.min(requested, Math.ceil(requested / 3)));
  return realWriteSync(fd, buffer, start, shortLength, position ?? null);
}
mock.module("node:fs", () => ({ ...fs, default: { ...fs, writeSync: shortWrite }, writeSync: shortWrite }));
// Import only after installing the mock; the parent process stays unmodified.
const { DiskEntryStore } = await import("../../src/history/disk-entry-store");
test("short writes", () => {
  const header: SessionHeader = { type: "session", version: 3, id: "short", timestamp: "x", cwd: "/" };
  const entry = {
    type: "message",
    id: "entry",
    parentId: null,
    timestamp: "x",
    message: { role: "user", content: "🙂".repeat(1000), timestamp: 1 },
  } satisfies SessionEntry;
  const store = DiskEntryStore.fromEntries(process.env.HISTORY_IO_PATH!, header, [entry], true);
  expect(store.materialize("entry")).toEqual(entry);
  expect(calls).toBeGreaterThan(2);
  const before = fs.readFileSync(process.env.HISTORY_IO_PATH!);
  // Fail the second write: the first has already changed the file.
  writesUntilFailure = 2;
  expect(() => store.append({ ...entry, id: "failed" })).toThrow("simulated disk full");
  expect(fs.readFileSync(process.env.HISTORY_IO_PATH!)).toEqual(before);
  writesUntilFailure = Infinity;
  store.append({ ...entry, id: "after", parentId: "entry" });
  const reopened = DiskEntryStore.open(process.env.HISTORY_IO_PATH!);
  expect(reopened.entries.map(({ id }) => id)).toEqual(["entry", "after"]);
  expect(reopened.materialize("entry")).toEqual(entry);
});
