import type { EntryMetadata } from "../history/disk-entry-store";
import { getDiskBackedBranch, visitDiskBackedBranch } from "../history/session-manager";
import { createHash } from "node:crypto";
import type { ExtensionFactory, SessionEntry } from "@earendil-works/pi-coding-agent";
import type tasksExtension from "../agent/extension";
import type { LocalTaskLaunchIdentity, TaskEvent, TaskInspection, TaskSummary } from "../tasks/task-manager";
import type { TaskOwnerAttachment, TaskOwnerBinding } from "../tasks/task-owner";
import { childJournalEntries } from "./task-child-journal";
import {
  type ChildBody,
  type ChildFrame,
  type NativeTaskFrame,
  nativeTaskMessageId,
  projectBackgroundRoster,
  projectChildFrame,
  projectLocalTask,
  type RootTaskSession,
  type TaskLink,
  type TaskProjectionCheckpoint,
  type TaskUsage,
} from "./task-projection";

export const TASK_BINDING_ENTRY = "bruv-native-task-projection";
export interface AgentCallFrame {
  type: "assistant" | "user";
  uuid: string;
  session_id: string;
  parent_tool_use_id: null;
  message: Record<string, unknown>;
  /** Actual semantic-launch evidence; this is not a second model/tool invocation. */
  bruv: LocalTaskLaunchIdentity & { jobId: string };
}
export interface ChildEntrySource {
  link: Extract<TaskLink, { kind: "worker" }>;
  entry: Extract<SessionEntry, { type: "message" }>;
}
export interface TaskBindingOptions {
  root: RootTaskSession;
  /** Ordered native transport writer. It must not start a model continuation. */
  emit(frame: NativeTaskFrame | AgentCallFrame): void | Promise<void>;
  /** Public message translation belongs to the existing wire owner. */
  translateChildEntry?(source: ChildEntrySource): ChildBody[] | Promise<ChildBody[]>;
  /** Write real SDK child history BEFORE exposing a frame; false suppresses an already-durable replay. */
  // biome-ignore lint/suspicious/noConfusingVoidType: A writer may return nothing; only false suppresses a durable replay.
  writeChildFrame?(source: ChildEntrySource, frame: ChildFrame): void | boolean | Promise<void | boolean>;
  diagnostic?(message: string): void;
}
interface Cursor {
  link: TaskLink;
  launch: LocalTaskLaunchIdentity;
  revision: number;
  checkpoint?: TaskProjectionCheckpoint;
  agentCall: boolean;
  agentResult: boolean;
  /** Legacy snapshots only; consumed once and never written again. */
  childEntries?: string[];
  childOffset?: number;
  /** Original legacy cursor retained until its child journal can be migrated. */
  legacyCursorId?: string;
  tokens: number;
  toolUses: number;
  measuredUsage: boolean;
}
interface SavedCursor {
  root: RootTaskSession;
  cursor: Cursor;
}
function sameRoot(a: RootTaskSession, b: RootTaskSession) {
  return a.namespace === b.namespace && a.sourceSessionId === b.sourceSessionId && a.sessionId === b.sessionId;
}
/** A derived tool ID for ONE actual subagent launch, not a renamed outer execute call. */
export function agentLaunchToolUseId(task: TaskSummary): string {
  const launch = task.launchIdentity;
  if (!launch?.sourceCallId) throw new Error("Worker launch has no causal execute identity");
  return (
    "agent_" +
    createHash("sha256")
      .update(JSON.stringify([launch.sourceSessionId, launch.sourceCallId, launch.callIndex, task.id]))
      .digest("hex")
      .slice(0, 32)
  );
}

