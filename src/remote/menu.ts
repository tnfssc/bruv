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
export const untrackedApprovalText = (paths: string[], count: number) =>
  "Untracked files (" +
  count +
  "):\n" +
  paths.map((path) => "  " + remoteLabel(path)).join("\n") +
  "\nShowing " +
  paths.length +
  " of " +
  count +
  ". Include all " +
  count +
  " untracked paths? Choose No to send tracked files only.";
const returnedReview = (task: RemoteTask) => (task.repository as { status?: string } | undefined)?.status === "review";
export const pendingQuestions = (state: Pick<RemoteState, "tasks">) =>
  Object.values(state.tasks).flatMap((task) =>
    ((task.task?.questions ?? []) as RemoteQuestion[])
      .filter((q) => q.status === "pending" && !task.replies?.[q.id])
      .map((q) => ({ task, q })),
  );
export const taskOwned = (task: RemoteTask, state: RemoteState) =>
  !!state.connection &&
  task.host === state.connection.host &&
  task.ownerId === state.connection.hello.ownerId &&
  task.epoch === state.connection.hello.epoch;
/** Connection is saved target identity; task errors/freshness remain visible separately. */
export function remoteMenuStatus(state: RemoteState, changed = false, unavailable = false): string {
  const hasTasks = Object.keys(state.tasks).length > 0;
  if (!state.connection)
    return "remote: not connected · Connect to get started" + (hasTasks ? " · saved tasks available offline" : "");
  const target = remoteLabel(state.connection.host);
  const offline = unavailable || Object.values(state.tasks).some((task) => task.lastError && taskOwned(task, state));
  if (offline) return "remote: " + target + " unavailable · Reconnect or read saved tasks";
  return (
    "remote: connected to " +
    target +
    (hasTasks
      ? " · saved view" + (changed ? " updated" : "") + " · Refresh from remote for latest"
      : " · Launch a task from this repository")
  );
}

export function remoteErrorHint(action: string): string {
  switch (action.split(":")[0]) {
    case "connect":
      return "Check the SSH host/alias and that die is installed on the Linux server. Retry /remote connect <host>; for a custom binary use /remote connect <host> <die-path>. Existing saved tasks are unchanged.";
    case "answer":
    case "question":
    case "reply":
      return "Open the task or /remote status to check saved reply delivery. If uncertain, reconcile the same saved reply; do not submit a replacement answer.";
    case "cancel":
      return "Open the task or /remote status to check cancellation delivery and observed task state. A failed request is not confirmed cancellation; sync the pinned owner before retrying.";
    case "launch":
    case "launch-repo":
    case "launch-repo-json":
    case "retry":
      return "Check /remote status for a saved launch before retrying. Reconcile an uncertain launch with the same task ID; do not start a duplicate task.";
    case "grant":
    case "revoke":
    case "capabilities":
      return "Inspect the task’s local capabilities and pinned owner. New grants require a live owner and human authorization; local revocation remains available offline.";
    case "sync":
    case "refresh":
      return "Reconnect to the task’s pinned owner and sync again. Saved transcripts remain available with /remote transcript; sync failure is not task completion.";
    case "transcript":
      return "Use /remote status to choose a saved task, then /remote transcript <taskId>. Saved transcript pages are available offline.";
    default:
      return "Open /remote for Connect, tasks and next actions; /remote status shows saved task and question IDs.";
  }
}

const needsAccess = (task: RemoteTask) =>
  Array.isArray(task.task?.capabilityNeeds) && task.task.capabilityNeeds.length > 0;
const taskPriority = (task: RemoteTask) =>
  needsAccess(task) || returnedReview(task) || task.integrationError || task.lastError || task.outcome === "unknown"
    ? 0
    : ["accepted", "running", "blocked"].includes(task.task?.state ?? "")
      ? 1
      : 2;
