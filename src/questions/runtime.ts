import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentMainToolOwner } from "../live/main-owner";
import { QuestionService, questionBranchIds, type Question } from "./service";
import { RemoteQuestionBridge, observeRemoteQuestions, type RemoteQuestionClient } from "../remote/question-bridge";
import type { RemoteState } from "../remote/client";
import type { QuestionCommands } from "./extension";

/** Explicit native frontend lease; never exposed as an agent tool. */
export const NATIVE_QUESTION_ACCESS = "bruv:questions:native-access";
export interface NativeQuestionAccess {
  context: ExtensionContext;
  accept(commands: QuestionCommands, release: () => void): void;
}

/** A reply starts a new parent turn. It never holds or revives an execute stack. */
type QueuedAnswer = { question: Question; manager: object; leaf: string | null; epoch: number };

/** Owns local parent-turn delivery, including the session fence and durable replay claim. */
class ParentQuestionContinuations {
  private activeContext: ExtensionContext | undefined;
  private epoch = 0;
  private stopped = false;
  private closed = false;
  private continuationPending = false;
  private flushing = false;
  private readonly queued = new Map<string, QueuedAnswer>();
  private readonly delivered = new Set<string>();
  private readonly createdHere = new Set<string>();
  private readonly maxQueued = 20; // The ledger admits at most twenty pending questions.

  constructor(
    private readonly pi: Pick<ExtensionAPI, "sendMessage">,
    private readonly service: QuestionService,
    private readonly supported: () => boolean,
    private readonly hasMainToolOwner: (manager: object) => boolean,
    private readonly changed: () => void,
  ) {}

  get context() {
    return this.activeContext;
  }

  attach(ctx: ExtensionContext, navigation = false): boolean {
    // Only navigation events can replace the active manager. A late callback from
    // an old session must never re-attach it and dispatch into the new session.
    if (this.closed && !navigation) return false;
    if (navigation) this.closed = false;
    if (this.activeContext && this.activeContext.sessionManager !== ctx.sessionManager) {
      if (!navigation) return false;
      this.epoch++;
      this.queued.clear();
      this.delivered.clear();
      this.createdHere.clear();
      this.stopped = false;
    }
    this.activeContext = ctx;
    return true;
  }

  pause() {
    this.stopped = true;
    this.continuationPending = false;
    this.epoch++;
    this.queued.clear();
    // A later human turn may ask new questions, but it does not reauthorize
    // automatic delivery of answers owned by the interrupted work.
    this.createdHere.clear();
    this.changed();
  }

  humanTurnAccepted() {
    this.stopped = false;
  }

  treeNavigated() {
    this.stopped = false;
    this.changed();
  }

  agentStarted() {
    this.continuationPending = false;
  }

  shutdown() {
    this.pause();
    this.closed = true;
    const previous = this.activeContext;
    this.activeContext = undefined;
    this.delivered.clear();
    this.createdHere.clear();
    return previous;
  }

  questionCreated(question: Question) {
    if (!this.stopped) this.createdHere.add(question.id);
  }

  private replyKey(q: Question) {
    return q.replyId ?? `${q.id}:${q.version}`;
  }

  private project(q: Question): Question {
    return q.status === "answered" && q.delivery === "queued" && !this.queued.has(this.replyKey(q))
      ? { ...q, delivery: "resume-needed" }
      : q;
  }

  projectResult(value: Question | Question[]) {
    return Array.isArray(value) ? value.map((q) => this.project(q)) : this.project(value);
  }

  hasBlockingQuestions() {
    const ctx = this.activeContext;
    if (!ctx || !this.supported()) return false;
    if (this.continuationPending || this.queued.size) return true;
    try {
      return this.service
        .list(ctx)
        .some(
          (q) => !q.readOnly && (q.status === "pending" || q.status === "cancelled") && q.blocked?.foreground === true,
        );
    } catch {
      return true;
    }
  }

  private async recordDelivery(
    ctx: ExtensionContext,
    q: Question,
    delivery: "resume-needed" | "queued" | "dispatching" | "delivered",
  ) {
    const latest = this.service.get(ctx, q.id);
    if (latest.status !== "answered" || latest.readOnly) throw new Error("Answer no longer active");
    return this.service.setDelivery(ctx, { id: latest.id, owner: latest.owner, version: latest.version, delivery });
  }

