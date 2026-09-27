import type { RemoteTask, RemoteState } from "./client";
export const safe = (value: unknown): string =>
  String(value ?? "").replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
const detail = (value: unknown) =>
  safe(
    value instanceof Error ? value.message : typeof value === "string" ? value : (JSON.stringify(value) ?? "unknown"),
  );
const obj = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? (value as Record<string, any>) : {};
export function assistantText(events: Array<{ event: unknown }> = []): string | undefined {
  for (const row of events.slice().reverse()) {
    const e = obj(row.event),
      m = obj(e.message);
    if (e.type !== "message_end" || m.role !== "assistant") continue;
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((p: any) => p?.type === "text" && typeof p.text === "string")
              .map((p: any) => p.text)
              .join("\n")
          : undefined;
    if (text) return safe(text);
  }
}
const terminal = (t: RemoteTask) => ["done", "cancelled", "failed"].includes(t.task?.state ?? "");
const replyLines = (t: RemoteTask) =>
  Object.entries(t.replyDelivery ?? {}).map(
    ([id, reply]) =>
      "Answer " +
      safe(id) +
      " (reply " +
      safe(reply.replyId) +
      "): " +
      (reply.status === "delivered"
        ? "delivered to owner (not proof it was used)"
        : "delivery uncertain; reconcile saved reply with /remote sync " + safe(t.taskId) + " before retrying"),
  );
const cancellationLine = (t: RemoteTask) =>
  t.cancelDelivery &&
  "Cancellation: " +
    (t.cancelDelivery.status === "confirmed"
      ? "request acknowledged"
      : t.cancelDelivery.status === "uncertain"
        ? "delivery uncertain"
        : "requested locally (not yet confirmed)") +
    "; observed task state: " +
    safe(t.task?.state ?? "unknown") +
    (terminal(t)
      ? " (terminal)."
      : "; /remote sync " +
        safe(t.taskId) +
        " for terminal truth" +
        (t.cancelDelivery.status === "uncertain" ? "; reconcile before retrying" : "") +
        ".");
export function taskLine(t: RemoteTask): string {
  const problems = [
    t.lastError && "offline (cached)",
    t.integrationError && "result review needed",
    obj(t.repository).status === "review" && "repository result review needed",
    t.task?.state === "blocked" && "blocked",
    t.task?.error && "failed",
    t.task?.textOutputGap && "transcript gap",
    t.transcriptComplete === false && t.task?.state === "done" && "transcript incomplete",
  ].filter(Boolean);
  const questions = (t.task?.questions as any[] | undefined)?.filter((q) => q.status === "pending") ?? [];
  if (questions.length) problems.push(questions.length + " question(s) pending");
  if ((t.task?.capabilityNeeds as any[] | undefined)?.length) problems.push("capability request pending");
  const uncertainReplies = Object.entries(t.replyDelivery ?? {}).filter(([, reply]) => reply.status === "uncertain");
  if (uncertainReplies.length)
    problems.push("answer delivery uncertain: " + uncertainReplies.map(([id]) => safe(id)).join(", "));
  if (t.cancelDelivery)
    problems.push("cancel " + safe(t.cancelDelivery.status) + (terminal(t) ? " (terminal)" : " (not terminal)"));
  else if (t.cancelRequested && !terminal(t)) problems.push("cancel requested (not terminal)");
  return (
    safe(t.taskId) +
    " \u00B7 " +
    safe(t.task?.state ?? t.outcome ?? "unknown") +
    (problems.length ? " \u00B7 " + problems.join(" \u00B7 ") : "")
  );
}
/** Display all cached rows, including unfamiliar event kinds, without protocol-only fields. */
const displayData = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(displayData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => ![
        "textSignature", "signature", "partialJson", "requestId", "rpcId", "ownerId", "epoch",
      ].includes(key)).map(([key, item]) => [key, displayData(item)]),
    );
  return value;
};
const readable = (value: unknown): string =>
  typeof value === "string" ? safe(value) : detail(displayData(value));
