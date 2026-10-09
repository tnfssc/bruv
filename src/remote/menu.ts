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
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove terminal control bytes and bidi markers from menu labels.
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const title = remoteLabel;
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
export function inboxItems(state: RemoteState): Item[] {
  const online = !!state.connection;
  return [
    ...pendingQuestions(state).map(({ task, q }) => {
      const answerAvailable = taskOwned(task, state) && !task.lastError;
      return {
        value: `${(answerAvailable ? "question:" : "offline:question:") + task.taskId}:${q.id}`,
        label: `Question: ${title(q.text ?? q.question ?? "Untitled question")}`,
        description:
          (answerAvailable ? "" : "Answer unavailable · sync pinned owner first · ") +
          title(task.prompt) +
          " · " +
          task.taskId.slice(0, 12),
      };
    }),
    ...Object.values(state.tasks).flatMap((task) =>
      Object.entries(task.replyDelivery ?? {})
        .filter(([, delivery]) => delivery.status === "uncertain")
        .map(([id]) => ({
          value: `task:${task.taskId}`,
          label:
            "Reply uncertain: " +
            title(
              ((task.task?.questions ?? []) as RemoteQuestion[]).find((q) => q.id === id)?.text ??
                ((task.task?.questions ?? []) as RemoteQuestion[]).find((q) => q.id === id)?.question ??
                id,
            ),
          description: `${title(task.prompt)} · saved reply retained; open task to reconcile`,
        })),
    ),
    ...Object.values(state.tasks).map((task) => ({
      value: `task:${task.taskId}`,
      label: `Task: ${title(task.prompt || task.repoPath)} [${task.task?.state ?? task.outcome}]`,
      description: remoteLabel(
        (task.task?.state ?? task.outcome) +
          " · " +
          task.host +
          " · cached · " +
          task.taskId.slice(0, 12) +
          (task.cancelDelivery
            ? ` · cancellation ${task.cancelDelivery.status} (terminal state is separate)`
            : task.cancelRequested
              ? " · cancellation requested locally"
              : "") +
          (returnedReview(task) || task.integrationError ? " · review needed" : "") +
          (Array.isArray(task.task?.capabilityNeeds) && task.task.capabilityNeeds.length
            ? " · capability request pending"
            : "") +
          (task.lastError ? ` · ${task.lastError}` : ""),
      ),
    })),
    { value: "connect", label: "Connect…", description: "user@host or configured SSH alias" },
    ...(online
      ? [
          {
            value: "launch",
            label: "Launch local repository…",
            description: "Explicit snapshot and prompt · requires SSH; unavailable offline",
          },
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
export function taskActions(task: RemoteTask, ownerConnected: boolean, hasLocalGrants = false): Item[] {
  const review = returnedReview(task);
  const freshActive = !task.lastError && ["accepted", "running"].includes(task.task?.state ?? "");
  const items: Item[] = [
    { value: "transcript", label: "View cached transcript", description: "Available offline" },
    {
      value: "details",
      label: review ? "Review returned changes" : "View saved task details",
      description: review
        ? "Saved conflict reason and local artifact path · available offline"
        : "Saved status, errors and pending requests · available offline",
    },
  ];

  // Local revocation does not require a connected owner or a fresh task.
  if (hasLocalGrants || (ownerConnected && freshActive))
    items.push({
      value: "capabilities",
      label: "Local capabilities…",
      description: "Revoke local grants offline; new grants require a live pinned owner",
    });
  if (!ownerConnected) {
    items.push({
      value: "offline",
      label: "Sync / cancel unavailable (offline)",
      description: "Connect to the pinned owner first",
    });
    return items;
  }

  // Reconciliation is available even after a failed sync; it retains saved identities.
  items.push({
    value: "sync",
    label: "Sync task",
    description: task.lastError ? "Retry failed sync; other actions unavailable until fresh" : "Fetch owner updates",
  });
  for (const [id, delivery] of Object.entries(task.replyDelivery ?? {})) {
    if (delivery.status === "uncertain")
      items.push({
        value: `reply:${id}`,
        label: "Reconcile saved reply",
        description: "Same saved text and reply identity; never a new answer",
      });
  }
  if (task.outcome === "unknown")
    items.push({ value: "retry", label: "Reconcile uncertain launch", description: "Same task ID and owner only" });

  if (freshActive) items.push({ value: "cancel", label: "Cancel task…", description: "Requires confirmation" });
  if (task.lastError)
    items.push({
      value: "offline",
      label: "Cancel unavailable (last sync failed)",
      description: "Sync the pinned owner first",
    });
  return items;
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
      : verbs.filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v }));
  const [, verb, typed] = match;
  if (verb === "answer") {
    const scoped = /^(\S+)\s+(\S*)$/.exec(typed);
    if (scoped && state.tasks[scoped[1]])
      return pendingQuestions(state)
        .filter(
          ({ task, q }) =>
            task.taskId === scoped[1] &&
            (q.id.startsWith(scoped[2]) ||
              (q.text ?? q.question ?? "").toLowerCase().includes(scoped[2].toLowerCase())),
        )
        .map(({ task, q }) => ({
          value: `answer ${task.taskId} ${q.id} `,
          label: `Question: ${title(q.text ?? q.question ?? q.id)}`,
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
        value: `answer ${task.taskId} ${q.id} `,
        label: `Question: ${title(q.text ?? q.question ?? q.id)}`,
        description: title(task.prompt),
      }));
  if (verb === "grant" && ["repo.read", "tool:git-status", "tool:git-diff"].some((v) => v.startsWith(typed)))
    return ["repo.read", "tool:git-status", "tool:git-diff"]
      .filter((v) => v.startsWith(typed))
      .map((v) => ({ value: `grant ${v}`, label: v }));
  if (["sync", "cancel", "retry", "transcript", "grant", "revoke"].includes(verb) && state.tasks[typed]) return null;
  if (["sync", "cancel", "retry", "transcript", "grant", "revoke"].includes(verb))
    return Object.values(state.tasks)
      .filter((task) => task.taskId.startsWith(typed) || task.prompt.toLowerCase().includes(typed.toLowerCase()))
      .map((task) => ({
        value: `${verb} ${task.taskId}`,
        label: `Task: ${title(task.prompt)}`,
        description: task.task?.state ?? task.outcome,
      }));
  return null;
}
