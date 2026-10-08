import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdirSync, utimesSync, symlinkSync, lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { installDiskBackedSessionManager } from "../../src/history/session-manager.ts";
installDiskBackedSessionManager();

function verifyRewriteAndFailedReset(root, dir) {
  const manager = SessionManager.create(root, dir);
  const first = manager.appendMessage({ role: "user", content: "keep exact original", timestamp: 1 });
  manager.appendCustomEntry("private-state", { secret: "original custom body" });
  const bookmark = manager.appendLabelChange(first, "bookmark");
  assert.equal(manager.getLabel(first), "bookmark");
  assert.equal(manager.getTree()[0].labelTimestamp, manager.getEntry(bookmark).timestamp);
  manager.appendLabelChange(first, undefined);
  assert.equal(manager.getLabel(first), undefined);
  assert.equal(manager.getTree()[0].labelTimestamp, undefined);
  assert.equal(SessionManager.open(manager.getSessionFile()).getLabel(first), undefined);
  manager.appendLabelChange(first, "bookmark");
  const before = manager.getEntries();
  manager.branch(first);
  manager._rewriteFile();
  assert.deepEqual(manager.getEntries(), before);
  assert.equal(manager.getLeafId(), first);
  assert.equal(manager.getLabel(first), "bookmark");
  const file = manager.getSessionFile();
  assert.deepEqual(SessionManager.open(pathToFileURL(file).href).getEntries(), before);
  assert.deepEqual(manager.getLeafEntry(), manager.getEntry(first));
  const alias = join(root, "alias.jsonl");
  symlinkSync(file, alias);
  const aliasManager = SessionManager.open(alias);
  aliasManager._rewriteFile();
  assert.ok(lstatSync(alias).isSymbolicLink());
  assert.deepEqual(SessionManager.open(file).getEntries(), before);
  const previousDir = manager.sessionDir;
  manager.sessionDir = join(root, "not-a-directory");
  writeFileSync(manager.sessionDir, "blocked");
  assert.throws(() => manager.newSession());
  manager.sessionDir = previousDir;
  assert.equal(manager.getSessionFile(), file);
  assert.equal(manager.getLeafId(), first);
  assert.deepEqual(manager.getEntries(), before);
  assert.equal(manager.getLabel(first), "bookmark");
  assert.equal(manager.getTree()[0].labelTimestamp, before.at(-1).timestamp);
  return file;
}

function verifyAppendPublicationRetry(root, dir) {
  const blocked = SessionManager.create(root, dir);
  blocked.appendThinkingLevelChange("off");
  writeFileSync(blocked.getSessionFile(), "occupied");
  assert.throws(() => blocked.appendMessage({ role: "user", content: "failed", timestamp: 2 }));
  const written = blocked.getEntries().at(-1);
  assert.equal(written.type, "thinking_level_change");
  assert.equal(blocked.getEntries().length, 1);
  assert.equal(blocked.getLeafId(), written.id);
  unlinkSync(blocked.getSessionFile());
  const retry = blocked.appendMessage({ role: "user", content: "recovered", timestamp: 3 });
  assert.equal(blocked.getEntry(retry).parentId, written.id);
  assert.equal(SessionManager.open(blocked.getSessionFile()).getEntries().length, 2);
}

function verifyExclusiveFork(file, root, dir) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-01-01T00:00:00.000Z"]));
    }
  };
  try {
    const collision = SessionManager.create(root, dir, { id: "collision-target" });
    collision.appendMessage({ role: "user", content: "must not be overwritten", timestamp: 1 });
    collision._rewriteFile();
    const contents = readFileSync(collision.getSessionFile(), "utf8");
    assert.throws(() => SessionManager.forkFrom(file, root, dir, { id: "collision-target" }));
    assert.equal(readFileSync(collision.getSessionFile(), "utf8"), contents);
  } finally {
    globalThis.Date = RealDate;
  }
}

function verifyTreeReplay(root, dir) {
  const header = { type: "session", version: 3, id: "tree", timestamp: "x", cwd: root };
  const msg = (id, parentId, timestamp) => ({
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content: id, timestamp: 1 },
  });
  const treePath = join(dir, "tree.jsonl");
  writeFileSync(
    treePath,
    [
      header,
      msg("root", null, "2026-01-01"),
      msg("late", "root", "2026-01-03"),
      msg("early", "root", "2026-01-02"),
      msg("self", "self", "2026-01-04"),
    ]
      .map(JSON.stringify)
      .join("\n"),
  );
  const treeManager = SessionManager.open(treePath);
  assert.ok(readFileSync(treePath, "utf8").endsWith("\n"));
  const tree = treeManager.getTree();
  assert.deepEqual(
    tree.map((n) => n.entry.id),
    ["root", "self"],
  );
  assert.deepEqual(
    tree[0].children.map((n) => n.entry.id),
    ["early", "late"],
  );
}

function verifyValidationAndMigration(root, dir) {
  const header = { type: "session", version: 3, id: "tree", timestamp: "x", cwd: root };
  const msg = (id, parentId, timestamp) => ({
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content: id, timestamp: 1 },
  });
  const badPath = join(dir, "invalid.jsonl");
  const bad = [msg("bad", null, "x"), { ...header, version: 1 }].map(JSON.stringify).join("\n");
  writeFileSync(badPath, bad);
  assert.throws(() => SessionManager.open(badPath), /header|valid/i);
  assert.equal(readFileSync(badPath, "utf8"), bad);
  const oldPath = join(dir, "legacy.jsonl");
  const legacy =
    [
      { ...header, id: "legacy", version: 1 },
      { type: "message", timestamp: "x", message: { role: "user", content: "legacy exact", timestamp: 1 } },
      { type: "compaction", timestamp: "x", summary: "legacy summary", tokensBefore: 99, firstKeptEntryIndex: 1 },
    ]
      .map(JSON.stringify)
      .join("\n") + "\n";
  writeFileSync(oldPath, legacy);
  const old = SessionManager.open(oldPath);
  assert.equal(old.getHeader().version, 3);
  assert.equal(old.getEntries()[0].message.content, "legacy exact");
  assert.equal(old.getEntries()[1].firstKeptEntryId, old.getEntries()[0].id);
}

function verifyDiscoveryIsolation(root, dir) {
  const header = { type: "session", version: 3, id: "tree", timestamp: "x", cwd: root };
  const foreignPath = join(dir, "foreign.jsonl");
  const foreign = JSON.stringify({ ...header, id: "foreign", cwd: join(root, "elsewhere"), version: 1 }) + "\n";
  writeFileSync(foreignPath, foreign);
  utimesSync(foreignPath, new Date("2099-01-01"), new Date("2099-01-01"));
  SessionManager.continueRecent(root, dir);
  assert.equal(readFileSync(foreignPath, "utf8"), foreign);
}

const root = process.env.PROBE_ROOT;
const dir = join(root, "sessions");
mkdirSync(dir);
const file = verifyRewriteAndFailedReset(root, dir);
verifyAppendPublicationRetry(root, dir);
verifyExclusiveFork(file, root, dir);
verifyTreeReplay(root, dir);
verifyValidationAndMigration(root, dir);
verifyDiscoveryIsolation(root, dir);
console.log("ok");
