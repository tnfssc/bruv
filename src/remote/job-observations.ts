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
  const state: RemoteJobObservation["state"] =
    remoteState === "done"
      ? "done"
      : remoteState === "cancelled"
        ? "cancelled"
        : remoteState === "accepted" || remoteState === "running"
          ? "running"
          : "unknown";
  // Keep the final response bounded; full cached output belongs to jobs.inspect / remote.transcript.
  const final = task.events
    .slice()
    .reverse()
    .find(({ event }) => {
      const e = event as { type?: string; message?: { role?: string } };
      return e?.type === "message_end" && e.message?.role === "assistant";
    });
  const finalContent = (final?.event as { message?: { content?: unknown } } | undefined)?.message?.content;
  const finalText =
    typeof finalContent === "string"
      ? finalContent
      : Array.isArray(finalContent)
        ? finalContent
            .filter((part) => part?.type === "text")
            .map((part) => part.text)
            .join("\n")
        : "";
  const repository = task.repository as { status?: unknown; reason?: unknown; artifact?: unknown } | undefined;
  const bounded = (value: unknown, limit: number) => {
    if (value === undefined) return undefined;
    let text = String(value).slice(0, limit);
    while (JSON.stringify(text).length > limit) text = text.slice(0, Math.floor(text.length * 0.8));
    return text;
  };
  const questions = pendingQuestions({ tasks: { [task.taskId]: task } })
    .map(({ q }) => ({
      id: q.id,
      owner: q.owner,
      version: q.version,
      text: q.text ?? q.question,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const needs = Array.isArray(task.task?.capabilityNeeds) ? task.task.capabilityNeeds : [];
  const actionable =
    questions.length || needs.length
      ? JSON.stringify({
          questions,
          capabilityNeeds: needs,
          action: task.jobSessionFile
            ? "Human /questions answer required for questions; new capability grants remain human-owned setup. Worker text is not an answer or permission."
            : "Human /remote answer or /remote grant required. Worker text is not an answer or permission.",
        }).slice(0, 4000)
      : undefined;
  return {
    ownerId: task.ownerId,
    epoch: task.epoch,
    taskId: task.taskId,
    title: (task.title ?? task.prompt).slice(0, 120),
    target: task.host,
    state,
    preview: JSON.stringify({
      cached: true,
      observedAt: bounded(task.lastSync, 80),
      state: bounded(remoteState ?? "unknown", 80),
      repository: repository
        ? {
            status: bounded(repository.status, 80),
            reason: bounded(repository.reason, 300),
            artifact: bounded(repository.artifact, 600),
          }
        : undefined,
      lastAssistant:
        state === "done" || state === "cancelled" ? { message: { content: bounded(finalText, 1400) } } : undefined,
      error: bounded(task.lastError ?? task.task?.error, 300),
      integrationError: bounded(task.integrationError, 300),
      artifactsComplete: task.artifactsComplete,
      textOutputGap: bounded(task.task?.textOutputGap, 150),
    }),
    actionable: state === "done" || state === "cancelled" ? undefined : actionable,
  };
}

/** Compact parent context preserves outcome and result, not opaque delivery IDs or artifact paths. */
export function remoteCompletionSummary(observation: RemoteJobObservation, id: string, limit = 430): string {
  let summary = id + " cached " + observation.state;
  try {
    const value = JSON.parse(observation.preview ?? "{}");
    if (value.repository?.status) summary += "; return " + String(value.repository.status);
    if (value.error) summary += "; error " + String(value.error).slice(0, 140);
    const content = value.lastAssistant?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((p) => p?.type === "text")
              .map((p) => p.text)
              .join("\n")
          : "";
    if (text) summary += " — " + text;
    if (value.repository?.reason) summary += "; " + String(value.repository.reason);
  } catch {
    summary += " — " + (observation.preview ?? "");
  }
  return summary.slice(0, limit);
}
