import { createHash, type UUID } from "node:crypto";

/** SDK 0.3.276 shapes, deliberately independent of the SDK runtime and job ownership. */
export interface RootTaskSession {
  /** Stable executor namespace (including remote owner/host, not just a display label). */
  namespace: string;
  /** Actual Bruv root session identity, e.g. its persisted session-file identity. */
  sourceSessionId: string;
  /** Real native CLI session_id allocated by the compatibility session owner. */
  sessionId: string;
}

interface LinkBase {
  root: RootTaskSession;
  jobId: string;
  /** Actual source authority identity; distinguishes local and remote job namespaces. */
  sourceId: string;
  /** Original real launch; remains the child-frame causal owner across resume. */
  launchToolUseId: string;
  /** Actual current resume call, if different from the original launch. */
  runToolUseId?: string;
  parent: { sourceSessionId: string; launchToolUseId: string | null };
}
export type TaskLink = LinkBase &
  (
    | {
        origin: "bruv";
        kind: "worker";
        child: { sourceSessionId: string; parentSessionId: string };
        prompt: string;
        subagentType?: string;
        spawnDepth?: number;
      }
    | { origin: "bruv"; kind: "shell" | "monitor" }
    | { origin: "app_owned"; kind: "app_task" }
  );

export interface TaskUsage {
  total_tokens: number;
  tool_uses: number;
  duration_ms: number;
}
interface Envelope {
  type: "system";
  uuid: UUID;
  session_id: string;
}
export interface TaskStarted extends Envelope {
  subtype: "task_started";
  task_id: string;
  tool_use_id: string;
  description: string;
  task_type: "local_agent" | "local_bash";
  is_backgrounded: boolean;
  prompt?: string;
  subagent_type?: string;
  spawn_depth?: number;
}
export interface TaskProgress extends Envelope {
  subtype: "task_progress";
  task_id: string;
  tool_use_id: string;
  description: string;
  usage: TaskUsage;
  last_tool_name?: string;
  summary?: string;
  subagent_type?: string;
}
export interface TaskNotification extends Envelope {
  subtype: "task_notification";
  task_id: string;
  tool_use_id: string;
  status: "completed" | "failed" | "stopped";
  output_file: string;
  summary: string;
  usage?: TaskUsage;
}
export interface BackgroundRoster extends Envelope {
  subtype: "background_tasks_changed";
  tasks: { task_id: string; task_type: "local_bash"; description: string; ambient?: boolean }[];
}
/** Already translated public child frame. Message/tool IDs inside the body belong to the wire translator. */
export type ChildBody =
  | { type: "assistant"; message: Record<string, unknown>; [key: string]: unknown }
  | { type: "user"; message: Record<string, unknown>; [key: string]: unknown }
  | { type: "stream_event"; event: Record<string, unknown>; [key: string]: unknown };
export type ChildFrame = ChildBody & { uuid: UUID; session_id: string; parent_tool_use_id: string };
export type NativeTaskFrame = TaskStarted | TaskProgress | TaskNotification | BackgroundRoster | ChildFrame;

/** Normalized authoritative observation, not a status guessed from log text or tool names. */
export interface TaskObservation {
  /** Persisted monotone revision from the source/link owner, across reconnect and resume. */
  revision: number;
  eventId: string;
  edge: "snapshot" | "started" | "resumed";
  status: "preparing" | "unknown" | "running" | "stopping" | "completed" | "failed" | "killed";
  description: string;
  isBackgrounded: boolean;
  progress?: { description: string; usage: TaskUsage; lastToolName?: string; summary?: string };
  /** Required for terminal projection. Stop requests alone are NOT confirmation. */
  terminal?: { confirmed: true; summary: string; outputFile: string | null; usage?: TaskUsage };
}
/** A tiny projection cursor; the engine stores it with the existing persisted job link, not a new ledger. */
export interface TaskProjectionCheckpoint {
  taskId: string;
  linkIdentity: string;
  revision: number;
  phase: "unstarted" | "active" | "terminal";
  runToolUseId: string;
  isBackgrounded: boolean;
  description: string;
}
export interface TaskProjection {
  frames: NativeTaskFrame[];
  checkpoint?: TaskProjectionCheckpoint;
  skipped?: "app-owned" | "stale" | "terminal" | "not-started" | "unconfirmed";
}

