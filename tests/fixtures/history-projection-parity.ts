import assert from "node:assert/strict";
import { SessionManager, type SessionProjection } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

// The native process must never install the disk adapter; each mode owns a process.
if (process.env.USE_DISK_HISTORY === "1") {
  const { installDiskBackedSessionManager } = await import("../../src/history/session-manager");
  installDiskBackedSessionManager();
}
const probeRoot = process.env.PROBE_ROOT;
assert(probeRoot, "scenario requires an owned PROBE_ROOT from the history fixture harness");
const root: string = probeRoot;
const simplifyMessage = (message: SessionProjection["messages"][number]) => ({
  role: message.role,
  // Summary and bash messages have no content; retain their role-only normalization.
  content: "content" in message ? message.content : undefined,
});
function simplify(projection: SessionProjection) {
  return {
    entries: projection.entries.map(({ sourceEntry, messages }) => ({
      type: sourceEntry.type,
      messages: messages.map(simplifyMessage),
    })),
    messages: projection.messages.map(simplifyMessage),
    thinkingLevel: projection.thinkingLevel,
    model: projection.model,
  };
}
function assistantMessage(timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "original assistant" }],
    api: "openai-responses",
    provider: "fixture",
    model: "fixture-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

function editedMessagesAndCheckpoint() {
  const manager = SessionManager.create(root, root);
  const system = manager.appendMessage({ role: "system", content: "system-v1", timestamp: 1 });
  const user = manager.appendMessage({ role: "user", content: "original user", timestamp: 2 });
  const assistant = manager.appendMessage(assistantMessage(3));
  manager.appendContextEdit(user, { content: "edited user" });
  manager.appendContextEdit(assistant, { content: "edited assistant" });
  const edited = simplify(manager.buildSessionProjection());

  const compact = manager.appendCompaction("compact summary", null, 123);
  manager.appendMessage({ role: "user", content: "after compact", timestamp: 4 });
  const compaction = manager.getEntry(compact)!;
  if (compaction.type !== "compaction") throw new Error("missing compaction checkpoint");
  return {
    edited,
    compacted: simplify(manager.buildSessionProjection()),
    context: manager.buildSessionContext().messages.map(simplifyMessage),
    compaction: { selfKept: compaction.firstKeptEntryId === compact, systemContent: compaction.systemMessage?.content },
    idsPresent: [system, user, assistant].every((id) => manager.getEntry(id)),
  };
}

function rejectsEdit(manager: SessionManager, target: string) {
  try {
    manager.appendContextEdit(target, null);
    return false;
  } catch {
    return true;
  }
}

function contextEditsAcrossBranches() {
  const manager = SessionManager.create(root, root);
  const base = manager.appendMessage({ role: "system", content: "base", timestamp: 10 });
  const keep = manager.appendMessage({ role: "user", content: "keep me", timestamp: 11 });
  const answer = manager.appendMessage(assistantMessage(12));
  const custom = manager.appendCustomMessageEntry("fixture", "custom original", true);
  const tool = manager.appendMessage({
    role: "toolResult",
    toolCallId: "t",
    toolName: "fixture",
    content: [{ type: "text", text: "tool original" }],
    isError: false,
    timestamp: 13,
  });
  manager.appendContextEdit(custom, { content: "custom replacement" });
  manager.appendContextEdit(tool, { content: "tool replacement" });
  const editLeaf = manager.appendContextEdit(answer, null);
  const replacements = simplify(manager.buildSessionProjection());

  // Reopening preserves projected replacements, not mutations of source bodies.
  const sessionFile = manager.getSessionFile();
  assert(sessionFile, "persisted branch-edit fixture requires a session file to reopen");
  const reopened = SessionManager.open(sessionFile);
  const reopenedProjection = simplify(reopened.buildSessionProjection());
  const customEntry = reopened.getEntry(custom);
  const toolEntry = reopened.getEntry(tool);
  const originalsIntact =
    customEntry?.type === "custom_message" &&
    customEntry.content === "custom original" &&
    toolEntry?.type === "message" &&
    toolEntry.message.role === "toolResult" &&
    toolEntry.message.content[0]?.type === "text" &&
    toolEntry.message.content[0].text === "tool original";
  const rejects = {
    systemMessage: rejectsEdit(manager, base),
    missingEntry: rejectsEdit(manager, "missing-id"),
  };

  // Returning to the pre-edit branch drops replacements and disallows the inactive edit.
  manager.branch(tool);
  const inactiveEditRejected = rejectsEdit(manager, editLeaf);
  const branchWithoutEdits = simplify(manager.buildSessionProjection());

  // The second checkpoint replaces the first while retaining later model/settings changes.
  const firstCompact = manager.appendCompaction("first checkpoint", keep, 50);
  manager.appendMessage({ role: "system", content: "delta", timestamp: 14 });
  manager.appendThinkingLevelChange("high");
  manager.appendModelChange("fixture", "updated-model");
  manager.appendCompaction("second checkpoint", firstCompact, 25);
  return {
    replacements,
    reopenedProjection,
    originalsIntact,
    rejects: { ...rejects, inactiveEdit: inactiveEditRejected },
    branchWithoutEdits,
    repeatedCompaction: simplify(manager.buildSessionProjection()),
  };
}

console.log(
  JSON.stringify({
    checkpoint: editedMessagesAndCheckpoint(),
    branchEdits: contextEditsAcrossBranches(),
  }),
);