  async answerSaved(ctx: ExtensionContext, question: Question) {
    const key = this.replyKey(question);
    if (
      !this.stopped &&
      this.createdHere.has(question.id) &&
      this.supported() &&
      this.activeContext?.sessionManager === ctx.sessionManager &&
      !this.delivered.has(key)
    ) {
      if (!this.queued.has(key) && this.queued.size >= this.maxQueued) {
        this.changed();
        return;
      }
      const answerEpoch = this.epoch;
      try {
        question = await this.recordDelivery(ctx, question, "queued");
      } catch {
        this.changed();
        return;
      }
      if (answerEpoch !== this.epoch || this.stopped || this.activeContext?.sessionManager !== ctx.sessionManager) {
        this.changed();
        return;
      }
      this.queued.set(key, {
        question,
        manager: ctx.sessionManager,
        leaf: ctx.sessionManager.getLeafId(),
        epoch: this.epoch,
      });
      if (this.activeContext?.sessionManager === ctx.sessionManager) queueMicrotask(() => this.flush());
    }
    this.changed();
  }

  async resume(ctx: ExtensionContext, question: Question) {
    if (question.readOnly) throw new Error("Question belongs to the original branch; this is history only.");
    if (question.status !== "answered") throw new Error("Only a saved answer can be resumed.");
    const key = this.replyKey(question);
    if (question.delivery === "dispatching")
      throw new Error(
        "Answer delivery is uncertain. Check the parent chat before continuing; this reply will not be sent twice.",
      );
    if (this.delivered.has(key) || question.delivery === "delivered")
      throw new Error(
        "This reply was already sent to a parent turn. Read its result or continue in chat; do not replay it.",
      );
    if (!this.queued.has(key) && this.queued.size >= this.maxQueued)
      throw new Error("Too many queued answers; let the agent settle first.");
    await this.recordDelivery(ctx, question, "queued");
    this.stopped = false;
    this.queued.set(key, {
      question,
      manager: ctx.sessionManager,
      leaf: ctx.sessionManager.getLeafId(),
      epoch: this.epoch,
    });
    queueMicrotask(() => this.flush());
    return question;
  }

  private belongsToSession(ctx: ExtensionContext, item: QueuedAnswer) {
    return (
      this.activeContext?.sessionManager === ctx.sessionManager &&
      item.epoch === this.epoch &&
      item.manager === ctx.sessionManager &&
      item.question.owner.sessionId === ctx.sessionManager.getSessionId() &&
      (!item.leaf || questionBranchIds(ctx.sessionManager).includes(item.leaf))
    );
  }