const contentText = (value: unknown): string => {
  if (typeof value === "string") return safe(value);
  if (!Array.isArray(value)) return value == null ? "" : readable(value);
  return value.map((part) => {
    if (typeof part === "string") return safe(part);
    const p = obj(part);
    if (p.type === "text" || p.type === "thinking") return safe(p.text ?? "");
    if (p.type === "toolCall") return "Tool call " + safe(p.name ?? "unknown") +
      (p.arguments === undefined ? "" : " " + readable(p.arguments));
    if (p.type === "image") return "[image" + (p.mimeType ? " " + safe(p.mimeType) : "") + "]";
    return readable(part);
  }).filter(Boolean).join("\n");
};
function transcriptRow(row: any): string {
  const e = obj(row.event), m = obj(e.message);
  const prefix = "#" + safe(row.seq ?? "?") + " ";
  if (e.type === "message_end" && m.role) {
    const role = m.role === "toolResult" ? "Tool result" : safe(m.role);
    const title = role === "Tool result" && m.toolName ? role + " " + safe(m.toolName) : role;
    const body = contentText(m.content);
    return prefix + title + (m.isError ? " (error)" : "") + (body ? ":\n" + body : " (empty)");
  }
  if (e.type === "tool_execution_start" || e.type === "tool_execution_end" || e.type === "tool_execution_update") {
    const name = safe(e.toolName ?? e.name ?? "unknown");
    const label = e.type === "tool_execution_start" ? "Tool call " :
      e.type === "tool_execution_end" ? "Tool finished " : "Tool update ";
    const payload = e.type === "tool_execution_start" ? e.args : e.type === "tool_execution_end" ? e.result : e.partialResult;
    const remainder = e.type === "tool_execution_start" || !obj(payload).content ? "" :
      readable(Object.fromEntries(Object.entries(obj(payload)).filter(([key]) => key !== "content")));
    return prefix + label + name + (e.isError ? " (error)" : "") +
      (payload === undefined ? "" : ":\n" + (e.type === "tool_execution_start" ? readable(payload) :
        contentText(obj(payload).content ?? payload)) + (remainder === "{}" ? "" : "\n" + remainder));
  }
  // Do not pretend unknown events are empty; retain their meaningful data in the human view.
  return prefix + safe(e.type ?? "event") +
    (Object.keys(e).length > 1 ? ": " + readable(Object.fromEntries(Object.entries(e).filter(([key]) => key !== "type"))) : "");
}
export function renderHuman(value: unknown, kind = "result"): string {
  const v = obj(value);
  if (kind === "transcript" || kind === "transcript-raw") {
    const rows = Array.isArray(v.events) ? v.events : [];
    return [
      "Remote transcript \u00B7 " + safe(v.taskId) + " \u00B7 offset " + (v.offset ?? 0),
      ...rows.map((r: any) => kind === "transcript-raw" ? "#" + safe(r.seq ?? "?") + " " + detail(r.event) : transcriptRow(r)),
      v.nextOffset !== undefined
        ? "More: /remote transcript " + safe(v.taskId) + " " + v.nextOffset + (kind === "transcript-raw" ? " raw" : "")
        : "End of cached transcript.",
      v.transcriptComplete === false && "Warning: transcript incomplete.",
      v.task?.textOutputGap && "Warning: transcript gap: " + detail(v.task.textOutputGap),
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "error" && v.error) return "Remote error: " + detail(v.error) + (v.hint ? "\n" + detail(v.hint) : "");
  if (kind === "status") {
    const tasks = Array.isArray(v.tasks) ? (v.tasks as RemoteTask[]) : [];
    const preparations = Array.isArray(v.repositoryPreparations) ? v.repositoryPreparations : [];
    return [
      "Remote \u00B7 " +
        (v.connection ? "SSH target " + safe(v.connection.host) : "not connected") +
        " (cached observations)",
      ...tasks.map(
        (t) =>
          taskLine(t) +
          (t.lastError ? "\n  " + detail(t.lastError) : "") +
          ((t.task?.questions as any[] | undefined) ?? [])
            .filter((q) => q.status === "pending")
            .map((q) => "\n  Question " + safe(q.id) + ": " + safe(q.text ?? q.question))
            .join("") +
          replyLines(t)
            .map((line) => "\n  " + line)
            .join("") +
          (cancellationLine(t) ? "\n  " + cancellationLine(t) : ""),
      ),
      ...preparations.map(
        (p: any) =>
          "Repository preparation " +
          safe(p.taskId) +
          " · " +
          (p.state === "snapshot_incomplete"
            ? "snapshot incomplete; inspect local preparation before starting a new launch"
            : p.state === "prepared_not_confirmed_launched"
              ? "prepared, launch not confirmed; reconcile with owner before retrying same task ID"
              : "state unknown; inspect local preparation") +
          (p.artifact ? " · local artifact: " + safe(p.artifact) : ""),
      ),
      tasks.length || preparations.length
        ? "Use /remote to act; /remote transcript <taskId> for saved task events."
        : "No saved tasks or repository preparations.",
    ].join("\n");
  }
  if (v.taskId) {
    const t = v as RemoteTask;
    return [
      "Remote " + taskLine(t),
      t.lastError && "Offline; cached observation: " + detail(t.lastError),
      t.integrationError && "Result review: " + detail(t.integrationError),
      obj(t.repository).status === "review" &&
        "Repository result review: " + detail(obj(t.repository).reason ?? "returned changes require review"),
      t.task?.error && "Task error: " + detail(t.task.error),
      ...replyLines(t),
      cancellationLine(t),
      t.transcriptComplete === false && "Warning: transcript incomplete.",
      t.task?.state === "done" && (v.finalAssistantText || assistantText(t.events)),
      "Last synchronized state, not live status. /remote transcript " + safe(t.taskId) + " for full events.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "connect") return "Remote connected to " + safe(v.host) + ". " + safe(v.scope ?? "");
  return detail(value);
}
/** Attention is identified by durable subject, not the changing poll payload. */
export class RemoteAttention {
  private emitted = new Set<string>();
  private connections = new Map<string, { offline: boolean; transition: number }>();

  reset(): void {
    this.emitted.clear();
    this.connections.clear();
  }

  restore(keys: Iterable<string>): void {
    for (const key of keys) {
      this.emitted.add(key);
      try {
        const [id, subject] = JSON.parse(key);
        const match = /^connection:(\d+):(offline|recovered)$/.exec(subject);
        if (match && Number(match[1]) > (this.connections.get(id)?.transition ?? 0))
          this.connections.set(id, { offline: match[2] === "offline", transition: Number(match[1]) });
      } catch {
        /* Ignore unrelated/old session entries. */
      }
    }
  }

  connection(id: string, offline: boolean, error?: unknown, onEmit?: (key: string) => void): string[] {
    const prior = this.connections.get(id);
    if ((!prior && !offline) || prior?.offline === offline) return [];
    const transition = (prior?.transition ?? 0) + 1;
    this.connections.set(id, { offline, transition });
    const key = JSON.stringify([id, "connection:" + transition + ":" + (offline ? "offline" : "recovered")]);
    this.emitted.add(key);
    onEmit?.(key);
    return [
      "Remote " +
        safe(id) +
        " · " +
        (offline
          ? "offline; cached state only" + (error ? ": " + detail(error) : "")
          : "connection recovered; state synchronized"),
    ];
  }

  update(
    state: RemoteState,
    onEmit?: (key: string) => void,
    suppressTerminal?: (task: RemoteTask) => boolean,
  ): string[] {
    const notices: string[] = [];
    for (const t of Object.values(state.tasks)) {
      const id = t.taskId;
      const add = (subject: string, text: string) => {
        const key = JSON.stringify([id, subject]);
        if (this.emitted.has(key)) return;
        this.emitted.add(key);
        onEmit?.(key);
        notices.push("Remote " + safe(id) + " · " + text);
      };
      notices.push(...this.connection(id, !!t.lastError, t.lastError, onEmit));
      if (obj(t.repository).status === "review")
        add(
          "repository-review:" + (obj(t.repository).artifact ?? ""),
          "repository result review needed: " + detail(obj(t.repository).reason ?? "returned changes require review"),
        );
      if (t.task?.state === "blocked")
        add("blocked", "blocked; /remote to review pending questions or capability requests");
      if (t.integrationError)
        add("review:" + t.integrationError, "result review needed: " + detail(t.integrationError));
      if (t.task?.error && !["failed", "unknown"].includes(t.task.state))
        add("error:" + t.task.error, "failed: " + detail(t.task.error));
      if (t.task?.textOutputGap) add("gap:" + t.task.textOutputGap, "transcript gap: " + detail(t.task.textOutputGap));
      for (const q of (t.task?.questions as any[] | undefined) ?? [])
        if (q.status === "pending")
          add(
            "question:" + q.id + ":" + q.version + ":" + JSON.stringify(q.owner),
            "question " + safe(q.id) + ": " + safe(q.text ?? q.question) + " · /remote to answer",
          );
      for (const need of (t.task?.capabilityNeeds as any[] | undefined) ?? [])
        add(
          "capability:" + (need?.id ?? need?.requestId ?? JSON.stringify([need?.kind, need?.input])),
          "capability request: " +
            safe(need?.kind ?? "local access") +
            (need?.input ? " · " + safe(need.input) : "") +
            " · /remote to review",
        );
      if (t.replyDelivery)
        for (const [questionId, reply] of Object.entries(t.replyDelivery))
          if (reply.status === "uncertain")
            add(
              "reply:" + questionId + ":" + reply.replyId,
              "answer delivery uncertain; reconcile saved reply before retrying",
            );
      if (t.cancelRequested && !["cancelled", "done", "failed"].includes(t.task?.state ?? ""))
        add("cancel", "cancel requested; terminal state not yet confirmed");
      const stateName = t.task?.state;
      if (
        ["done", "cancelled", "failed", "unknown"].includes(stateName ?? "") &&
        !(stateName === "unknown" && t.lastError)
      ) {
        const final = stateName === "done" ? assistantText(t.events) : undefined;
        const terminalKey = "terminal:" + stateName + ":" + (final ?? t.task?.error ?? "");
        if (suppressTerminal?.(t)) {
          // A pre-existing cached result is a baseline, not an event in this session.
          this.emitted.add(JSON.stringify([id, terminalKey]));
          continue;
        }
        add(
          terminalKey,
          stateName === "done"
            ? "done" + (final ? "\n" + final : "")
            : safe(stateName) + (t.task?.error ? ": " + detail(t.task.error) : ""),
        );
      }
    }
    return notices;
  }
}

/** Compact summary of saved attention, including terminal tasks needing human review. */
export function remoteStatus(state: RemoteState, unavailable = false): string | undefined {
  const tasks = Object.values(state.tasks);
  const active = tasks.filter((t) => ["accepted", "running"].includes(t.task?.state ?? ""));
  const pending = tasks.reduce(
    (n, t) => n + ((t.task?.questions as any[] | undefined) ?? []).filter((q) => q.status === "pending").length,
    0,
  );
  const review = tasks.filter(
    (t) =>
      !!t.integrationError ||
      obj(t.repository).status === "review" ||
      t.task?.state === "blocked" ||
      !!t.task?.textOutputGap ||
      (t.transcriptComplete === false && t.task?.state === "done") ||
      !!t.task?.error ||
      t.task?.state === "failed" ||
      (!!t.task?.capabilityNeeds && (t.task.capabilityNeeds as any[]).length > 0) ||
      Object.values(t.replyDelivery ?? {}).some((r) => r.status === "uncertain") ||
      (!!t.cancelRequested && !["done", "cancelled", "failed"].includes(t.task?.state ?? "")),
  ).length;
  const offline = unavailable || tasks.some((t) => !!t.lastError);
  return active.length || pending || review || offline
    ? "remote: " +
        [
          active.length && active.length + " active",
          pending && pending + " question(s)",
          review && review + " review",
          offline && "offline (cached)",
        ]
          .filter(Boolean)
          .join(" · ")
    : undefined;
}
