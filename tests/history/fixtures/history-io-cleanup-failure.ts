import { expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";

const realUnlinkSync = fs.unlinkSync.bind(fs);
let failCleanup = true;
function unlinkSync(path: fs.PathLike): void {
  if (failCleanup && String(path).includes(".pending-")) {
    failCleanup = false;
    throw new Error("simulated cleanup failure");
  }
  realUnlinkSync(path);
}
mock.module("node:fs", () => ({ ...fs, default: { ...fs, unlinkSync }, unlinkSync }));
// Import only after installing the mock; the parent process stays unmodified.
const { DiskEntryStore } = await import("../../../src/history/disk-entry-store");
test("cleanup failure", () => {
  const header: SessionHeader = { type: "session", version: 3, id: "cleanup", timestamp: "x", cwd: "/" };
  const user = {
    type: "message",
    id: "user",
    parentId: null,
    timestamp: "x",
    message: { role: "user", content: "before", timestamp: 1 },
  } satisfies SessionEntry;
  const assistant = {
    type: "message",
    id: "assistant",
    parentId: "user",
    timestamp: "x",
    message: {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    },
  } satisfies SessionEntry;
  const store = DiskEntryStore.pending(process.env.HISTORY_IO_PATH!, header);
  expect(() => store.append(user)).not.toThrow();
  expect(failCleanup).toBe(false);
  store.append(assistant);
  expect(store.flushed).toBe(true);
  expect(DiskEntryStore.open(process.env.HISTORY_IO_PATH!).entries.map(({ id }) => id)).toEqual(["user", "assistant"]);
});
