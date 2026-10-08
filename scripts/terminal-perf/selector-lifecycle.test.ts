import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { TreeSelectorComponent } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tree-selector.js";
import { initTheme } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "../../src/history/session-manager";
import { installSelectorLifecycle } from "../../src/history/selector-lifecycle";
import { selectorBehavior } from "./selector-lifecycle-behavior";

const priorAssetDir = process.env.PI_PACKAGE_DIR;
delete process.env.PI_PACKAGE_DIR;
initTheme("dark");
if (priorAssetDir !== undefined) process.env.PI_PACKAGE_DIR = priorAssetDir;
installDiskBackedSessionManager();
installSelectorLifecycle();

test("selector projection matches pinned pre-patch geometry and 80/20-column output", () => {
  const result = selectorBehavior(TreeSelectorComponent);
  // Retain the pinned 1.0.3 golden for the 13 rendered replay states. Its final
  // capture had misplaced constructor arguments (default filter, missing selection).
  // Freeze that historical tail for the digest; check the corrected scenario directly.
  const historicalSnapshots = [
    ...result.snapshots.slice(0, -1),
    {
      name: "hidden-ancestor-and-tool-leaf",
      selected: "second-leaf",
      ids: ["root", "main", "call", "result", "leaf", "alternate", "alt-leaf", "second-leaf"],
    },
  ];
  expect(createHash("sha256").update(JSON.stringify(historicalSnapshots)).digest("hex")).toBe(
    "285c955d33fdedc527cc7faccd560f1bc630fc097a7049161806197b4aeff685",
  );
  expect(result.snapshots.at(-1)).toEqual({
    name: "hidden-ancestor-and-tool-leaf",
    selected: "root", // The requested settings entry is hidden: select its visible ancestor.
    ids: ["root", "main", "call", "leaf", "alternate", "alt-leaf", "second-leaf"],
  });
  expect(result.snapshots).toHaveLength(14);
  expect(result.accepted).toBe("alternate");
  expect(result.cancelled).toBe(1);
  const folded = result.snapshots.find((s) => s.name === "fold");
  expect(folded.visible.map((n: any) => n.id)).toEqual(["root", "second-leaf"]);
  expect(result.snapshots.find((s) => s.name === "empty-search").visible).toEqual([]);
});

test("native session entry count retains in-memory semantics", () => {
  const manager = SessionManager.inMemory("/tmp");
  try {
    const id = manager.appendMessage({ role: "user", content: "kept", timestamp: 0 });
    manager.appendCompaction("summary", id, 100);
    expect(manager.getEntryCount()).toBe(2);
    expect(manager.getEntryCountByType("message")).toBe(1);
    expect(manager.getEntryCountByType("compaction")).toBe(1);
    expect(manager.getEntryCountByType("branch_summary")).toBe(0);
  } finally {
    disposeDiskBackedSessionManager(manager);
  }
});

test("disk count reads metadata, includes inactive branch compactions, and never rewrites history", () => {
  const root = mkdtempSync(join(tmpdir(), "bruv-selector-count-"));
  try {
    const file = writeBranchedHistory(root);
    const manager = SessionManager.open(file);
    const getEntries = manager.getEntries;
    try {
      const before = readFileSync(file);
      manager.getEntries = () => {
        throw new Error("body replay forbidden for count");
      };
      expect(manager.getLeafId()).toBe("alternate");
      expect(manager.getEntryCountByType("compaction")).toBe(1);
      expect(manager.getEntryCountByType("message")).toBe(2);
      manager.branch("user");
      expect(manager.getEntryCountByType("compaction")).toBe(1);
      manager.appendCompaction("new summary", "user", 20);
      expect(manager.getEntryCountByType("compaction")).toBe(2);
      // Append only: all existing bytes remain intact.
      expect(readFileSync(file).subarray(0, before.length)).toEqual(before);
    } finally {
      manager.getEntries = getEntries;
      disposeDiskBackedSessionManager(manager);
    }

    // Reopen without the replay guard to verify persisted counts and bodies.
    const reopened = SessionManager.open(file);
    try {
      expect(reopened.getEntryCountByType("compaction")).toBe(2);
      expect(reopened.getEntries().filter((e) => e.type === "message")).toHaveLength(2);
    } finally {
      disposeDiskBackedSessionManager(reopened);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The alternate message leaves the existing compaction on an inactive branch.
function writeBranchedHistory(root: string): string {
  const file = join(root, "history.jsonl");
  const timestamp = "2026-01-01T00:00:00.000Z";
  writeFileSync(
    file,
    [
      { type: "session", version: 3, id: "count", timestamp, cwd: root },
      {
        type: "message",
        id: "user",
        parentId: null,
        timestamp,
        message: { role: "user", content: "body must remain", timestamp: 0 },
      },
      {
        type: "compaction",
        id: "compact",
        parentId: "user",
        timestamp,
        summary: "preserve me",
        firstKeptEntryId: "user",
        tokensBefore: 10,
      },
      {
        type: "message",
        id: "alternate",
        parentId: "user",
        timestamp,
        message: { role: "user", content: "other branch", timestamp: 0 },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  return file;
}
