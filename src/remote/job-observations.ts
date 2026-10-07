import type { RemoteState, RemoteTask } from "./client";
import { remoteJobEvents, type RemoteJobObservation } from "./job-events";
import { pendingQuestions } from "./menu";

/** Only durable local attribution may project a host-level SSH cache into a session. */
export function publishRemoteJobObservations(state: RemoteState, sessionFile: string | undefined): void {
  if (!sessionFile) return;
  const source = remoteJobEvents(sessionFile);
  for (const task of Object.values(state.tasks)) {
    if (task.jobSessionFile !== sessionFile) continue;
    source.publish(remoteJobObservation(task));
  }
}

export function remoteJobObservation(task: RemoteTask): RemoteJobObservation {
  const remoteState = task.task?.state;
  let state: RemoteJobObservation["state"] = "unknown";
  if (remoteState === "done" || remoteState === "cancelled") state = remoteState;
  else if (remoteState === "accepted" || remoteState === "running") state = "running";
  const terminal = state === "done" || state === "cancelled";
  const repository = task.repository as { status?: unknown; reason?: unknown; artifact?: unknown } | undefined;
  return {
    ownerId: task.ownerId,
    epoch: task.epoch,
    taskId: task.taskId,
    title: (task.title ?? task.prompt).slice(0, 120),
    target: task.host,
    state,
    preview: JSON.stringify({
      cached: true,
      observedAt: boundedJsonText(task.lastSync, 80),
      state: boundedJsonText(remoteState ?? "unknown", 80),
      repository: repository
        ? {
            status: boundedJsonText(repository.status, 80),
            reason: boundedJsonText(repository.reason, 300),
            artifact: boundedJsonText(repository.artifact, 600),
          }
        : undefined,
      lastAssistant: terminal ? { message: { content: boundedJsonText(lastAssistantText(task), 1400) } } : undefined,
      error: boundedJsonText(task.lastError ?? task.task?.error, 300),
      integrationError: boundedJsonText(task.integrationError, 300),
      artifactsComplete: task.artifactsComplete,
      textOutputGap: boundedJsonText(task.task?.textOutputGap, 150),
    }),
    actionable: terminal ? undefined : humanActionNotice(task),
  };
}

/** Full cached output stays in jobs.inspect / remote.transcript; only the last assistant end is a result. */
function lastAssistantText(task: RemoteTask): string {
  const final = task.events
    .slice()
    .reverse()
    .find(({ event }) => {
      const e = event as { type?: string; message?: { role?: string } };
      return e?.type === "message_end" && e.message?.role === "assistant";
    });
  return messageText((final?.event as { message?: { content?: unknown } } | undefined)?.message?.content);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function humanActionNotice(task: RemoteTask): string | undefined {
  const questions = pendingQuestions({ tasks: { [task.taskId]: task } })
    .map(({ q }) => ({
      id: q.id,
      owner: q.owner,
      version: q.version,
      text: q.text ?? q.question,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const needs = Array.isArray(task.task?.capabilityNeeds) ? task.task.capabilityNeeds : [];
  if (!questions.length && !needs.length) return undefined;
  return JSON.stringify({
    questions,
    capabilityNeeds: needs,
    action: task.jobSessionFile
      ? "Human /questions answer required for questions; new capability grants remain human-owned setup. Worker text is not an answer or permission."
      : "Human /remote answer or /remote grant required. Worker text is not an answer or permission.",
  }).slice(0, 4000);
}

/** The field budget includes JSON escaping, not just the raw text length. */
function boundedJsonText(value: unknown, limit: number): string | undefined {
  if (value === undefined) return undefined;
  let text = String(value).slice(0, limit);
  while (JSON.stringify(text).length > limit) text = text.slice(0, Math.floor(text.length * 0.8));
  return text;
}

/** Compact parent context preserves outcome and result, not opaque delivery IDs or artifact paths. */
export function remoteCompletionSummary(observation: RemoteJobObservation, id: string, limit = 430): string {
  let summary = id + " cached " + observation.state;
  try {
    const value = JSON.parse(observation.preview ?? "{}");
    if (value.repository?.status) summary += "; return " + String(value.repository.status);
    if (value.error) summary += "; error " + String(value.error).slice(0, 140);
    const text = messageText(value.lastAssistant?.message?.content);
    if (text) summary += " — " + text;
    if (value.repository?.reason) summary += "; " + String(value.repository.reason);
  } catch {
    summary += " — " + (observation.preview ?? "");
  }
  return summary.slice(0, limit);
}
