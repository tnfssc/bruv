import type { Project, Thread } from "../protocol";

/**
 * The parts of T3's shell thread record that bruv reads (orchestration protocol 2). T3 sends more; other fields
 * are left alone. Most fields may be missing or null, so every read is guarded.
 */
export type T3Thread = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  branch?: string | null;
  /** The git worktree the thread works in, when it has its own. */
  worktreePath?: string | null;
  lineage?: { parentThreadId?: string | null } | null;
  lastError?: string | null;
  /** A permission request (command, file-change, permission, ...) or a question (user_input) waiting on the user. */
  pendingRuntimeRequest?: { id: string; kind: string; blocking?: boolean } | null;
  /** Work the thread's agent left running when its turn ended: subagents, commands, monitors. */
  pendingBackgroundTasks?: { kind?: string }[] | null;
  /** The thread is blocked in a wait on another thread. */
  blockedOnThreadWait?: boolean | null;
  /** Pull requests linked to the thread; one with `watch` is being watched (T3 wakes the thread on news). */
  pullRequests?: { watch?: unknown }[] | null;
  /** Set while a run is going; provider subagents keep `status` idle while they work, but not this. */
  activityRunStatus?: string | null;
  /** A plan T3 proposed that waits for the user to approve it. */
  hasActionableProposedPlan?: boolean;
  /** Empty in every shell record seen so far, but typed by T3 as the last message a person would read. */
  latestVisibleMessage?: { role: string; text: string } | null;
  latestRunCompletedAt?: string | null;
  lastVisitedAt?: string | null;
  pinnedAt?: string | null;
  settledAt?: string | null;
  snoozedUntil?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type T3Project = { id: string; title: string; workspaceRoot: string };

/** Errors can hold whole stack traces; the overview needs the start. Kept short to keep memory small. */
const longest = 1000;
const text = (value: string | null | undefined) => (value ? value.slice(0, longest) : undefined);

/**
 * Why a thread whose turn ended isn't done: it left work going that will bring it back. Its own children
 * (delegated tasks are separate threads) are added by the link, which sees them all.
 */
function holdingOf(record: T3Thread) {
  if (record.pullRequests?.some((link) => link.watch != null)) return "watching its pull request";
  const background = record.pendingBackgroundTasks ?? [];
  if (background.some((task) => task.kind === "subagent")) return "waiting on its subagents";
  if (background.length) return "waiting on work it left running";
  if (record.blockedOnThreadWait) return "waiting on another thread";
  return undefined;
}

export function toThread(record: T3Thread, now = Date.now()): Thread {
  const snoozed = record.snoozedUntil ? Date.parse(record.snoozedUntil) > now : false;
  const message = record.latestVisibleMessage;
  return {
    id: record.id,
    projectId: record.projectId,
    title: record.title,
    status: record.status,
    needsUser: record.pendingRuntimeRequest != null || record.hasActionableProposedPlan === true,
    holding: holdingOf(record),
    ...(record.activityRunStatus ? { active: true } : {}),
    requestId: text(record.pendingRuntimeRequest?.id),
    requestKind: text(record.pendingRuntimeRequest?.kind),
    lastMessage: message && message.role !== "user" ? text(message.text) : undefined,
    lastError: text(record.lastError),
    branch: text(record.branch),
    worktree: text(record.worktreePath),
    finishedAt: text(record.latestRunCompletedAt),
    visitedAt: text(record.lastVisitedAt),
    pinned: record.pinnedAt != null,
    away: record.settledAt != null || snoozed || record.archivedAt != null,
    parentId: text(record.lineage?.parentThreadId),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export const toProject = (record: T3Project): Project => ({
  id: record.id,
  title: record.title,
  root: record.workspaceRoot,
});

/** Same in every field a reader cares about. `updatedAt` alone moves all the time while a thread runs. */
export function sameThread(a: Thread, b: Thread) {
  for (const key of Object.keys(b) as (keyof Thread)[]) if (key !== "updatedAt" && a[key] !== b[key]) return false;
  return true;
}
