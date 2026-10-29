import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launched, mine } from "../src/web/mine";
import type { Thread } from "../src/web/protocol";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const each of cleanup.splice(0)) each();
});

const thread = (id: string, parentId?: string): Thread => ({
  id,
  projectId: "p",
  title: id,
  status: "running",
  needsUser: false,
  pinned: false,
  away: false,
  parentId,
  createdAt: "",
  updatedAt: "",
});

test("the assistant's threads are kept per workspace and include what descends from them", () => {
  const dir = mkdtempSync(join(tmpdir(), "bruv-mine-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "threads.json");
  const one = mine(file, "/work/one");
  expect(one.add("a")).toBe(true);
  expect(one.add("a")).toBe(false);
  // Another assistant in another folder keeps its own list in the same file.
  const two = mine(file, "/work/two");
  two.add("x");
  // Both survive a restart.
  expect(mine(file, "/work/one").ids()).toEqual(["a"]);
  expect(mine(file, "/work/two").ids()).toEqual(["x"]);

  const all = new Map([
    ["a", thread("a")],
    ["sub", thread("sub", "a")],
    ["subsub", thread("subsub", "sub")],
    ["other", thread("other")],
  ]);
  const lookup = (id: string) => all.get(id);
  expect(["a", "sub", "subsub", "other"].filter((id) => one.has(all.get(id) as Thread, lookup))).toEqual([
    "a",
    "sub",
    "subsub",
  ]);
});

test("a launch result names its thread, however MCP gave it", () => {
  expect(launched({ structuredContent: { threadId: "mcp:1" } })).toBe("mcp:1");
  expect(launched({ content: [{ type: "text", text: '{"threadId":"mcp:2","status":"preparing"}' }] })).toBe("mcp:2");
  expect(launched({ content: [{ type: "text", text: "not json" }] })).toBeUndefined();
});