/** The manager remains the ONLY authority. This stores translation cursors, not jobs. */
export function bindNativeTasks(
  owner: TaskOwnerAttachment,
  options: TaskBindingOptions,
): TaskOwnerBinding & {
  flush(): Promise<void>;
} {
  if (owner.sourceSessionId !== options.root.sourceSessionId)
    throw new Error("Task binding root is not its owning session");
  const cursors = new Map<string, Cursor>();
  const gaps = new Set<string>();
  let queue = Promise.resolve();
  let closed = false;
  let failure: unknown;
  let rosterKey = "";
  const gap = (key: string, message: string) => {
    if (!gaps.has(key)) {
      gaps.add(key);
      options.diagnostic?.(message);
    }
  };
  // Actual root Pi custom entries are the checkpoint authority. Loading a cursor
  // never recreates a process or inserts a job into the manager.
  const manager = owner.context.sessionManager;
  const rootKey = JSON.stringify([options.root.namespace, options.root.sourceSessionId, options.root.sessionId]);
  const latest = new Map<string, EntryMetadata>();
  let needsLegacyScan = false;
  const indexed = visitDiskBackedBranch(manager, (meta) => {
    if (meta.type === "custom" && meta.customType === TASK_BINDING_ENTRY) {
      // Supplied by the history owner while indexing both old and new originals.
      const key = meta.taskProjection;
      if (!key) needsLegacyScan = true;
      else if (key.rootKey === rootKey && !latest.has(key.jobId)) latest.set(key.jobId, meta);
    }
  });
  const restore = (entry: SessionEntry) => {
    if (entry.type !== "custom" || entry.customType !== TASK_BINDING_ENTRY) return;
    const saved = entry.data as SavedCursor;
    if (saved?.root && sameRoot(saved.root, options.root) && saved.cursor?.link?.jobId) {
      const cursor = structuredClone(saved.cursor);
      if (cursor.childEntries) cursor.legacyCursorId = entry.id;
      else if (cursor.legacyCursorId) {
        const original = manager.getEntry(cursor.legacyCursorId);
        if (original?.type !== "custom" || original.customType !== TASK_BINDING_ENTRY)
          throw new Error("Legacy task cursor original is unavailable");
        cursor.childEntries = structuredClone((original.data as SavedCursor).cursor.childEntries);
      }
      cursors.set(cursor.link.jobId, cursor);
    }
  };
  if (indexed && !needsLegacyScan) {
    for (const meta of latest.values()) {
      const entry = manager.getEntry(meta.id);
      if (entry) restore(entry);
    }
  } else {
    // Native/in-memory managers keep their existing API. Disk managers without
    // keyed metadata stream one custom entry at a time, not the whole root.
    const branch = getDiskBackedBranch(manager);
    if (branch) {
      for (const meta of branch) {
        if (meta.type === "custom" && meta.customType === TASK_BINDING_ENTRY) {
          const entry = manager.getEntry(meta.id);
          if (entry) restore(entry);
        }
      }
    } else for (const entry of manager.getBranch()) restore(entry);
  }
  const dirty = new Set<Cursor>();
  const savedRevision = new Map([...cursors.values()].map((cursor) => [cursor, cursor.revision]));
  const enqueue = (run: () => Promise<void>) => {
    queue = queue
      .then(async () => {
        if (!failure) await run();
      })
      .catch((error) => {
        failure = error;
        options.diagnostic?.(`Native task binding delivery failed: ${String(error)}`);
      });
  };
  const save = (cursor: Cursor) => {
    const { childEntries: _legacy, ...checkpoint } = cursor;
    owner.appendEntry(TASK_BINDING_ENTRY, {
      root: options.root,
      cursor: structuredClone(checkpoint),
    } satisfies SavedCursor);
    dirty.delete(cursor);
    savedRevision.set(cursor, cursor.revision);
  };
  const link = (task: TaskSummary): TaskLink | undefined => {
    const launch = task.launchIdentity;
    if (!launch || launch.sourceSessionId !== owner.sourceSessionId) {
      gap(task.id, `Job ${task.id} has no owner-bound causal launch identity; not projected.`);
      return;
    }
    const base = {
      origin: "bruv" as const,
      root: options.root,
      jobId: task.id,
      sourceId: owner.sourceSessionId,
      parent: { sourceSessionId: owner.sourceSessionId, launchToolUseId: null },
    };
    if (task.kind === "command") return { ...base, kind: "shell", launchToolUseId: launch.sourceCallId };
    if (task.workspace?.preparationStatus === "preparing") return;
    if (
      !task.agent?.sessionFile ||
      task.agent.parentSessionFile !== owner.sourceSessionId ||
      !launch.prompt ||
      !launch.profile
    ) {
      gap(task.id, `Worker ${task.id} lacks actual child/parent journal or launch prompt/profile; not projected.`);
      return;
    }
    return {
      ...base,
      kind: "worker",
      launchToolUseId: agentLaunchToolUseId(task),
      child: { sourceSessionId: task.agent.sessionFile, parentSessionId: task.agent.parentSessionFile },
      prompt: launch.prompt,
      subagentType: launch.profile,
      spawnDepth: task.agent.depth,
    };
  };
  const replayChildJournal = async (task: TaskSummary, cursor: Cursor) => {
    const frames: ChildFrame[] = [];
    if (cursor.link.kind !== "worker") return frames;
    if (!options.writeChildFrame)
      gap("history", "No native child history writer bound; SDK child replay is unavailable.");
    const seen = new Set(cursor.childEntries);
    try {
      for await (const { entry, endOffset } of childJournalEntries(
        cursor.link.child.sourceSessionId,
        cursor.childOffset ?? 0,
      )) {
        if (entry?.type === "message" && !seen.has(entry.id)) {
          const source: ChildEntrySource = { link: cursor.link, entry };
          if (options.translateChildEntry) {
            const bodies = await options.translateChildEntry(source);
            for (const [index, body] of bodies.entries()) {
              const frame = projectChildFrame(cursor.link, {
                sourceSessionId: cursor.link.child.sourceSessionId,
                eventId: `${entry.id}:${index}`,
                body,
              });
              if (!frame) throw new Error("Native child frame has no causal binding");
              const written = await options.writeChildFrame?.(source, frame);
              if (written !== false) frames.push(frame);
            }
          } else gap("translator", "No child journal translator bound; exact child frames/history are unavailable.");
          const message = entry.message;
          if (message.role === "assistant") {
            const usage = message.usage;
            if (
              usage &&
              [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every((n) => Number.isFinite(n) && n >= 0)
            ) {
              cursor.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
              cursor.measuredUsage = true;
            }
            cursor.toolUses += message.content.filter((part) => part.type === "toolCall").length;
          }
          seen.add(entry.id);
        }
        cursor.childOffset = endOffset;
      }
      delete cursor.childEntries;
      delete cursor.legacyCursorId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      gap(`child:${task.id}`, `Child journal unavailable for ${task.id}; no child messages inferred from stdout.`);
    }
    return frames;
  };
  const usage = (task: TaskSummary, cursor: Cursor): TaskUsage | undefined =>
    cursor.measuredUsage
      ? {
          total_tokens: cursor.tokens,
          tool_uses: cursor.toolUses,
          duration_ms: Math.max(
            0,
            Date.parse(task.completedAt ?? new Date().toISOString()) - Date.parse(task.startedAt),
          ),
        }
      : undefined;
  const roster = async (eventId: string) => {
    // Complete opaque roster from ONLY this manager's actual current jobs.
    const entries = owner.manager.list().flatMap((task) => {
      const cursor = cursors.get(task.id);
      return cursor && task.status === "running" ? [{ link: cursor.link, checkpoint: cursor.checkpoint }] : [];
    });
    const frame = projectBackgroundRoster(options.root, eventId, entries);
    const key = JSON.stringify(frame.tasks);
    if (key !== rosterKey) {
      await options.emit(frame);
      rosterKey = key;
    }
  };
  const registerTaskCursor = (task: TaskSummary): Cursor | undefined => {
    const actualLink = link(task);
    if (!actualLink || !task.launchIdentity) return;
    let cursor = cursors.get(task.id);
    if (!cursor) {
      if (task.status === "running" && task.pid === undefined) {
        gap(`spawn:${task.id}`, `No confirmed process spawn for ${task.id}; no native launch announced.`);
        return;
      }
      if (task.status !== "running") {
        gap(`historical:${task.id}`, `Unregistered historical terminal job ${task.id}; no launch reconstructed.`);
        return;
      }
      cursor = {
        link: actualLink,
        launch: { ...task.launchIdentity },
        revision: 0,
        agentCall: false,
        agentResult: false,
        childOffset: 0,
        tokens: 0,
        toolUses: 0,
        measuredUsage: false,
      };
      cursors.set(task.id, cursor);
    }
    if (
      JSON.stringify(cursor.link) !== JSON.stringify(actualLink) ||
      JSON.stringify(cursor.launch) !== JSON.stringify(task.launchIdentity)
    )
      throw new Error("Job launch identity changed");
    return cursor;
  };

  const announceAgentCall = async (task: TaskSummary, cursor: Cursor) => {
    if (cursor.link.kind !== "worker" || cursor.agentCall) return;
    const workerLink = cursor.link;
    await options.emit({
      type: "assistant",
      bruv: { ...cursor.launch, jobId: task.id },
      session_id: options.root.sessionId,
      parent_tool_use_id: null,
      uuid: nativeTaskMessageId(cursor.link, "launch", "agent-call"),
      message: {
        id: nativeTaskMessageId(cursor.link, "launch", "agent-call"),
        type: "message",
        role: "assistant",
        stop_reason: "tool_use",
        stop_sequence: null,
        content: [
          {
            type: "tool_use",
            id: workerLink.launchToolUseId,
            name: "Agent",
            input: {
              prompt: workerLink.prompt,
              subagent_type: workerLink.subagentType,
              ...(task.title ? { description: task.title } : {}),
            },
          },
        ],
      },
    });
    cursor.agentCall = true;
  };

  const returnAgentResult = async (task: TaskSummary, cursor: Cursor, result?: TaskInspection) => {
    if (cursor.link.kind !== "worker" || cursor.agentResult || !(task.background || task.completedAt)) return;
    await options.emit({
      type: "user",
      bruv: { ...cursor.launch, jobId: task.id },
      session_id: options.root.sessionId,
      parent_tool_use_id: null,
      uuid: nativeTaskMessageId(cursor.link, "launch", "agent-result"),
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: cursor.link.launchToolUseId,
            // Native text tool results are not parsed as objects by the pinned adapter.
            content:
              (task.background && !task.completedAt ? "Async agent launched successfully.\n" : "") +
              JSON.stringify({
                id: task.id,
                status: task.status,
                background: !!task.background,
                ...(result ? { output: result.output, exitCode: result.exitCode } : {}),
              }),
            is_error: task.status === "failed",
          },
        ],
      },
    });
    cursor.agentResult = true;
  };

  const observe = async (event: TaskEvent) => {
    const task = event.task;
    const cursor = registerTaskCursor(task);
    if (!cursor) return;
    const semanticBefore = JSON.stringify([
      cursor.checkpoint?.phase,
      cursor.checkpoint?.isBackgrounded,
      cursor.agentCall,
      cursor.agentResult,
    ]);
    const eventId = `${task.id}:${++cursor.revision}:${event.type}`;
    await announceAgentCall(task, cursor);
    const childFrames = await replayChildJournal(task, cursor);
    const result = task.completedAt ? await owner.manager.wait(task.id) : undefined;
    const projection = projectLocalTask(
      cursor.link,
      task,
      {
        revision: cursor.revision,
        eventId,
        usage: usage(task, cursor),
        ...(result
          ? {
              result: {
                summary: result.output,
                outputFile: null,
                truncated: result.outputLost || result.hasMore || result.baseOffset > 0,
              },
            }
          : {}),
      },
      cursor.checkpoint,
    );
    // Expose child messages before terminal notification, but after task start/progress.
    for (const frame of projection.frames.filter(
      (frame) => !(frame.type === "system" && frame.subtype === "task_notification"),
    ))
      await options.emit(frame);
    for (const frame of childFrames) await options.emit(frame);
    for (const frame of projection.frames.filter(
      (frame) => frame.type === "system" && frame.subtype === "task_notification",
    ))
      await options.emit(frame);
    cursor.checkpoint = projection.checkpoint;
    await returnAgentResult(task, cursor, result);
    dirty.add(cursor);
    const semanticAfter = JSON.stringify([
      cursor.checkpoint?.phase,
      cursor.checkpoint?.isBackgrounded,
      cursor.agentCall,
      cursor.agentResult,
    ]);
    // Progress is replayable; launch/terminal/causal boundaries are durable now.
    if (semanticBefore !== semanticAfter || cursor.revision - (savedRevision.get(cursor) ?? cursor.revision) >= 64)
      save(cursor);
    await roster(eventId);
  };
  const unsubscribe = owner.manager.subscribe((event) => {
    if (!closed) enqueue(() => observe(event));
  });
  for (const task of owner.manager.list()) enqueue(() => observe({ type: "updated", task }));
  enqueue(() => roster("attach"));
  return {
    async flush() {
      await queue;
      if (failure) throw failure;
    },
    async close() {
      if (!closed) {
        closed = true;
        unsubscribe();
      }
      await queue;
      if (failure) throw failure;
      for (const cursor of dirty) save(cursor);
    },
  };
}

/** Replace the normal bruv-tools factory with this wrapper; NEVER install both. */
export function createTaskBindingExtension(
  options: Omit<TaskBindingOptions, "root"> & {
    root(owner: TaskOwnerAttachment): RootTaskSession;
    tasks?: Omit<NonNullable<Parameters<typeof tasksExtension>[1]>, "onTaskOwner">;
  },
): ExtensionFactory {
  return async (pi) => {
    const { default: tasks } = await import("../agent/extension");
    tasks(pi, {
      ...options.tasks,
      onTaskOwner: (owner) => bindNativeTasks(owner, { ...options, root: options.root(owner) }),
    });
  };
}
