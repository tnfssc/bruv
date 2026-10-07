/** Offline task-projection growth workload. Supervisor owns limits and cleanup. */

import { statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NativeHistory } from "../../src/claude-compat/history";
import { bindNativeTasks, type ChildEntrySource } from "../../src/claude-compat/task-binding";
import { type ChildBody, nativeTaskId } from "../../src/claude-compat/task-projection";
import {
  disposeDiskBackedSessionManager,
  getDiskBackedEntryMetadata,
  installDiskBackedSessionManager,
} from "../../src/history/session-manager";
import type { TaskEvent, TaskEventListener, TaskManager, TaskSummary } from "../../src/tasks/task-manager";
import type { TaskOwnerAttachment } from "../../src/tasks/task-owner";

interface Options {
  dir: string;
  tasks: number;
  updates: number;
  childEntries: number;
  childUpdates: number;
  phase: "write" | "resume";
}
interface Fixture {
  version: 1;
  counts: Pick<Options, "tasks" | "updates" | "childEntries" | "childUpdates">;
  root: { namespace: string; sourceSessionId: string; sessionId: string };
  tasks: TaskSummary[];
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  const names = ["--dir", "--tasks", "--updates", "--child-entries", "--child-updates", "--phase"];
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    if (!names.includes(name) || values.has(name) || value === undefined || value.startsWith("--"))
      throw new Error("Expected --dir DIR --tasks N --updates N --child-entries N --phase write|resume");
    values.set(name, value);
  }
  const count = (name: string, minimum: number) => {
    const text = values.get(name);
    const value = Number(text);
    if (!text || !/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < minimum)
      throw new Error(`${name} must be an integer >= ${minimum}`);
    return value;
  };
  const dir = values.get("--dir");
  const phase = values.get("--phase");
  if (!dir || (phase !== "write" && phase !== "resume")) throw new Error("Missing --dir or invalid --phase");
  const updates = count("--updates", 0);
  const childUpdates = values.has("--child-updates") ? count("--child-updates", 0) : updates;
  if (childUpdates > updates) throw new Error("--child-updates must not exceed --updates");
  return {
    dir: resolve(dir),
    phase,
    tasks: count("--tasks", 1),
    updates,
    childUpdates,
    childEntries: count("--child-entries", 0),
  };
}

// Only process evidence is synthetic. Journals, checkpoint cloning, branch loading,
// translation, replay deduplication and sidechain writes are production code paths.
class FakeJobs {
  private readonly listeners = new Set<TaskEventListener>();
  constructor(private readonly tasks: TaskSummary[]) {}
  list() {
    // Match TaskManager summaries: copy public state, not a deep clone of every static launch field.
    return this.tasks.map((task) => ({
      ...task,
      ...(task.launchIdentity ? { launchIdentity: { ...task.launchIdentity } } : {}),
      ...(task.agent ? { agent: { ...task.agent } } : {}),
    }));
  }
  subscribe(listener: TaskEventListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  update(task: TaskSummary) {
    const event: TaskEvent = { type: "updated", task: structuredClone(task) };
    for (const listener of this.listeners) listener(event);
  }
}

// Text-only subset of runtime.ts's native message translation, including usage.
function translateChildEntry({ entry }: ChildEntrySource): ChildBody[] {
  const message = entry.message;
  if (message.role === "user") return [{ type: "user", message: { role: "user", content: message.content } }];
  if (message.role !== "assistant") return [];
  return [
    {
      type: "assistant",
      message: {
        id: entry.id,
        type: "message",
        role: "assistant",
        model: `${message.provider}/${message.model}`,
        content: message.content,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: message.usage.input,
          output_tokens: message.usage.output,
          cache_read_input_tokens: message.usage.cacheRead,
          cache_creation_input_tokens: message.usage.cacheWrite,
        },
      },
    },
  ];
}

function sessionFile(manager: SessionManager): string {
  const file = manager.getSessionFile();
  if (!file) throw new Error("Workload requires a persistent session file");
  return file;
}