export function inboxItems(state: RemoteState): Item[] {
  const online = !!state.connection;
  return [
    ...pendingQuestions(state).map(({ task, q }) => ({
      value: (taskOwned(task, state) && !task.lastError ? "question:" : "offline:question:") + task.taskId + ":" + q.id,
      label: "Question: " + title(q.text ?? q.question ?? "Untitled question"),
      description:
        (taskOwned(task, state) && !task.lastError ? "" : "Answer unavailable · sync pinned owner first · ") +
        title(task.prompt) +
        " · " +
        task.taskId.slice(0, 12),
    })),
    ...Object.values(state.tasks).flatMap((task) =>
      Object.entries(task.replyDelivery ?? {})
        .filter(([, delivery]) => delivery.status === "uncertain")
        .map(([id]) => ({
          value: "task:" + task.taskId,
          label:
            "Reply uncertain: " +
            title(
              ((task.task?.questions ?? []) as RemoteQuestion[]).find((q) => q.id === id)?.text ??
                ((task.task?.questions ?? []) as RemoteQuestion[]).find((q) => q.id === id)?.question ??
                id,
            ),
          description: title(task.prompt) + " · saved reply retained; open task to reconcile",
        })),
    ),
    ...Object.values(state.tasks)
      .sort((a, b) => taskPriority(a) - taskPriority(b))
      .map((task) => ({
        value: "task:" + task.taskId,
        label:
          "Task: " +
          title(task.prompt || task.repoPath) +
          " [" +
          (task.task?.state ?? task.outcome) +
          (needsAccess(task) ? " · local access requested" : "") +
          "]",
        description: remoteLabel(
          (needsAccess(task) ? "Local access requested · " : "") +
            (task.task?.state ?? task.outcome) +
            " · " +
            task.host +
            " · cached · " +
            task.taskId.slice(0, 12) +
            (task.cancelDelivery
              ? " · cancellation " + task.cancelDelivery.status + " (terminal state is separate)"
              : task.cancelRequested
                ? " · cancellation requested locally"
                : "") +
            (returnedReview(task) || task.integrationError ? " · review needed" : "") +
            (Array.isArray(task.task?.capabilityNeeds) && task.task.capabilityNeeds.length
              ? " · capability request pending"
              : "") +
            (task.lastError ? " · " + task.lastError : ""),
        ),
      })),
    ...(online
      ? [
          {
            value: "launch",
            label: "Launch local repository…",
            description: "Send tracked work and a prompt · untracked files need your approval",
          },
          ...(Object.keys(state.tasks).length
            ? [{ value: "refresh", label: "Refresh from remote", description: "Sync active tasks now" }]
            : []),
        ]
      : []),
    {
      value: "connect",
      label: online ? "Connect to another host…" : "Connect…",
      description: "user@host or configured SSH alias · uses die on the server",
    },
  ];
}
export function questionOptions(q: RemoteQuestion): Item[] {
  return [
    ...(q.choices ?? []).map((choice, i) => ({ value: String(i), label: remoteLabel(choice) })),
    ...(q.allowFreeText === false ? [] : [{ value: "write", label: "Write an answer…" }]),
  ];
}
export function taskActions(task: RemoteTask, online: boolean, hasLocalGrants = false): Item[] {
  const actions: Item[] = [
    { value: "transcript", label: "View cached transcript", description: "Available offline" },
    {
      value: "details",
      label: returnedReview(task)
        ? "Review returned changes"
        : task.task?.state === "done"
          ? "Read result and details"
          : "View saved task details",
      description: returnedReview(task)
        ? "Saved conflict reason and local artifact path · available offline"
        : "Saved status, errors and pending requests · available offline",
    },
    ...(hasLocalGrants || (online && !task.lastError && ["accepted", "running"].includes(task.task?.state ?? ""))
      ? [
          {
            value: "capabilities",
            label: needsAccess(task) ? "Review local access request…" : "Local capabilities…",
            description: "Human authorization required · revoke offline; grant only to a live pinned owner",
          },
        ]
      : []),
    ...(online
      ? [
          {
            value: "sync",
            label: "Sync task",
            description: task.lastError
              ? "Retry failed sync; other actions unavailable until fresh"
              : "Fetch owner updates",
          },
          ...Object.entries(task.replyDelivery ?? {})
            .filter(([, d]) => d.status === "uncertain")
            .map(([id]) => ({
              value: "reply:" + id,
              label: "Reconcile saved reply",
              description: "Same saved text and reply identity; never a new answer",
            })),
          ...(task.outcome === "unknown"
            ? [{ value: "retry", label: "Reconcile uncertain launch", description: "Same task ID and owner only" }]
            : []),
          ...(!task.lastError && ["accepted", "running"].includes(task.task?.state ?? "")
            ? [{ value: "cancel", label: "Cancel task…", description: "Requires confirmation" }]
            : []),
          ...(task.lastError
            ? [
                {
                  value: "offline",
                  label: "Cancel unavailable (last sync failed)",
                  description: "Sync the pinned owner first",
                },
              ]
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
  const next = needsAccess(task) && actions.some((item) => item.value === "capabilities") ? "capabilities" : "details";
  return next
    ? [...actions.filter((item) => item.value === next), ...actions.filter((item) => item.value !== next)]
    : actions;
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
  // An exact command must submit on Enter, not re-select the identical completion.
  if (!match)
    return verbs.includes(prefix)
      ? null
      : (prefix
          ? verbs.filter((v) => v !== "launch-repo-json" || prefix.startsWith("launch-repo-"))
          : [
              "connect",
              "status",
              ...(state.connection ? ["launch-repo"] : []),
              ...(pendingQuestions(state).length ? ["answer"] : []),
              ...(Object.keys(state.tasks).length ? ["sync", "transcript"] : []),
            ]
        )
          .filter((v) => v.startsWith(prefix))
          .map((v) => ({ value: v, label: v }));
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
  if (["sync", "cancel", "retry", "transcript", "grant", "revoke"].includes(verb!) && state.tasks[typed]) return null;
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
