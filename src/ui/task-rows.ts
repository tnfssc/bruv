import { launchTaskTitle, taskTitle as clean } from "../tasks/task-title";
import { sshJobId } from "../remote/jobs";

/** Canonical, serializable transcript row. Identity comes only from typed jobs. */
export type TaskRow = {
  id: string;
  source: "local" | "native" | "ssh";
  title?: string;
  fallbackTitle?: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "unknown" | "needs-input";
  terminal: boolean;
  exitCode?: number;
  timedOut?: boolean;
  sourceCallId?: string;
};
/** An owning execute label beats a command preview, never an explicit task title. */
export function taskRowWithExecuteLabel(row: TaskRow, label: unknown): TaskRow {
  const title = clean(row.title) || clean(label);
  return title ? { ...row, title } : row;
}
export function taskRowKey(row: Pick<TaskRow, "source" | "id">): string {
  return row.source + ":" + row.id;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Adapter for shell/local subagent/native job responses, never stdout or source. */
export function taskRowFromLaunch(value: unknown, sourceCallId?: string, launchTitle?: unknown): TaskRow | undefined {
  const task = record(value);
  if (!task || typeof task.id !== "string" || !task.id) return;
  const id = task.id;
  const source = id.startsWith("ssh:")
    ? "ssh"
    : task.deliveryMode === "native-async"
      ? "native"
      : task.kind === "command" || task.kind === "agent"
        ? "local"
        : "native";
  const title = clean(task.title) || clean(launchTitle);
  const fallbackTitle = launchTaskTitle(undefined, task.command ?? task.prompt);
  const status = task.status;
  const exitCode = typeof task.exitCode === "number" && Number.isInteger(task.exitCode) ? task.exitCode : undefined;
  const timedOut = task.timedOut === true;
  const terminal = ["completed", "failed", "killed", "cancelled", "done"].includes(String(status));
  let outcome: TaskRow["status"] = "unknown";
  if (task.actionable) outcome = "needs-input";
  else if (timedOut) outcome = "failed";
  else if (status === "killed" || status === "cancelled") outcome = "cancelled";
  else if (status === "failed" || (terminal && exitCode !== undefined && exitCode !== 0)) outcome = "failed";
  else if (status === "running") outcome = "running";
  else if (status === "completed" && source !== "ssh") outcome = "succeeded";
  // SSH done is an observation, not an actual success result.
  return {
    id,
    source,
    ...(title ? { title } : {}),
    ...(fallbackTitle ? { fallbackTitle } : {}),
    status: outcome,
    terminal,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(timedOut ? { timedOut: true } : {}),
    ...(sourceCallId ? { sourceCallId } : {}),
  };
}
export function taskRowFromRemote(value: unknown): TaskRow | undefined {
  const task = record(value);
  if (!task || typeof task.taskId !== "string" || !task.taskId) return;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(task.taskId))
    return { id: "SSH task", source: "ssh", status: "unknown", terminal: false };
  const row = taskRowFromLaunch({ ...task, id: sshJobId(task.taskId), status: task.state });
  return row;
}

