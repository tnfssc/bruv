import { statSync } from "node:fs";
import { dirname } from "node:path";
import { type ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { bindNativeTasks, TASK_BINDING_ENTRY } from "../../src/claude-compat/task-binding";
import type { RootTaskSession } from "../../src/claude-compat/task-projection";
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
disposeDiskBackedSessionManager(session);
sample("complete", 3, "complete");
if (frames === 0) throw new Error("Replay did not exercise task binding");
