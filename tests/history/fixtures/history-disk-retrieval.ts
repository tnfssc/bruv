import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "@earendil-works/pi-ai";
import { HistoryService } from "../../../src/history/service";
import { MANUAL_SHAKE_ENTRY, MANUAL_SHAKE_VERSION } from "../../../src/history/shake-record";
import { disposeDiskBackedSessionManager, installDiskBackedSessionManager } from "../../../src/history/session-manager";

installDiskBackedSessionManager();
const root = process.env.PROBE_ROOT;
assert(root, "scenario requires an owned PROBE_ROOT from the history fixture harness");
const manager = SessionManager.create(root, root);
const user = (content: string): UserMessage => ({ role: "user", content, timestamp: Date.now() });

try {
  // Keep one inactive branch and three non-public content kinds beside public evidence.
  const first = manager.appendMessage(user("original exact evidence needle"));
  manager.appendMessage(user("inactive-secret-needle"));
  manager.branch(first);
  const assistant = manager.appendMessage({
    role: "assistant",
    api: "openai-responses",
    provider: "test",
    model: "test",
    content: [
      { type: "thinking", thinking: "private-reasoning-needle" },
      { type: "toolCall", id: "call", name: "execute", arguments: { text: "private-payload-needle" } },
      { type: "text", text: "public-needle" },
    ],
    stopReason: "stop",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  });
  const tool = manager.appendMessage({
    role: "toolResult",
    toolCallId: "call",
    toolName: "execute",
    content: [{ type: "text", text: "result-needle" }],
    isError: false,
    timestamp: Date.now(),
  });
  manager.appendCustomMessageEntry("hidden", "hidden-custom-needle", false);
  const tail = manager.appendMessage(user("kept tail"));
  manager.appendCompaction("summary", tail, 10000);
  const path = manager.getSessionFile()!;
  manager.setSessionFile(path);
  manager.getBranch = () => {
    throw new Error("full body branch must not be requested by history");
  };
  const service = new HistoryService();
  const ctx = { sessionManager: manager };
  const search = (query: string, extra: Record<string, unknown> = {}) => service.search({ query, ...extra }, ctx);

  // Retrieval reads the original transcript, not just the compacted context,
  // but never exposes inactive branches, thinking, tool arguments or custom messages.
  const original = (await search("original exact")).matches[0]!;
  assert.equal((await service.read({ ref: original.ref }, ctx)).text, "original exact evidence needle");
  for (const hidden of [
    "inactive-secret-needle",
    "private-reasoning-needle",
    "private-payload-needle",
    "hidden-custom-needle",
  ]) {
    assert.equal((await search(hidden)).matches.length, 0);
  }
  const priorTool = (await search("result-needle")).matches[0]!;
  const page = await search("needle", { limit: 1 });

  // A live shake revokes fresh searches, already-issued refs and earlier cursor pages.
  manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, {
    version: MANUAL_SHAKE_VERSION,
    sessionId: manager.getSessionId(),
    assistantEntryIds: [assistant],
    toolResultEntryIds: [tool],
    shakenAt: Date.now(),
  });
  assert.equal((await search("result-needle")).matches.length, 0);
  await assert.rejects(service.read({ ref: priorTool.ref }, ctx), /excluded|unavailable/);
  if (page.nextCursor) {
    assert.ok(
      (await search("needle", { limit: 1, cursor: page.nextCursor })).matches.every(
        (match) => match.provenance.entryId !== tool,
      ),
    );
  }

  // Reload must retain exclusions without hiding the assistant's public text or original user ref.
  manager.setSessionFile(path);
  assert.equal((await search("result-needle")).matches.length, 0);
  assert.equal((await search("public-needle")).matches.length, 1);
  assert.equal((await service.read({ ref: original.ref }, ctx)).text, "original exact evidence needle");
} finally {
  disposeDiskBackedSessionManager(manager);
}
console.log("ok");