/** Terminal facts cannot be reopened by delayed running/pending owner snapshots. */
export function upsertTaskRow(rows: Map<string, TaskRow>, next: TaskRow): TaskRow {
  const key = taskRowKey(next);
  const old = rows.get(key);
  if (old?.terminal && (!next.terminal || (old.status !== "unknown" && next.status === "unknown"))) {
    const row = {
      ...old,
      title: clean(next.title) || clean(old.title) || undefined,
      fallbackTitle: clean(next.fallbackTitle) || clean(old.fallbackTitle) || undefined,
      sourceCallId: next.sourceCallId || old.sourceCallId,
    };
    rows.set(key, row);
    return row;
  }
  const row = {
    ...old,
    ...next,
    title: clean(next.title) || clean(old?.title) || undefined,
    fallbackTitle: clean(next.fallbackTitle) || clean(old?.fallbackTitle) || undefined,
    sourceCallId: next.sourceCallId || old?.sourceCallId,
  };
  rows.set(key, row);
  return row;
}
export function taskRowsFromDetails(value: unknown): TaskRow[] {
  const details = record(value);
  if (!details) return [];
  const rows = new Map<string, TaskRow>();
  if (Array.isArray(details.taskRows))
    for (const value of details.taskRows) {
      const row = record(value);
      if (
        row &&
        typeof row.id === "string" &&
        ["local", "native", "ssh"].includes(String(row.source)) &&
        ["running", "succeeded", "failed", "cancelled", "unknown", "needs-input"].includes(String(row.status)) &&
        typeof row.terminal === "boolean"
      )
        upsertTaskRow(rows, row as TaskRow);
    }
  if (Array.isArray(details.tasks))
    for (const task of details.tasks) {
      const row = taskRowFromLaunch(task);
      if (row) upsertTaskRow(rows, row);
    }
  if (Array.isArray(details.remote))
    for (const task of details.remote) {
      const row = taskRowFromRemote(task);
      if (row) upsertTaskRow(rows, row);
    }
  return [...rows.values()];
}
export function taskRowColor(row: TaskRow): "accent" | "success" | "error" | "warning" {
  return row.status === "running"
    ? "accent"
    : row.status === "succeeded"
      ? "success"
      : row.status === "failed" || row.status === "cancelled"
        ? "error"
        : "warning";
}
export function formatTaskRow(row: TaskRow): string {
  const title = clean(row.title) || clean(row.fallbackTitle) || clean(row.id);
  switch (row.status) {
    case "running":
      return "↗ " + title;
    case "succeeded":
      return "✓ " + title;
    case "cancelled":
      return "⊘ " + title + " — cancelled";
    case "failed":
      return (
        "✗ " +
        title +
        " — " +
        (row.timedOut ? "timed out" : row.exitCode !== undefined ? "exit " + row.exitCode : "failed")
      );
    case "needs-input":
      return "? " + title + " — needs your input";
    default:
      return "? " + title + " — status unknown";
  }
}

export type TaskSummaryRow = { color: "error" | "warning"; text: string };
/** Counts are supplied by the producer, never inferred from text or guessed children. */
export function taskSummaryRowsFromDetails(value: unknown): TaskSummaryRow[] {
  const details = record(value);
  const aggregate = record(details?.taskStatusCounts);
  if (!aggregate && typeof details?.omittedTasks === "number" && details.omittedTasks > 0)
    return [{ color: "warning", text: "? Task update — status unknown" }];
  if (
    !aggregate ||
    !["completed", "failed", "killed", "running", "unknown"].every(
      (key) =>
        typeof aggregate[key] === "number" && Number.isSafeInteger(aggregate[key]) && (aggregate[key] as number) >= 0,
    )
  )
    return [];
  const counts = { completed: 0, failed: 0, killed: 0, running: 0, unknown: 0 };
  if (Array.isArray(details?.tasks))
    for (const task of details.tasks) {
      const status = taskRowFromLaunch(task)?.status;
      if (status === "succeeded") counts.completed++;
      else if (status === "failed") counts.failed++;
      else if (status === "cancelled") counts.killed++;
      else if (status === "running") counts.running++;
      else counts.unknown++;
    }
  const rows: TaskSummaryRow[] = [];
  const add = (count: number, color: TaskSummaryRow["color"], mark: string, suffix: string) => {
    if (count > 0) rows.push({ color, text: mark + " " + count + " more tasks " + suffix });
  };
  add((aggregate.failed as number) - counts.failed, "error", "✗", "failed");
  add((aggregate.killed as number) - counts.killed, "error", "⊘", "cancelled");
  add(
    (aggregate.running as number) + (aggregate.unknown as number) - counts.running - counts.unknown,
    "warning",
    "?",
    "unresolved",
  );
  return rows;
}

/** Projection of persisted UI metadata on the current branch; no owner mutation. */
export function taskRowsFromSessionEntries(entries: ReadonlyArray<unknown>): TaskRow[] {
  const rows = new Map<string, TaskRow>();
  const labels = new Map<string, unknown>();
  for (const value of entries) {
    const entry = record(value);
    const message = record(entry?.message);
    if (message?.role === "assistant" && Array.isArray(message.content))
      for (const value of message.content) {
        const call = record(value);
        if (call?.type === "toolCall" && call.name === "execute" && typeof call.id === "string")
          labels.set(call.id, record(call.arguments)?.label);
      }
    const details =
      entry?.type === "custom" && entry.customType === "die-task-row"
        ? { taskRows: [entry.data] }
        : entry?.type === "message" && record(entry.message)?.role === "toolResult"
          ? record(entry.message)?.details
          : undefined;
    for (const row of taskRowsFromDetails(details))
      upsertTaskRow(rows, {
        ...row,
        sourceCallId: row.sourceCallId ?? (message?.role === "toolResult" ? (message.toolCallId as string) : undefined),
      });
  }
  return [...rows.values()].map((row) => taskRowWithExecuteLabel(row, labels.get(row.sourceCallId ?? "")));
}