  private async dispatchAnswer(ctx: ExtensionContext, key: string, item: QueuedAnswer) {
    this.continuationPending = true;
    try {
      // Durable claim before the host side effect. A crash between claim and
      // acknowledgement is uncertain, never permission to replay the reply.
      await this.recordDelivery(ctx, item.question, "dispatching");
      if (
        !this.belongsToSession(ctx, item) ||
        this.stopped ||
        !ctx.isIdle() ||
        this.hasMainToolOwner(ctx.sessionManager)
      ) {
        await this.recordDelivery(ctx, item.question, "resume-needed");
        this.continuationPending = false;
        this.changed();
        return;
      }
      this.delivered.add(key);
      const oldest = this.delivered.values().next().value;
      if (this.delivered.size > 220 && oldest !== undefined) this.delivered.delete(oldest);
      this.continuationPending = true;
      this.pi.sendMessage(
        {
          customType: "question-answer",
          display: false,
          content:
            "Saved answer for " +
            item.question.id +
            ":\n" +
            JSON.stringify(item.question) +
            "\nUse this saved reply in a new parent turn. Do not replay prior tool calls or resume a native child in place.",
          details: { questionId: item.question.id, replyKey: key, owner: item.question.owner },
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
      await this.recordDelivery(ctx, item.question, "delivered");
    } catch {
      // dispatching stays visible as uncertain. No automatic or blind manual
      // retry can duplicate a host turn that may already have been accepted.
    }
    this.changed();
  }

  async flush() {
    const ctx = this.activeContext;
    if (
      this.flushing ||
      !ctx ||
      this.stopped ||
      !this.supported() ||
      !ctx.isIdle() ||
      this.hasMainToolOwner(ctx.sessionManager)
    )
      return;
    this.flushing = true;
    try {
      for (const [key, item] of this.queued) {
        const eligible = this.belongsToSession(ctx, item);
        this.queued.delete(key);
        if (!eligible) continue;
        await this.dispatchAnswer(ctx, key, item);
        return;
      }
    } finally {
      this.flushing = false;
    }
  }
}

export function registerQuestionRuntime(
  pi: ExtensionAPI,
  options: {
    supported: () => boolean;
    nativeSupported?: () => boolean;
    hasMainToolOwner?: (manager: object) => boolean;
  },
) {
  const service = new QuestionService();
  let remoteBridge: RemoteQuestionBridge | undefined;
  let nativeManager: object | undefined;
  let lastStopReason: string | undefined;
  const supported = () =>
    options.supported() || (nativeManager !== undefined && nativeManager === continuations.context?.sessionManager);
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const continuations = new ParentQuestionContinuations(
    pi,
    service,
    supported,
    options.hasMainToolOwner ?? ((manager: object) => !!currentMainToolOwner(manager)),
    changed,
  );
  service.onAsked = (q) => continuations.questionCreated(q);
  service.onAnswered = async (question, raw) => {
    const ctx = raw as ExtensionContext;
    if (!question.remote) return continuations.answerSaved(ctx, question);
    try {
      if (!remoteBridge || !supported() || continuations.context?.sessionManager !== ctx.sessionManager)
        throw new Error("Remote reply saved; parent remote bridge is not active");
      await remoteBridge.dispatch(ctx, question.id);
    } finally {
      changed();
    }
  };
  const attach = (ctx: ExtensionContext, navigation = false): boolean => {
    const previous = continuations.context;
    if (!continuations.attach(ctx, navigation)) return false;
    if (previous && previous.sessionManager !== ctx.sessionManager) observeRemoteQuestions(previous.sessionManager);
    observeRemoteQuestions(ctx.sessionManager, async (state) => {
      if (continuations.context?.sessionManager !== ctx.sessionManager || !supported()) return;
      try {
        await remoteBridge?.sync(ctx, state);
      } finally {
        changed();
      }
    });
    return true;
  };
  pi.on("session_start", async (_event, ctx) => {
    attach(ctx, true);
    lastStopReason = undefined;
    if (supported()) {
      try {
        await remoteBridge?.sync(ctx);
      } catch {
        /* Keep the durable projection offline. */
      }
    }
    changed();
  });
  pi.on("session_tree", (_event, ctx) => {
    continuations.pause();
    attach(ctx, true);
    continuations.treeNavigated();
    lastStopReason = undefined;
  });
  pi.on("input", (event, ctx) => {
    if (event.source !== "extension" && attach(ctx)) continuations.humanTurnAccepted();
  });
  pi.on("before_agent_start", (_event, ctx) => {
    if (attach(ctx)) continuations.agentStarted();
  });
  pi.on("agent_start", (_event, ctx) => {
    // Saved-answer turns enter through sendMessage and skip before_agent_start.
    if (attach(ctx)) continuations.agentStarted();
    lastStopReason = undefined;
  });
  pi.on("agent_end", (event, ctx) => {
    if (!attach(ctx)) return;
    const last = [...event.messages].reverse().find((message) => message.role === "assistant");
    lastStopReason = last?.stopReason;
    if (ctx.signal?.aborted || last?.stopReason === "aborted") continuations.pause();
  });
  pi.on("agent_settled", (event, ctx) => {
    if (!attach(ctx)) return;
    // Pi emits agent_end before automatic retries. Keep queued replies while
    // recovery is possible; only final failure or Stop revokes their delivery.
    if (event.aborted || ctx.signal?.aborted || lastStopReason === "error") continuations.pause();
    else continuations.flush();
  });
  pi.on("session_shutdown", () => {
    nativeManager = undefined;
    const previous = continuations.shutdown();
    if (previous) observeRemoteQuestions(previous.sessionManager);
    listeners.clear();
  });
  const runtime = {
    service,
    /** Wire the SAME client used by the normal SSH jobs adapter; no host selection here. */
    configureRemote(client: RemoteQuestionClient) {
      remoteBridge = new RemoteQuestionBridge(service, client);
    },
    async syncRemote(ctx: ExtensionContext, state?: RemoteState) {
      if (!attach(ctx) || !supported()) return;
      await remoteBridge?.sync(ctx, state);
      changed();
    },
    pause: () => continuations.pause(),
    /** Explicit human work commands can start turns without a Pi input event. */
    acceptHumanWork(ctx: ExtensionContext) {
      if (!attach(ctx)) throw new Error("Question session is no longer active.");
      continuations.humanTurnAccepted();
    },
    hasBlockingQuestions: () => continuations.hasBlockingQuestions(),
    async handle(ctx: ExtensionContext, method: string, params: unknown) {
      if (!attach(ctx)) throw new Error("Question session is no longer active.");
      if (!supported())
        throw new Error(
          "Persistent questions need the parent CLI session. Web projection and child in-place replies are not supported; ask the parent to record the question.",
        );
      if (method === "questions.answer")
        throw new Error(
          "Answer in /questions answer <id> <text>. Tool or voice transcript text is not a targeted user reply.",
        );
      await remoteBridge?.sync(ctx);
      const result = await service.handle(method, params, ctx);
      changed();
      return continuations.projectResult(result);
    },
    commands(ctx: ExtensionContext) {
      if (!attach(ctx)) throw new Error("Question session is no longer active.");
      return {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        async handle(method: string, params: Record<string, unknown> = {}) {
          if (continuations.context?.sessionManager !== ctx.sessionManager)
            throw new Error("Question session is no longer active.");
          if (!supported()) throw new Error("Questions are supported in the parent CLI session only.");
          await remoteBridge?.sync(ctx);
          if (method === "questions.answer" || method === "questions.cancel" || method === "questions.resume") {
            const q = service.get(ctx, String(params.id));
            if (
              params.version !== undefined &&
              (q.version !== params.version ||
                JSON.stringify(q.owner) !== JSON.stringify(params.owner) ||
                q.status !== "pending")
            )
              throw new Error("Question changed while open; reopen /questions to answer the current question.");
            if (method === "questions.resume" && q.remote) {
              if (!remoteBridge) throw new Error("Parent remote bridge is not active");
              try {
                return await remoteBridge.dispatch(ctx, q.id, { retry: true });
              } finally {
                changed();
              }
            }
            if (method === "questions.resume") {
              return continuations.resume(ctx, q);
            }
            const version = method === "questions.answer" && q.status === "answered" ? q.replyVersion : q.version;
            if (version === undefined) throw new Error("Answered question is missing its reply version");
            const input = {
              id: q.id,
              owner: q.owner,
              version,
            };
            const result =
              method === "questions.answer"
                ? await service.answer(ctx, {
                    ...input,
                    text: String(params.answer ?? ""),
                    ...(q.replyId ? { replyId: q.replyId } : {}),
                  })
                : await service.cancel(ctx, input);
            changed();
            return q.remote ? service.get(ctx, q.id) : result;
          }
          return continuations.projectResult(await service.handle(method, params, ctx));
        },
      };
    },
  };
  pi.events?.on(NATIVE_QUESTION_ACCESS, (value: unknown) => {
    const request = value as NativeQuestionAccess;
    if (!options.nativeSupported?.() || !request?.context || typeof request.accept !== "function") return;
    if (!attach(request.context) || nativeManager) return;
    const manager = request.context.sessionManager;
    nativeManager = manager;
    try {
      request.accept(runtime.commands(request.context), () => {
        if (nativeManager === manager) nativeManager = undefined;
      });
    } catch (error) {
      nativeManager = undefined;
      throw error;
    }
  });
  return runtime;
}
