import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { disposeDiskBackedSessionManager, installDiskBackedSessionManager } from "../../../src/history/session-manager";

installDiskBackedSessionManager();
const root = process.env.PROBE_ROOT;
assert(root, "scenario requires an owned PROBE_ROOT from the history fixture harness");
const dir = join(root, "sessions");
const managers: SessionManager[] = [];
function own(manager: SessionManager) {
  managers.push(manager);
  return manager;
}
const user = (content: string): UserMessage => ({ role: "user", content, timestamp: 1 });
const tool = (text: string): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: "call",
  toolName: "execute",
  content: [{ type: "text", text }],
  isError: false,
  timestamp: 2,
});
const texts = ['雪🙂\n\\"'.repeat(220000), "0123456789abcdef".repeat(524288)];

function toolText(manager: SessionManager, id: string) {
  const entry = manager.getEntry(id);
  assert.equal(entry?.type, "message");
  assert(entry?.type === "message" && entry.message.role === "toolResult");
  const part = entry.message.content[0];
  assert(part.type === "text");
  return part;
}

function assertOriginalsAndCacheIsolation(manager: SessionManager, ids: string[]) {
  for (let i = 0; i < ids.length; i++) {
    const part = toolText(manager, ids[i]!);
    assert.equal(part.text, texts[i]);
    part.text = "caller mutation";
    assert.equal(toolText(manager, ids[i]!).text, texts[i]);
  }
}

try {
  const manager = own(SessionManager.create(root, dir));
  const first = manager.appendMessage(user("first"));
  const ids = texts.map((text) => manager.appendMessage(tool(text)));
  const leaf = manager.appendMessage(user("last"));
  const file = manager.getSessionFile()!;
  assertOriginalsAndCacheIsolation(manager, ids);

  // Both entry points reload the saved leaf without truncating large records.
  const reopened = own(SessionManager.open(file, dir));
  assertOriginalsAndCacheIsolation(reopened, ids);
  assert.equal(reopened.getLeafId(), leaf);
  const resumed = own(SessionManager.continueRecent(root, dir));
  assertOriginalsAndCacheIsolation(resumed, ids);
  assert.equal(resumed.getLeafId(), leaf);

  // A saved branch and a separate fork retain the same original tool bodies.
  reopened.branch(ids[1]!);
  const branch = reopened.appendMessage(user("new branch"));
  assert.equal(reopened.getEntry(branch)?.parentId, ids[1]);
  const branchFile = reopened.createBranchedSession(branch)!;
  const branchManager = own(SessionManager.open(branchFile, dir));
  assertOriginalsAndCacheIsolation(branchManager, ids);
  const fork = own(SessionManager.forkFrom(file, join(root, "fork"), join(root, "fork-sessions")));
  assertOriginalsAndCacheIsolation(fork, ids);
  assert.equal(fork.getHeader()?.parentSession, file);

  // Check the source journal as well as manager reads: caller mutations never persist.
  const records = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.find((entry) => entry.id === ids[1]).message.content[0].text, texts[1]);
  assert.equal(records.find((entry) => entry.id === first).message.content, "first");
} finally {
  for (const manager of managers) disposeDiskBackedSessionManager(manager);
}
console.log("ok");
