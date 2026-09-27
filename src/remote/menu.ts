import type { RemoteState, RemoteTask } from "./client";

export type RemoteQuestion = {
  id: string;
  status: string;
  text?: string;
  question?: string;
  choices?: string[];
  allowFreeText?: boolean;
  owner?: { sessionId: string; branchId: string };
  version?: number;
};
type Item = { value: string; label: string; description?: string };
export const remoteLabel = (text: string) =>
  text
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const title = remoteLabel;
export const pendingQuestions = (state: Pick<RemoteState, "tasks">) =>
  Object.values(state.tasks).flatMap((task) =>
    ((task.task?.questions ?? []) as RemoteQuestion[])
      .filter((q) => q.status === "pending" && !task.replies?.[q.id])
      .map((q) => ({ task, q })),
  );
export function inboxItems(state: RemoteState): Item[] {
  const online = !!state.connection;
  return [
    ...pendingQuestions(state).map(({ task, q }) => ({
      value: (online ? "question:" : "offline:question:") + task.taskId + ":" + q.id,
      label: "Question: " + title(q.text ?? q.question ?? "Untitled question"),
      description: (online ? "" : "Unavailable offline · ") + title(task.prompt) + " · " + task.taskId.slice(0, 12),
    })),
    ...Object.values(state.tasks).map((task) => ({
      value: "task:" + task.taskId,
      label: "Task: " + title(task.prompt || task.repoPath) + " [" + (task.task?.state ?? task.outcome) + "]",
      description: task.host + " · " + task.taskId.slice(0, 12) + (task.lastError ? " · " + task.lastError : ""),
    })),
    { value: "connect", label: "Connect…", description: "Configured SSH host" },
    ...(online
      ? [
          { value: "launch", label: "Launch local repository…", description: "Explicit snapshot and prompt" },
          { value: "refresh", label: "Refresh from remote", description: "Sync active tasks now" },
        ]
      : [
          {
            value: "offline",
            label: "Launch / refresh unavailable (offline)",
            description: "Connect first; cached task transcripts remain available",
          },
        ]),
  ];
}
export function questionOptions(q: RemoteQuestion): Item[] {
  return [
    ...(q.choices ?? []).map((choice, i) => ({ value: String(i), label: remoteLabel(choice) })),
    ...(q.allowFreeText === false ? [] : [{ value: "write", label: "Write an answer…" }]),
  ];
}
export function taskActions(task: RemoteTask, online: boolean): Item[] {
  return [
    { value: "transcript", label: "View cached transcript", description: "Available offline" },
    ...(online
      ? [
          { value: "sync", label: "Sync task", description: "Fetch owner updates" },
          ...(task.outcome === "unknown"
            ? [{ value: "retry", label: "Reconcile uncertain launch", description: "Same task ID and owner only" }]
            : []),
          ...(["accepted", "running"].includes(task.task?.state ?? "")
            ? [{ value: "cancel", label: "Cancel task…", description: "Requires confirmation" }]
            : []),
        ]
      : [
          {
            value: "offline",
            label: "Sync / cancel unavailable (offline)",
            description: "Connect to the pinned owner first",
          },
        ]),
  ];
}
const verbs = [
  "connect",
  "status",
  "launch",
  "launch-repo",
  "launch-repo-json",
  "answer",
  "grant",
  "revoke",
  "cancel",
  "retry",
  "sync",
  "transcript",
];
export function remoteCompletions(prefix: string, state: RemoteState): Item[] | null {
  const match = /^(\S+)\s+(.*)$/s.exec(prefix);
  if (!match) return verbs.filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v }));
  const [, verb, typed] = match;
  if (verb === "answer") {
    const scoped = /^(\S+)\s+(\S*)$/.exec(typed);
    if (scoped && state.tasks[scoped[1]!])
      return pendingQuestions(state)
        .filter(
          ({ task, q }) =>
            task.taskId === scoped[1] &&
            (q.id.startsWith(scoped[2]!) ||
              (q.text ?? q.question ?? "").toLowerCase().includes(scoped[2]!.toLowerCase())),
        )
        .map(({ task, q }) => ({
          value: "answer " + task.taskId + " " + q.id + " ",
          label: "Question: " + title(q.text ?? q.question ?? q.id),
          description: title(task.prompt),
        }));
  }
  if (/\s/.test(typed)) return null;
  if (verb === "answer")
    return pendingQuestions(state)
      .filter(
        ({ q, task }) =>
          q.id.startsWith(typed) ||
          task.taskId.startsWith(typed) ||
          (q.text ?? q.question ?? "").toLowerCase().includes(typed.toLowerCase()),
      )
      .map(({ q, task }) => ({
        value: "answer " + task.taskId + " " + q.id + " ",
        label: "Question: " + title(q.text ?? q.question ?? q.id),
        description: title(task.prompt),
      }));
  if (verb === "grant" && ["repo.read", "tool:git-status", "tool:git-diff"].some((v) => v.startsWith(typed)))
    return ["repo.read", "tool:git-status", "tool:git-diff"]
      .filter((v) => v.startsWith(typed))
      .map((v) => ({ value: "grant " + v, label: v }));
  if (["sync", "cancel", "retry", "transcript", "grant", "revoke"].includes(verb!))
    return Object.values(state.tasks)
      .filter((task) => task.taskId.startsWith(typed) || task.prompt.toLowerCase().includes(typed.toLowerCase()))
      .map((task) => ({
        value: verb + " " + task.taskId,
        label: "Task: " + title(task.prompt),
        description: task.task?.state ?? task.outcome,
      }));
  return null;
}
