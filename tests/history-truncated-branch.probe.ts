import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  disposeDiskBackedSessionManager,
  getDiskBackedBranch,
  getDiskBackedBranchRevision,
  getDiskBackedContextLeafId,
  getDiskBackedShakeLeafId,
  getLatestDiskBackedCustomEntry,
  installDiskBackedSessionManager,
  selectDiskBackedBranchEntries,
  selectDiskBackedEntries,
  visitDiskBackedBranch,
} from "../src/history/session-manager";

const root = process.env.PROBE_ROOT!;
const timestamp = "2026-10-07T00:00:00.000Z";
const custom = (id: string, parentId: string | null) => ({
  type: "custom",
  id,
  parentId,
  timestamp,
  customType: "state",
  data: { id },
});
const message = (id: string, parentId: string | null) => ({
  type: "message",
  id,
  parentId,
  timestamp,
  message: { role: "user", content: id, timestamp: 1 },
});
const fixture = (name: string, rows: (object | string)[]) => {
  const file = join(root, name + ".jsonl");
  const header = { type: "session", version: 3, id: name, cwd: root, timestamp };
  writeFileSync(
    file,
    [header, ...rows].map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n") + "\n",
  );
  return file;
};
const gap = fixture("gap", [
  message("before", null),
  '{"id":"middle",broken}',
  message("after", "middle"),
  custom("state", "after"),
]);
// Verify the actual pinned native SDK's gap behavior before installing the adapter.
const native = SessionManager.open(gap);
const nativeBranch = native.getBranch();
const nativeProjection = native.buildSessionProjection();
const nativeContext = native.buildContextEntries();
assert.deepEqual(
  nativeBranch.map((row) => row.id),
  ["after", "state"],
);
installDiskBackedSessionManager();

function check(file: string, newest: string[], contextId: string | null) {
  const original = readFileSync(file);
  const manager = SessionManager.open(file);
  try {
    const oldest = [...newest].reverse();
    assert.deepEqual(
      manager.getBranch().map((row) => row.id),
      oldest,
    );
    assert.deepEqual(
      getDiskBackedBranch(manager)!.map((row) => row.id),
      oldest,
    );
    if (newest.length > 1) {
      assert.throws(() => getDiskBackedBranch(manager, undefined, 1), /1-entry limit/);
    }
    const seen: string[] = [];
    assert.equal(
      visitDiskBackedBranch(manager, (meta) => {
        seen.push(meta.id);
      }),
      true,
    );
    assert.deepEqual(seen, newest);
    const stopped: string[] = [];
    visitDiskBackedBranch(manager, (meta) => {
      stopped.push(meta.id);
      return false;
    });
    assert.deepEqual(stopped, newest.slice(0, 1));
    assert.deepEqual(
      selectDiskBackedBranchEntries(manager, () => true)!.map((row) => row.id),
      oldest,
    );
    assert.deepEqual(
      selectDiskBackedEntries(manager, "context", () => true)!.map((row) => row.id),
      oldest,
    );
    const candidates: string[] = [];
    assert.equal(
      getLatestDiskBackedCustomEntry(manager, "state", (entry) => {
        candidates.push(entry.id);
        return false;
      }),
      null,
    );
    assert.deepEqual(
      candidates,
      newest.filter((id) => manager.getEntry(id)!.type === "custom"),
    );
    assert.equal(getLatestDiskBackedCustomEntry(manager, "absent"), null);
    assert.equal(getDiskBackedContextLeafId(manager), contextId);
    assert.equal(getDiskBackedShakeLeafId(manager), null);
    const revisions: string[] = [];
    assert.ok(
      getDiskBackedBranchRevision(manager, (meta) => {
        revisions.push(meta.id);
        return false;
      }),
    );
    assert.deepEqual(revisions, newest);
    assert.equal(manager.getModelContextBranch().filter((row) => row.type === "message").length, contextId ? 1 : 0);
    assert.equal(manager.getContextPreviewBranch().filter((row) => row.type === "message").length, contextId ? 1 : 0);
    assert.equal(manager.buildSessionProjection().messages.length, contextId ? 1 : 0);
    assert.deepEqual(readFileSync(file), original, "walks never repair or rewrite original bytes");
    return manager.buildSessionProjection();
  } finally {
    disposeDiskBackedSessionManager(manager);
  }
}
const projected = check(gap, ["state", "after"], "after");
const gapManager = SessionManager.open(gap);
assert.deepEqual(gapManager.getBranch(), nativeBranch);
assert.deepEqual(
  gapManager.buildContextEntries(),
  nativeContext.filter((row) => row.type !== "custom"),
);
assert.deepEqual(projected.messages, nativeProjection.messages);
assert.equal(projected.thinkingLevel, nativeProjection.thinkingLevel);
assert.deepEqual(projected.model, nativeProjection.model);
disposeDiskBackedSessionManager(gapManager);

// Extra indexed off-branch rows make an entry-count-only bound deliver repeats.
const unrelated = Array.from({ length: 64 }, (_, i) => custom("off" + i, null));
check(fixture("self", [...unrelated, custom("self", "self")]), ["self"], null);
check(
  fixture("cycle", [...unrelated, message("a", "b"), custom("b", "a"), custom("tail", "a")]),
  ["tail", "a", "b"],
  "a",
);
// A forward link is not necessarily cyclic.
check(
  fixture("forward", [custom("older", "newer"), message("newer", null), custom("tip", "older")]),
  ["tip", "older", "newer"],
  "newer",
);
console.log("truncated and cyclic walks preserve originals");