async function main(options: Options) {
  const started = performance.now();
  installDiskBackedSessionManager();
  const managers: SessionManager[] = [];
  let root: SessionManager | undefined;
  let binding: ReturnType<typeof bindNativeTasks> | undefined;
  let fixture: Fixture | undefined;
  const sample = (type: "sample" | "complete", step: number) => {
    const memory = process.memoryUsage();
    const metadata = root && getDiskBackedEntryMetadata(root);
    if (root && !metadata) throw new Error("Workload requires the disk-backed adapter");
    console.log(
      JSON.stringify({
        type,
        phase: options.phase,
        step,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        journalBytes: root ? statSync(sessionFile(root)).size : 0,
        journalEntries: metadata ? metadata.length + 1 : 0,
        elapsedMs: performance.now() - started,
      }),
    );
  };
  sample("sample", 0);
  try {
    const manifest = join(options.dir, "fixture.json");
    const children: { manager: SessionManager; task: TaskSummary }[] = [];
    if (options.phase === "write") {
      await mkdir(options.dir, { recursive: true });
      // Exclusive manifest is the ownership marker. Refuse reuse, never truncate.
      await writeFile(manifest, "", { flag: "wx", mode: 0o600 });
      root = SessionManager.create(options.dir, join(options.dir, "pi-root"));
      managers.push(root);
      root.appendMessage({ role: "user", content: "Offline resource harness: launch fixture tasks", timestamp: 0 });
      fixture = {
        version: 1,
        counts: {
          tasks: options.tasks,
          updates: options.updates,
          childEntries: options.childEntries,
          childUpdates: options.childUpdates,
        },
        root: {
          namespace: "bruv:resource-harness",
          sourceSessionId: sessionFile(root),
          sessionId: root.getSessionId(),
        },
        tasks: [],
      };
      for (let index = 0; index < options.tasks; index++) {
        const child = SessionManager.create(options.dir, join(options.dir, "pi-children", String(index)), {
          parentSession: sessionFile(root),
        });
        managers.push(child);
        child.appendMessage({ role: "user", content: `Offline worker seed ${index}`, timestamp: 0 });
        const task: TaskSummary = {
          id: `fixture-task-${index}`,
          kind: "agent",
          command: "offline-fixture",
          cwd: options.dir,
          pid: index + 1,
          status: "running",
          background: true,
          startedAt: new Date(0).toISOString(),
          baseOffset: 0,
          outputEnd: 0,
          timedOut: false,
          launchIdentity: {
            sourceSessionId: sessionFile(root),
            sourceCallId: `fixture-execute-${index}`,
            callIndex: 1,
            prompt: `Offline worker ${index}`,
            profile: "fast",
          },
          agent: {
            type: "fast",
            model: "offline/fixture",
            depth: 1,
            sessionFile: sessionFile(child),
            parentSessionFile: sessionFile(root),
            phase: "running",
            events: 0,
          },
        };
        fixture.tasks.push(task);
        children.push({ manager: child, task });
      }
      await writeFile(manifest, `${JSON.stringify(fixture, null, 2)}\n`);
    } else {
      fixture = JSON.parse(await readFile(manifest, "utf8")) as Fixture;
      if (
        fixture.version !== 1 ||
        fixture.counts.tasks !== options.tasks ||
        fixture.counts.updates !== options.updates ||
        fixture.counts.childEntries !== options.childEntries ||
        (fixture.counts.childUpdates ?? fixture.counts.updates) !== options.childUpdates
      )
        throw new Error("Resume counts must match the written fixture");
      root = SessionManager.open(fixture.root.sourceSessionId);
      managers.push(root);
    }
    sample("sample", 1);
    const native = await NativeHistory.open({
      configDir: join(options.dir, "native"),
      cwd: options.dir,
      sourceSessionId: fixture.root.sourceSessionId,
      sessionId: fixture.root.sessionId,
    });
    if (options.phase === "write") {
      const seed = root.getLeafEntry();
      if (!seed) throw new Error("Missing root launch message");
      await native.append({
        sourceMessageId: seed.id,
        type: "user",
        message: { role: "user", content: "Offline resource harness: launch fixture tasks" },
        timestamp: seed.timestamp,
      });
    }
    const jobs = new FakeJobs(fixture.tasks);
    const activeRoot = root;
    const owner: TaskOwnerAttachment = {
      manager: jobs as unknown as TaskManager,
      context: { cwd: options.dir, sessionManager: root } as unknown as TaskOwnerAttachment["context"],
      sourceSessionId: fixture.root.sourceSessionId,
      appendEntry: (type, data) => {
        activeRoot.appendCustomEntry(type, data);
      },
    };
    binding = bindNativeTasks(owner, {
      root: fixture.root,
      emit: () => {}, // Do not retain wire frames: no artificial transport backlog.
      translateChildEntry,
      writeChildFrame: async ({ link, entry }, frame) => {
        if (frame.type === "stream_event") return;
        // Match runtime.ts: ask the real history owner for each derived child write.
        const writer = await native.child({
          taskId: nativeTaskId(link),
          sourceSessionId: link.child.sourceSessionId,
          sourceCallId: link.launchToolUseId,
        });
        const written = await writer.appendWithResult({
          sourceMessageId: entry.id,
          type: frame.type,
          message: frame.message,
          timestamp: entry.timestamp,
          uuid: frame.uuid,
        });
        return written.appended;
      },
      diagnostic: (message) => {
        throw new Error(message);
      },
    });
    await binding.flush();
    sample("sample", 2);
    if (options.phase === "write") {
      const batch = Math.max(1, Math.ceil(options.updates / 20));
      for (let update = 1; update <= options.updates; update++) {
        for (const [index, { manager: child, task }] of children.entries()) {
          for (let entry = 0; entry < (update <= options.childUpdates ? options.childEntries : 0); entry++) {
            const timestamp = (update - 1) * options.childEntries + entry + 1;
            const text = `worker=${index} update=${update} entry=${entry} ${"x".repeat(128)}`;
            if (entry % 2 === 0) child.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp });
            else
              child.appendMessage({
                role: "assistant",
                content: [{ type: "text", text }],
                timestamp,
                api: "anthropic-messages",
                provider: "offline",
                model: "fixture",
                stopReason: "stop",
                usage: {
                  input: 2,
                  output: 3,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 5,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              });
          }
          jobs.update(task);
        }
        // A checkpoint per observed update, rather than a synthetic append loop.
        await binding.flush();
        if (update % batch === 0 || update === options.updates) sample("sample", update + 2);
      }
    }
    await binding.close();
    binding = undefined;
    sample("complete", options.phase === "write" ? options.updates + 2 : 2);
  } finally {
    try {
      await binding?.close();
    } finally {
      for (const manager of managers) disposeDiskBackedSessionManager(manager);
    }
  }
}

if (import.meta.main) {
  try {
    await main(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
