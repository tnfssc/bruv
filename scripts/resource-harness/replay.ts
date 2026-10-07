import { statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { type ExtensionContext, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { bindNativeTasks, TASK_BINDING_ENTRY } from "../../src/claude-compat/task-binding";
import type { RootTaskSession } from "../../src/claude-compat/task-projection";
import { T3_MCP_BEARER_ENV, T3_MCP_URL_ENV } from "../../src/delegation-environment";
import {
  disposeDiskBackedSessionManager,
  getDiskBackedEntryMetadata,
  installDiskBackedSessionManager,
} from "../../src/history/session-manager";
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
installDiskBackedSessionManager();
const session = SessionManager.open(snapshot, dirname(snapshot));
entries = session.getEntryCount();
sample("sample", 1, "indexed");
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
const home = join(dirname(snapshot), "replay-home");
await mkdir(home, { mode: 0o700 });
const models = await ModelRuntime.create({
  authPath: join(home, "auth.json"),
  modelsPath: null,
  refreshOnCreate: false,
  allowModelNetwork: false,
});
const model = getModel("anthropic", "claude-sonnet-4-5")!;
models.getAvailable = async () => [model];
models.hasConfiguredAuth = () => true;
models.stream = models.streamSimple = (() => {
  throw new Error("Replay must never call a provider");
}) as typeof models.stream;
const { createClaudeCompatRuntime } = await import("../../src/claude-compat/runtime");
const errors: unknown[] = [];
const runtime = await createClaudeCompatRuntime({
  cwd: dirname(snapshot),
  agentDir: home,
  sessionManager: session,
  nativeSessionId: root.sessionId,
  model: model.provider + "/" + model.id,
  modelRuntime: models,
  settingsManager: SettingsManager.inMemory(
    { compaction: { enabled: false }, cacheWarming: "off" },
    { projectTrusted: false },
  ),
  profilesPath: join(home, "profiles.json"),
  emit: () => {},
  diagnostic: (error) => {
    errors.push(error);
  },
});
entries = session.getEntryCount();
sample("sample", 3, "native-startup-restored");
session.buildSessionProjection();
runtime.session.getContextUsage();
sample("sample", 4, "model-context-prepared");
await runtime.close();
if (errors.length) throw new AggregateError(errors, "Native startup emitted errors");
disposeDiskBackedSessionManager(session);
sample("complete", 5, "complete");
