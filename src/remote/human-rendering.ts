import type { RemoteTask, RemoteState } from "./client";
export const safe = (value: unknown): string => String(value ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const detail = (value: unknown) => safe(typeof value === "string" ? value : JSON.stringify(value) ?? "unknown");
const obj = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
export function assistantText(events: Array<{event: unknown}> = []): string | undefined {
  for (const row of events.slice().reverse()) {
    const e = obj(row.event), m = obj(e.message);
    if (e.type !== "message_end" || m.role !== "assistant") continue;
    const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((p: any) => p?.type === "text" && typeof p.text === "string").map((p: any) => p.text).join("\n") : undefined;
    if (text) return safe(text);
  }
}
export function taskLine(t: RemoteTask): string {
  const problems = [t.lastError && "offline (cached)", t.integrationError && "result review needed", t.task?.error && "failed", t.task?.textOutputGap && "transcript gap", t.transcriptComplete === false && t.task?.state === "done" && "transcript incomplete"].filter(Boolean);
  const questions = (t.task?.questions as any[] | undefined)?.filter(q => q.status === "pending") ?? [];
  if (questions.length) problems.push(questions.length + " question(s) pending");
  if ((t.task?.capabilityNeeds as any[] | undefined)?.length) problems.push("capability request pending");
  if (t.cancelRequested && t.task?.state !== "cancelled") problems.push("cancel requested (not terminal)");
  return safe(t.taskId) + " \u00B7 " + safe(t.task?.state ?? t.outcome ?? "unknown") + (problems.length ? " \u00B7 " + problems.join(" \u00B7 ") : "");
}
export function renderHuman(value: unknown, kind = "result"): string {
  const v = obj(value);
  if (kind === "transcript") {
    const rows = Array.isArray(v.events) ? v.events : [];
    return ["Remote transcript \u00B7 " + safe(v.taskId) + " \u00B7 offset " + (v.offset ?? 0), ...rows.map((r: any) => "#" + safe(r.seq ?? "?") + " " + safe(obj(r.event).type ?? "event") + " \u00B7 " + detail(r.event)), v.nextOffset !== undefined ? "More: /remote transcript " + safe(v.taskId) + " " + v.nextOffset : "End of cached transcript.", v.transcriptComplete === false && "Warning: transcript incomplete."].filter(Boolean).join("\n");
  }
  if (kind === "error" && v.error) return "Remote error: " + detail(v.error) + (v.hint ? "\n" + detail(v.hint) : "");
  if (kind === "status") {
    const tasks = Array.isArray(v.tasks) ? v.tasks as RemoteTask[] : [];
    return ["Remote \u00B7 " + (v.connection ? "connected to " + safe(v.connection.host) : "not connected") + " (cached observations)", ...tasks.map(t => taskLine(t) + (t.lastError ? "\n  " + detail(t.lastError) : "") + ((t.task?.questions as any[] | undefined) ?? []).filter(q => q.status === "pending").map(q => "\n  Question " + safe(q.id) + ": " + safe(q.text ?? q.question)).join("")), tasks.length ? "Use /remote to act; /remote transcript <taskId> for all events." : "No saved tasks."].join("\n");
  }
  if (v.taskId) {
    const t = v as RemoteTask;
    return ["Remote " + taskLine(t), t.lastError && "Offline; cached observation: " + detail(t.lastError), t.integrationError && "Result review: " + detail(t.integrationError), t.task?.error && "Task error: " + detail(t.task.error), t.transcriptComplete === false && "Warning: transcript incomplete.", t.task?.state === "done" && (v.finalAssistantText || assistantText(t.events)), "Last synchronized state, not live status. /remote transcript " + safe(t.taskId) + " for full events."].filter(Boolean).join("\n");
  }
  if (kind === "connect") return "Remote connected to " + safe(v.host) + ". " + safe(v.scope ?? "");
  return detail(value);
}
/** Semantic identity rather than cursor, timestamp, or event count. */
export class RemoteAttention {
  private seen = new Map<string, Set<string>>();
  update(state: RemoteState): string[] {
    const notices: string[] = [];
    for (const t of Object.values(state.tasks)) {
      const prior = this.seen.get(t.taskId) ?? new Set<string>();
      const now = new Map<string, string>();
      const add = (key: string, text: string) => now.set(key, "Remote " + safe(t.taskId) + " \u00B7 " + text);
      if (t.lastError) add("offline:" + t.lastError, "offline; cached state only: " + detail(t.lastError));
      if (t.integrationError) add("review:" + t.integrationError, "result review needed: " + detail(t.integrationError));
      if (t.task?.error) add("error:" + t.task.error, "failed: " + detail(t.task.error));
      if (t.task?.textOutputGap) add("gap:" + t.task.textOutputGap, "transcript gap: " + detail(t.task.textOutputGap));
      for (const q of (t.task?.questions as any[] | undefined) ?? []) if (q.status === "pending") add("question:" + q.id + ":" + q.version + ":" + JSON.stringify(q.owner), "question " + safe(q.id) + ": " + safe(q.text ?? q.question) + " \u00B7 /remote to answer");
      for (const need of (t.task?.capabilityNeeds as any[] | undefined) ?? []) add("capability:" + JSON.stringify(need), "capability request: " + detail(need) + " \u00B7 /remote to review");
      if (t.replyDelivery) for (const [id, reply] of Object.entries(t.replyDelivery)) if (reply.status === "uncertain") add("reply:" + id + ":" + reply.replyId, "answer delivery uncertain; reconcile saved reply before retrying");
      if (t.cancelRequested && !["cancelled", "done"].includes(t.task?.state ?? "")) add("cancel", "cancel requested; terminal state not yet confirmed");
      const stateName = t.task?.state;
      if (stateName === "done" || stateName === "cancelled" || (stateName === "unknown" && !t.lastError)) add("terminal:" + stateName + ":" + (stateName === "done" ? assistantText(t.events) ?? "" : ""), stateName === "done" ? "done" + (assistantText(t.events) ? "\n" + assistantText(t.events) : "") : safe(stateName));
      if (prior.size && !t.lastError && [...prior].some(key => key.startsWith("offline:"))) add("recovered", "connection recovered; state synchronized");
      for (const [key, text] of now) if (!prior.has(key)) notices.push(text);
      this.seen.set(t.taskId, new Set(now.keys()));
    }
    return notices;
  }
}
