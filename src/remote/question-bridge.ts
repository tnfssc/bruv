import type { RemoteState, RemoteTask } from "./client";
import type { QuestionService, Question, QuestionContext, QuestionOwner } from "../questions/service";

/** This is a trusted human-route dependency, not an execute/agent tool. */
export type RemoteQuestionClient = {
  read(): Promise<RemoteState>;
  control(request: Record<string, unknown>, expected?: { ownerId: string; epoch: string }): Promise<unknown>;
};
type NativeQuestion = Pick<
  Question,
  "id" | "owner" | "version" | "text" | "status" | "choices" | "allowFreeText" | "reason" | "replyId" | "delivery"
>;
function nativeQuestion(value: unknown): NativeQuestion | undefined {
  if (!value || typeof value !== "object") return;
  const q = value as Question;
  if (
    q.readOnly ||
    !/^q_[0-9a-f-]{36}$/.test(q.id) ||
    !q.owner ||
    typeof q.owner.sessionId !== "string" ||
    !q.owner.sessionId ||
    typeof q.owner.branchId !== "string" ||
    !q.owner.branchId ||
    !Number.isSafeInteger(q.version) ||
    q.version < 1 ||
    typeof q.text !== "string" ||
    !q.text.trim() ||
    q.text.length > 8000 ||
    !["pending", "answered", "resolved", "cancelled"].includes(q.status) ||
    (q.allowFreeText !== undefined && typeof q.allowFreeText !== "boolean") ||
    (q.choices !== undefined &&
      (!Array.isArray(q.choices) ||
        q.choices.length > 20 ||
        q.choices.some((c) => typeof c !== "string" || !c.trim() || c.length > 1000))) ||
    (q.reason !== undefined && (typeof q.reason !== "string" || q.reason.length > 2000))
  )
    return;
  return q;
}
function questions(task: RemoteTask): NativeQuestion[] {
  const value = task.task?.questions;
  return Array.isArray(value) ? value.map(nativeQuestion).filter((q): q is NativeQuestion => !!q) : [];
}
function sameOwner(a: QuestionOwner, b: QuestionOwner) {
  return a.sessionId === b.sessionId && a.branchId === b.branchId;
}

function samePinnedOwner(remote: Question["remote"], task: RemoteTask): boolean {
  return !!remote && remote.host === task.host && remote.ownerId === task.ownerId && remote.epoch === task.epoch;
}

/** Mirrors real human ledgers only. Child clarification belongs in parent context, not here. */
export class RemoteQuestionBridge {
  constructor(
    readonly service: QuestionService,
    readonly client: RemoteQuestionClient,
  ) {}
  async sync(ctx: QuestionContext, state?: RemoteState): Promise<void> {
    const file = ctx.sessionManager.getSessionFile();
    if (!file || !ctx.sessionManager.getLeafId()) return;
    state ??= await this.client.read();
    const mirrors = this.service.list(ctx);
    for (const task of Object.values(state.tasks)) {
      if (task.jobSessionFile !== file || !task.host || !task.ownerId || !task.epoch) continue;
      const parentOwner = task.jobQuestionOwner;
      if (
        parentOwner &&
        (parentOwner.sessionId !== ctx.sessionManager.getSessionId() ||
          !ctx.sessionManager.getBranch().some((e) => e.id === parentOwner.branchId))
      )
        continue;
      await this.reflectQuestions(
        ctx,
        task,
        mirrors.filter((m) => m.remote?.taskId === task.taskId && samePinnedOwner(m.remote, task)),
        parentOwner,
      );
      await this.reconcileDeliveredReply(ctx, task);
    }
  }

  private async reflectQuestions(
    ctx: QuestionContext,
    task: RemoteTask,
    existing: Question[],
    parentOwner?: QuestionOwner,
  ): Promise<void> {
    for (const q of questions(task)) {
      // Import pending questions, but only update already-mirrored closed questions.
      if (q.status !== "pending" && !existing.some((m) => m.remote?.id === q.id && sameOwner(m.remote.owner, q.owner)))
        continue;
      await this.service.reflectRemote(
        ctx,
        {
          taskId: task.taskId,
          host: task.host,
          ownerId: task.ownerId,
          epoch: task.epoch,
          id: q.id,
          owner: q.owner,
          version: q.version,
          taskState: task.task?.state,
        },
        q,
        parentOwner,
      );
    }
  }

