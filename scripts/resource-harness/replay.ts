import { requireValue } from "../lib/require-value";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { type ExtensionContext, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { parseConnectorArguments } from "../../src/claude-compat/arguments";
import { nativeStorage } from "../../src/claude-compat/binding";
import { bindNativeTasks, TASK_BINDING_ENTRY } from "../../src/claude-compat/task-binding";
import type { RootTaskSession } from "../../src/claude-compat/task-projection";
import { T3_MCP_BEARER_ENV, T3_MCP_URL_ENV } from "../../src/delegation-environment";
import { DiskEntryStore } from "../../src/history/disk-entry-store";
import { disposeDiskBackedSessionManager, getDiskBackedEntryMetadata } from "../../src/history/session-manager";
import { TaskManager } from "../../src/tasks/task-manager";

// This process only sees the snapshot path, never the original journal path.
const snapshot = process.argv[2];
if (!snapshot) throw new Error("Usage: bun replay.ts snapshot.jsonl");
const started = performance.now();
let entries = 0;
function sample(type: "sample" | "complete", step: number, stage: string) {
  const memory = process.memoryUsage();
  console.log(
    JSON.stringify({
      type,
      phase: "replay",
      step,
      stage,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      journalBytes: statSync(snapshot).size,
      journalEntries: entries,
      elapsedMs: performance.now() - started,
    }),
  );
}

sample("sample", 0, "before-open");
// Follow productionRuntime's ordering: nativeStorage must install the disk reader
// itself, before its first SessionManager.open. Do not preinstall it in this probe.
const home = join(dirname(snapshot), "replay-home");
const directory = join(home, "native-sessions");
const configDir = join(home, "native-history");
const nativeSessionId = randomUUID();
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(
  join(directory, `${nativeSessionId}.json`),
  JSON.stringify({
    file: snapshot,
    cwd: dirname(snapshot),
    configDir,
  }),
  { mode: 0o600 },
);
const storage = await nativeStorage(
  parseConnectorArguments([
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--resume",
    nativeSessionId,
  ]),
  { cwd: dirname(snapshot), agentDir: home, configDir },
);
const session = storage.manager;
entries = session.getEntryCount();
sample("sample", 1, "connector-storage-restored");
const metadata = getDiskBackedEntryMetadata(session);
const firstCursor = metadata?.find((entry) => entry.type === "custom" && entry.customType === TASK_BINDING_ENTRY);
const saved = firstCursor ? session.getEntry(firstCursor.id) : undefined;
const root = saved?.type === "custom" ? (saved.data as { root?: RootTaskSession }).root : undefined;
if (!root?.sourceSessionId || !root.namespace || !root.sessionId)
  throw new Error("Snapshot has no native task binding cursor");
const tasks = new TaskManager(() => {}, 15);
let frames = 0;
const binding = bindNativeTasks(
  {
    manager: tasks,
    context: { sessionManager: session, cwd: dirname(snapshot) } as unknown as ExtensionContext,
    sourceSessionId: root.sourceSessionId,
    appendEntry: (type, data) => session.appendCustomEntry(type, data),
  },
  {
    root,
    emit: () => {
      frames++;
    },
  },
);
await binding.flush();
sample("sample", 2, "task-binding-restored");
const materialize = DiskEntryStore.prototype.materialize;
DiskEntryStore.prototype.materialize = function (value, ...rest) {
  const meta = typeof value === "string" ? this.byId.get(value) : value;
  if (meta?.customType === TASK_BINDING_ENTRY)
    throw new Error("Native startup must not read old task checkpoint bodies after task binding restore");
  return materialize.call(this, value, ...rest);
};
await binding.close();
await tasks.shutdown();
if (frames === 0) throw new Error("Replay did not exercise task binding");

// Exercise the real native composition, including every installed session_start
// handler and SDK model-context preparation. No provider call is allowed.
// A fresh private home isolates setup writes from the user's runtime. The old
// owner-bound task cursors were restored above using their original root key.
delete process.env[T3_MCP_URL_ENV];
delete process.env[T3_MCP_BEARER_ENV];
delete process.env.BRUV_WEB_TASK_EVENTS;
const models = await ModelRuntime.create({
  authPath: join(home, "auth.json"),
  modelsPath: null,
  refreshOnCreate: false,
  allowModelNetwork: false,
});
const model = requireValue(getModel("anthropic", "claude-sonnet-4-5"));
models.getAvailable = async () => [model];
models.hasConfiguredAuth = () => true;
models.stream = models.streamSimple = (() => {
  throw new Error("Replay must never call a provider");
}) as typeof models.stream;
sample("sample", 3, "offline-model-setup");
const { createClaudeCompatRuntime } = await import("../../src/claude-compat/runtime");
sample("sample", 4, "runtime-imported");
const errors: unknown[] = [];
const runtime = await createClaudeCompatRuntime({
  cwd: dirname(snapshot),
  agentDir: home,
  sessionManager: session,
  nativeSessionId: storage.sessionId,
  history: storage.history,
  historyParentUuid: storage.parentUuid,
  model: `${model.provider}/${model.id}`,
  modelRuntime: models,
  settingsManager: SettingsManager.inMemory(
    { compaction: { enabled: false }, cacheWarming: "off" },
    { projectTrusted: false },
  ),
  profilesPath: join(home, "profiles.json"),
  emit: () => {},
  request: async () => {
    throw new Error("Replay must not request human input");
  },
  diagnostic: (error) => {
    errors.push(error);
  },
});
entries = session.getEntryCount();
sample("sample", 5, "native-startup-restored");
session.buildSessionProjection();
runtime.session.getContextUsage();
sample("sample", 6, "model-context-prepared");
await runtime.close();
if (errors.length) throw new AggregateError(errors, "Native startup emitted errors");
disposeDiskBackedSessionManager(session);
sample("complete", 7, "complete");
