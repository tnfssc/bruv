import { strict as assert } from "node:assert";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { DiskEntryStore } from "../../src/history/disk-entry-store.ts";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "../../src/history/session-manager.ts";
import { prepareAgentSession } from "../../src/tasks/agent-session.ts";

installDiskBackedSessionManager();
const root = process.env.HISTORY_ROOT;
assert.ok(root);
const info = { type: "fast", model: "p/model", depth: 1, parentSessionFile: "/parent.jsonl" };
const pending = () => readdirSync(root, { recursive: true }).filter((path) => String(path).includes(".pending-"));
const assertNoPendingJournals = () => assert.deepEqual(pending(), []);

async function prepareSourceSession() {
  const prepared = await prepareAgentSession(root, root, info);
  assertNoPendingJournals();
  const saved = SessionManager.open(prepared.agent.sessionFile);
  assert.equal(saved.getHeader().parentSession, info.parentSessionFile);
  assert.equal(saved.getEntries().length, 2);
  disposeDiskBackedSessionManager(saved);
  assertNoPendingJournals();
  return prepared.agent.sessionFile;
}

async function checkPreparationReopenFailure() {
  const originalOpen = SessionManager.open;
  SessionManager.open = () => {
    throw new Error("injected prepare reopen");
  };
  try {
    await assert.rejects(prepareAgentSession(root, root, info), /injected prepare reopen/);
  } finally {
    SessionManager.open = originalOpen;
  }
  assertNoPendingJournals();
}

async function checkPreparationCollision() {
  const originalCreate = SessionManager.create;
  let collision;
  SessionManager.create = (...args) => {
    const manager = originalCreate(...args);
    collision = manager.getSessionFile();
    writeFileSync(collision, "sentinel");
    return manager;
  };
  try {
    await assert.rejects(prepareAgentSession(root, root, info), /EEXIST/);
  } finally {
    SessionManager.create = originalCreate;
  }
  assert.equal(readFileSync(collision, "utf8"), "sentinel");
  assertNoPendingJournals();
}

function checkPublicationFactoryFailures(sourceFile) {
  const empty = join(root, "empty.jsonl");
  writeFileSync(empty, "");
  const published = DiskEntryStore.published;
  DiskEntryStore.published = () => {
    throw new Error("injected publication");
  };
  try {
    assert.throws(() => SessionManager.open(empty), /injected publication/);
    assertNoPendingJournals();
    assert.throws(() => SessionManager.forkFrom(sourceFile, root, root), /injected publication/);
    assertNoPendingJournals();
  } finally {
    DiskEntryStore.published = published;
  }
  assert.equal(readFileSync(empty, "utf8"), "");
}

function checkPendingReplacementFailure() {
  const makePending = DiskEntryStore.pending;
  let pendingCalls = 0;
  DiskEntryStore.pending = (...args) => {
    if (++pendingCalls === 2) throw new Error("injected replacement pending");
    return makePending(...args);
  };
  try {
    assert.throws(() => SessionManager.open(join(root, "missing.jsonl")), /injected replacement pending/);
  } finally {
    DiskEntryStore.pending = makePending;
  }
  assertNoPendingJournals();
}

function checkForkCopyFailure(sourceFile) {
  const append = DiskEntryStore.prototype.append;
  DiskEntryStore.prototype.append = () => {
    throw new Error("injected fork copy");
  };
  try {
    assert.throws(() => SessionManager.forkFrom(sourceFile, root, root), /injected fork copy/);
  } finally {
    DiskEntryStore.prototype.append = append;
  }
  assertNoPendingJournals();
}

function checkRecentLoadFailure() {
  const dir = join(root, "recent");
  mkdirSync(dir);
  const candidate = join(dir, "candidate.jsonl");
  writeFileSync(
    candidate,
    `${JSON.stringify({ type: "session", version: 3, id: "recent", timestamp: "x", cwd: root })}\n`,
  );
  const open = DiskEntryStore.open;
  DiskEntryStore.open = () => {
    throw new Error("injected selected load");
  };
  try {
    assert.throws(() => SessionManager.continueRecent(root, dir), /injected selected load/);
  } finally {
    DiskEntryStore.open = open;
  }
  assertNoPendingJournals();
}

function checkForkCollision(sourceFile) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-01-01T00:00:00.000Z"]));
    }
  };
  try {
    const manager = SessionManager.create(root, root, { id: "collision-target" });
    manager._rewriteFile();
    const path = manager.getSessionFile();
    const before = readFileSync(path, "utf8");
    assert.throws(() => SessionManager.forkFrom(sourceFile, root, root, { id: "collision-target" }), /EEXIST/);
    assert.equal(readFileSync(path, "utf8"), before);
    assertNoPendingJournals();
  } finally {
    globalThis.Date = RealDate;
  }
}

function checkFreshManagerDisposal() {
  const fresh = SessionManager.create(root, root);
  fresh.appendThinkingLevelChange("off");
  assert.equal(pending().length, 1);
  assert.equal(fresh.getEntries()[0].type, "thinking_level_change");
  disposeDiskBackedSessionManager(fresh);
  assertNoPendingJournals();
}

// Each fault is restored before the next factory runs in this patched SDK process.
const sourceFile = await prepareSourceSession();
await checkPreparationReopenFailure();
await checkPreparationCollision();
checkPublicationFactoryFailures(sourceFile);
checkPendingReplacementFailure();
checkForkCopyFailure(sourceFile);
checkRecentLoadFailure();
checkForkCollision(sourceFile);
checkFreshManagerDisposal();
console.log("ok");