function identity(parts: readonly unknown[]): UUID {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  // RFC 9562 UUIDv8, stable and scoped to real identities (122 hash bits).
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    ((parseInt(hex[16], 16) & 3) | 8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-") as UUID;
}

export function nativeTaskId(link: TaskLink): string {
  return (
    // This is also the SDK child-history agentId; keep it a safe path segment.
    "bruv-" +
    identity(["task", link.root.namespace, link.root.sourceSessionId, link.root.sessionId, link.sourceId, link.jobId])
  );
}
export function nativeTaskMessageId(link: TaskLink, eventId: string, subtype: string): UUID {
  return identity(["message", nativeTaskId(link), eventId, subtype]);
}
function linkIdentity(link: TaskLink): string {
  return identity([
    nativeTaskId(link),
    link.kind,
    link.launchToolUseId,
    link.parent.sourceSessionId,
    link.parent.launchToolUseId,
    link.kind === "worker" ? [link.child.sourceSessionId, link.child.parentSessionId] : null,
  ]);
}
function validateLink(link: TaskLink): void {
  for (const value of [
    link.root.namespace,
    link.root.sourceSessionId,
    link.root.sessionId,
    link.sourceId,
    link.jobId,
    link.launchToolUseId,
    link.parent.sourceSessionId,
  ]) {
    if (!value) throw new Error("Task projection requires real session, job, source and launch identities");
  }
  if (link.parent.launchToolUseId === null && link.parent.sourceSessionId !== link.root.sourceSessionId) {
    throw new Error("Nested parent requires its causal launch-tool identity");
  }
  if (
    link.kind === "worker" &&
    (!link.child.sourceSessionId || link.child.parentSessionId !== link.parent.sourceSessionId)
  ) {
    throw new Error("Worker child session must link to the actual launching parent session");
  }
}
function validateUsage(usage: TaskUsage): void {
  for (const n of [usage.total_tokens, usage.tool_uses, usage.duration_ms]) {
    if (!Number.isFinite(n) || n < 0) throw new Error("Task usage requires observed nonnegative counters");
  }
}

// Wire shapes are separate from the lifecycle decision below; these builders do not change the cursor.
function taskEnvelope(
  link: TaskLink,
  eventId: string,
  subtype: TaskStarted["subtype"] | TaskProgress["subtype"] | TaskNotification["subtype"],
) {
  return {
    type: "system" as const,
    session_id: link.root.sessionId,
    uuid: nativeTaskMessageId(link, eventId, subtype),
    task_id: nativeTaskId(link),
    tool_use_id: link.runToolUseId ?? link.launchToolUseId,
  };
}

function taskStartedFrame(link: TaskLink, observation: TaskObservation): TaskStarted {
  return {
    ...taskEnvelope(link, observation.eventId, "task_started"),
    subtype: "task_started",
    task_type: link.kind === "worker" ? "local_agent" : "local_bash",
    description: observation.description,
    is_backgrounded: observation.isBackgrounded,
    ...(link.kind === "worker"
      ? {
          prompt: link.prompt,
          ...(link.subagentType === undefined ? {} : { subagent_type: link.subagentType }),
          ...(link.spawnDepth === undefined ? {} : { spawn_depth: link.spawnDepth }),
        }
      : {}),
  };
}

function taskProgressFrame(
  link: Extract<TaskLink, { kind: "worker" }>,
  eventId: string,
  progress: NonNullable<TaskObservation["progress"]>,
): TaskProgress {
  validateUsage(progress.usage);
  return {
    ...taskEnvelope(link, eventId, "task_progress"),
    subtype: "task_progress",
    description: progress.description,
    usage: { ...progress.usage },
    ...(link.subagentType === undefined ? {} : { subagent_type: link.subagentType }),
    ...(progress.lastToolName === undefined ? {} : { last_tool_name: progress.lastToolName }),
    ...(progress.summary === undefined ? {} : { summary: progress.summary }),
  };
}

function taskNotificationFrame(
  link: TaskLink,
  eventId: string,
  status: "completed" | "failed" | "killed",
  terminal: NonNullable<TaskObservation["terminal"]>,
): TaskNotification {
  if (terminal.usage) validateUsage(terminal.usage);
  return {
    ...taskEnvelope(link, eventId, "task_notification"),
    subtype: "task_notification",
    status: status === "killed" ? "stopped" : status,
    summary: terminal.summary,
    // Required SDK string: empty means no artifact. Never invent a path or equate Pi JSONL with SDK replay.
    output_file: terminal.outputFile ?? "",
    ...(terminal.usage ? { usage: { ...terminal.usage } } : {}),
  };
}

export function projectTask(
  link: TaskLink,
  observation: TaskObservation,
  previous?: TaskProjectionCheckpoint,
): TaskProjection {
  if (link.origin === "app_owned") return { frames: [], skipped: "app-owned" };
  validateLink(link);
  if (!Number.isSafeInteger(observation.revision) || observation.revision < 0 || !observation.eventId) {
    throw new Error("Task projection requires a stable event identity and monotone source revision");
  }
  const taskId = nativeTaskId(link);
  const runToolUseId = link.runToolUseId ?? link.launchToolUseId;
  if (!runToolUseId) throw new Error("Task run requires its actual launch/resume call identity");
  const binding = linkIdentity(link);
  if (previous && (previous.taskId !== taskId || previous.linkIdentity !== binding))
    throw new Error("Projection checkpoint belongs to another job/link");
  if (previous && observation.revision <= previous.revision)
    return { frames: [], checkpoint: previous, skipped: "stale" };

  // Every fresh observation advances the cursor, even when it cannot change the observed lifecycle.
  const checkpoint: TaskProjectionCheckpoint = previous
    ? { ...previous, revision: observation.revision }
    : {
        taskId,
        linkIdentity: binding,
        revision: observation.revision,
        phase: "unstarted",
        runToolUseId,
        isBackgrounded: false,
        description: observation.description,
      };
  const skip = (skipped: TaskProjection["skipped"]): TaskProjection => ({ frames: [], checkpoint, skipped });
  const resumed = observation.edge === "resumed" && observation.status === "running";
  if (checkpoint.phase === "terminal" && !resumed) return skip("terminal");
  if (observation.status === "unknown" || observation.status === "preparing") return skip("not-started");
  // A changed run call is only authoritative with a real resumed edge, never a reconnect snapshot.
  if (previous && previous.runToolUseId !== runToolUseId && !resumed) return skip("stale");
  if (checkpoint.phase === "unstarted" && observation.status !== "running") return skip("not-started");

  if (observation.status === "completed" || observation.status === "failed" || observation.status === "killed") {
    if (!observation.terminal) return skip("unconfirmed");
    return {
      frames: [taskNotificationFrame(link, observation.eventId, observation.status, observation.terminal)],
      checkpoint: { ...checkpoint, phase: "terminal", isBackgrounded: false },
    };
  }

  const frames: NativeTaskFrame[] = [];
  if (observation.status === "running" && (checkpoint.phase === "unstarted" || resumed)) {
    frames.push(taskStartedFrame(link, observation));
  }
  // T3 can misclassify opaque foreground progress as a subagent. Shell output stays with its real tool/artifact.
  if (link.kind === "worker" && observation.progress) {
    frames.push(taskProgressFrame(link, observation.eventId, observation.progress));
  }
  return {
    frames,
    checkpoint: {
      ...checkpoint,
      phase: "active",
      runToolUseId,
      isBackgrounded: observation.isBackgrounded,
      description: observation.description,
    },
  };
}

/** Structural subset of TaskSummary/TaskInspection. No runtime dependency on TaskManager. */
export interface LocalJobSnapshot {
  id: string;
  kind: "agent" | "command";
  status: "running" | "completed" | "failed" | "killed";
  command: string;
  title?: string;
  background?: boolean;
  completedAt?: string;
  termination?: { requestedAt: string };
  workspace?: { preparationStatus?: string };
  agent?: { sessionFile: string; parentSessionFile?: string; phase?: string; currentTool?: string };
}
export interface LocalProjectionContext {
  revision: number;
  eventId: string;
  /** True only for an actual resume, never just a socket reconnect. */
  resumed?: boolean;
  isBackgrounded?: boolean;
  usage?: TaskUsage;
  /** Actual inspected bounded result, with truncation recorded by its source. */
  result?: { summary: string; outputFile: string | null; truncated?: boolean };
}

/** Convert real manager snapshots; preparation reservations and stop requests are not launches/exits. */
export function projectLocalTask(
  link: TaskLink,
  snapshot: LocalJobSnapshot,
  context: LocalProjectionContext,
  previous?: TaskProjectionCheckpoint,
): TaskProjection {
  if (link.origin === "app_owned") return { frames: [], skipped: "app-owned" };
  if (snapshot.id !== link.jobId || (snapshot.kind === "agent") !== (link.kind === "worker"))
    throw new Error("Local snapshot does not match the actual linked job/kind");
  const preparing = snapshot.status === "running" && snapshot.workspace?.preparationStatus === "preparing";
  if (
    link.kind === "worker" &&
    !preparing &&
    (snapshot.status === "running" || previous?.phase === "active" || !!snapshot.agent) &&
    (!snapshot.agent ||
      snapshot.agent.sessionFile !== link.child.sourceSessionId ||
      snapshot.agent.parentSessionFile !== link.child.parentSessionId)
  )
    throw new Error("Local worker snapshot must prove the actual child/parent session link");
  const isBackgrounded = context.isBackgrounded ?? snapshot.background;
  if (typeof isBackgrounded !== "boolean") throw new Error("Local task requires its actual background-delivery state");
  const terminal = snapshot.status !== "running" && !!snapshot.completedAt;
  const result = context.result;
  return projectTask(
    link,
    {
      revision: context.revision,
      eventId: context.eventId,
      edge: context.resumed ? "resumed" : "snapshot",
      status: preparing
        ? "preparing"
        : snapshot.status === "running" && snapshot.termination
          ? "stopping"
          : snapshot.status,
      description: snapshot.title ?? snapshot.command,
      isBackgrounded,
      ...(link.kind === "worker" && snapshot.agent?.phase && context.usage
        ? {
            progress: {
              description: snapshot.agent.phase,
              usage: context.usage,
              ...(snapshot.agent.currentTool ? { lastToolName: snapshot.agent.currentTool } : {}),
            },
          }
        : {}),
      ...(terminal
        ? {
            terminal: {
              confirmed: true as const,
              summary: (result?.truncated ? "[Truncated Bruv job output]\n" : "") + (result?.summary ?? ""),
              outputFile: result?.outputFile ?? null,
              ...(context.usage ? { usage: context.usage } : {}),
            },
          }
        : {}),
    },
    previous,
  );
}

/** REPLACE roster from a complete root-session snapshot of linked projection cursors. Unknown keeps the last observed membership. */
export function projectBackgroundRoster(
  root: RootTaskSession,
  snapshotId: string,
  entries: readonly { link: TaskLink; checkpoint?: TaskProjectionCheckpoint; ambient?: boolean }[],
): BackgroundRoster {
  if (!snapshotId) throw new Error("Roster requires an authoritative snapshot identity");
  const tasks: BackgroundRoster["tasks"] = [];
  const seen = new Set<string>();
  for (const { link, checkpoint, ambient } of entries) {
    if (
      link.root.namespace !== root.namespace ||
      link.root.sourceSessionId !== root.sourceSessionId ||
      link.root.sessionId !== root.sessionId
    )
      throw new Error("Roster cannot mix root sessions");
    if (link.origin === "app_owned" || link.kind === "worker") continue;
    validateLink(link);
    if (!checkpoint) continue;
    if (checkpoint.taskId !== nativeTaskId(link) || checkpoint.linkIdentity !== linkIdentity(link))
      throw new Error("Roster checkpoint belongs to another job/link");
    if (checkpoint.phase !== "active" || !checkpoint.isBackgrounded || seen.has(checkpoint.taskId)) continue;
    seen.add(checkpoint.taskId);
    tasks.push({
      task_id: checkpoint.taskId,
      task_type: "local_bash",
      description: checkpoint.description,
      ...(ambient === undefined ? {} : { ambient }),
    });
  }
  tasks.sort((a, b) => a.task_id.localeCompare(b.task_id));
  return {
    type: "system",
    subtype: "background_tasks_changed",
    session_id: root.sessionId,
    uuid: identity(["roster", root.namespace, root.sourceSessionId, root.sessionId, snapshotId]),
    tasks,
  };
}

/** Only public translated child frames, never stdout summaries or fabricated child conversations. */
export function projectChildFrame(
  link: TaskLink,
  input: { sourceSessionId: string; eventId: string; body: ChildBody },
): ChildFrame | null {
  if (link.origin === "app_owned") return null;
  validateLink(link);
  if (link.kind !== "worker" || input.sourceSessionId !== link.child.sourceSessionId)
    throw new Error("Child output must belong to the explicitly linked worker session");
  if (!input.eventId) throw new Error("Child frame requires its original event identity");
  return {
    ...input.body,
    uuid: nativeTaskMessageId(link, input.eventId, `child:${input.body.type}`),
    session_id: link.root.sessionId,
    parent_tool_use_id: link.launchToolUseId,
  };
}

/** Handler owns serialized delivery and checkpoint persistence; no subscriptions, scheduler or task registry here. */
export function createTaskProjector(handlers: { publish: (projection: TaskProjection) => void | Promise<void> }) {
  return {
    async task(link: TaskLink, observation: TaskObservation, previous?: TaskProjectionCheckpoint) {
      const projection = projectTask(link, observation, previous);
      await handlers.publish(projection);
      return projection;
    },
    async local(
      link: TaskLink,
      snapshot: LocalJobSnapshot,
      context: LocalProjectionContext,
      previous?: TaskProjectionCheckpoint,
    ) {
      const projection = projectLocalTask(link, snapshot, context, previous);
      await handlers.publish(projection);
      return projection;
    },
    async child(link: TaskLink, input: Parameters<typeof projectChildFrame>[1]) {
      const frame = projectChildFrame(link, input);
      const projection: TaskProjection = { frames: frame ? [frame] : [] };
      await handlers.publish(projection);
      return projection;
    },
    async roster(...input: Parameters<typeof projectBackgroundRoster>) {
      const projection: TaskProjection = { frames: [projectBackgroundRoster(...input)] };
      await handlers.publish(projection);
      return projection;
    },
  };
}