  private async reconcileDeliveredReply(ctx: QuestionContext, task: RemoteTask): Promise<void> {
    // The owner receipt reconciles a lost answer response; never infer from transcript text.
    const receipt = task.task?.reply as { replyId?: string; status?: string } | undefined;
    if (receipt?.status !== "delivered") return;
    // Read after projection: native snapshots may have changed the local reply state.
    for (const m of this.service.list(ctx)) {
      if (
        !m.readOnly &&
        m.remote?.taskId === task.taskId &&
        samePinnedOwner(m.remote, task) &&
        m.replyId !== undefined &&
        m.replyId === receipt.replyId &&
        m.remote.replyState === "uncertain"
      )
        await this.service.finishRemoteReply(ctx, { ...m, replyId: m.replyId, delivered: true });
    }
  }
  /** Only call after QuestionService.answer from the explicit /questions human route. */
  async dispatch(ctx: QuestionContext, id: string, options: { retry?: boolean } = {}): Promise<Question> {
    await this.sync(ctx);
    let q = this.service.get(ctx, id);
    if (q.readOnly || !q.remote || q.answeredFrom !== "cli" || !q.replyId || !q.answer)
      throw new Error("No explicit human remote reply on this parent branch");
    if (q.remote.replyState === "delivered") return q;
    if (q.remote.replyState !== "saved" && !(options.retry && q.remote.replyState === "uncertain"))
      throw new Error("Remote answer outcome uncertain; reconnect to reconcile the ledger. No duplicate answer sent.");
    const state = await this.client.read(),
      task = state.tasks[q.remote.taskId];
    if (!task || task.jobSessionFile !== ctx.sessionManager.getSessionFile() || !samePinnedOwner(q.remote, task))
      throw new Error("Pinned remote question owner unavailable; human reply remains saved");
    const savedRemote = q.remote;
    const pending = questions(task).find((r) => r.id === savedRemote.id && sameOwner(r.owner, savedRemote.owner));
    if (q.remote.replyState === "saved" && (pending?.status !== "pending" || pending.version !== q.remote.version))
      throw new Error("Remote question owner/version changed; saved human reply was not retargeted or sent");
    if (q.remote.replyState === "saved") q = await this.service.claimRemoteReply(ctx, q);
    // Explicit human resume replays ONLY the same immutable request/replyId.
    // The owner receipt is authoritative and will not dispatch an uncertain command twice.
    const remote = q.remote;
    if (!remote || !q.answer || !q.replyId) throw new Error("Claimed remote reply is missing its saved identity");
    try {
      const response = await this.client.control(
        {
          op: "answer",
          taskId: remote.taskId,
          id: remote.id,
          owner: remote.owner,
          version: remote.version,
          text: q.answer,
          replyId: q.replyId,
        },
        { ownerId: remote.ownerId, epoch: remote.epoch },
      );
      const receipt = (response as { task?: { taskId?: string; reply?: { replyId?: string; status?: string } } })?.task;
      return await this.service.finishRemoteReply(ctx, {
        ...q,
        replyId: q.replyId,
        delivered:
          receipt?.taskId === remote.taskId &&
          receipt.reply?.replyId === q.replyId &&
          receipt.reply?.status === "delivered",
      });
    } catch (error) {
      await this.service.finishRemoteReply(ctx, { ...q, replyId: q.replyId, delivered: false, error: String(error) });
      throw new Error(`Remote answer outcome uncertain; saved reply identity retained. ${String(error)}`);
    }
  }
}

// The existing remote extension's poll feeds the parent questions projection.
// Key by SessionManager (extension API objects are not necessarily shared).
const observers = new WeakMap<object, (state: RemoteState) => Promise<void>>();
export function observeRemoteQuestions(manager: object, observer?: (state: RemoteState) => Promise<void>): void {
  if (observer) observers.set(manager, observer);
  else observers.delete(manager);
}
export async function publishRemoteQuestionState(ctx: QuestionContext, state: RemoteState): Promise<void> {
  await observers.get(ctx.sessionManager)?.(state);
}
