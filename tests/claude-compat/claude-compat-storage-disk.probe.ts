import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  SessionManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { parseConnectorArguments } from "../../src/claude-compat/arguments";
import { nativeStorage } from "../../src/claude-compat/binding";
import { DiskEntryStore } from "../../src/history/disk-entry-store";
import { disposeDiskBackedSessionManager, getDiskBackedEntryMetadata } from "../../src/history/session-manager";

import { QuestionService } from "../../src/questions/service";
import { renderDetailedFooter } from "../../src/ui/footer";

const root = process.env.PROBE_ROOT!;
const agentDir = join(root, "agent");
const configDir = join(root, "sdk");
const directory = join(agentDir, "native-sessions");
mkdirSync(directory, { recursive: true });
const sessionId = randomUUID();
const file = join(directory, "source.jsonl");
const timestamp = new Date(0).toISOString();
const original =
  [
    { type: "session", version: 3, id: sessionId, cwd: root, timestamp },
    {
      type: "message",
      id: "user",
      parentId: null,
      timestamp,
      message: { role: "user", content: "saved work", timestamp: 0 },
    },
    {
      type: "custom",
      id: "cursor",
      parentId: "user",
      timestamp,
      customType: "bruv-native-task-projection",
      data: { opaque: "old snapshot".repeat(1000) },
    },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n") + "\n";
writeFileSync(file, original);
writeFileSync(join(directory, sessionId + ".json"), JSON.stringify({ file, cwd: root, configDir }));
// A fresh process has never called createClaudeCompatRuntime. Storage must not
// reach the SDK's eager opener, even once, before installing the disk adapter.
SessionManager.open = () => {
  throw new Error("nativeStorage reached the eager SDK opener before runtime initialization");
};
const materialize = DiskEntryStore.prototype.materialize;
DiskEntryStore.prototype.materialize = function (value, ...rest) {
  const meta = typeof value === "string" ? this.byId.get(value) : value;
  assert.notEqual(
    meta?.customType,
    "bruv-native-task-projection",
    "storage must not materialize task checkpoint bodies",
  );
  return materialize.call(this, value, ...rest);
};
const storage = await nativeStorage(
  parseConnectorArguments(["--input-format", "stream-json", "--output-format", "stream-json", "--resume", sessionId]),
  { cwd: root, agentDir, configDir },
);
try {
  assert.equal(storage.manager.getSessionFile(), file);
  assert.equal(getDiskBackedEntryMetadata(storage.manager)?.length, 2);
  assert.equal(storage.manager.buildSessionProjection().messages.length, 1);
  assert.equal(storage.history?.options.sourceSessionId, sessionId);
  storage.manager.getEntries = () => {
    throw new Error("cold startup must not load all originals");
  };
  storage.manager.getBranch = () => {
    throw new Error("cold startup must not load the original branch");
  };
  const context = { sessionManager: storage.manager, getContextUsage: () => null } as unknown as ExtensionContext;
  const data = {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map(),
    getAvailableProviderCount: () => 0,
    onBranchChange: () => () => {},
  } as ReadonlyFooterDataProvider;
  const theme = { fg: (_: string, value: string) => value } as Theme;
  assert.ok(renderDetailedFooter(context, data, theme, 80).length);
  const service = new QuestionService();
  assert.deepEqual(service.list(context), []);
  const question = await service.ask(context, { text: "Continue saved work?" });
  assert.equal(service.get(context, question.id).readOnly, false);
  await service.answer(context, { id: question.id, owner: question.owner, version: question.version, text: "yes" });
  assert.equal(service.get(context, question.id).status, "answered");
  assert.equal(readFileSync(file, "utf8"), original);
  console.log("connector storage installs disk history before its first resume open");
} finally {
  disposeDiskBackedSessionManager(storage.manager);
}
