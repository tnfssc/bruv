import type { Question as SavedQuestion } from "./service";
import { QuestionPicker } from "./picker";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The service owns persistence, scope and authorization; UI only presents a view. */
export interface QuestionCommands {
  handle(method: string, params?: Record<string, unknown>): unknown | Promise<unknown>;
  subscribe?(listener: () => void): () => void;
}
type Question = Partial<SavedQuestion> & Pick<SavedQuestion, "id" | "text">;

const STALE_EXTENSION_CONTEXT = "This extension ctx is stale after session replacement or reload.";

function isStaleExtensionContext(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(STALE_EXTENSION_CONTEXT);
}

function records(value: unknown): Question[] {
  return Array.isArray(value) ? (value as Question[]) : [];
}

function shortId(question: Question, all: Question[]): string {
  const prefix = question.id.slice(0, 10);
  return all.filter((entry) => entry.id.startsWith(prefix)).length === 1 ? prefix : question.id;
}

function renderQuestion(question: Question, id = question.id): string {
  return [
    id,
    question.status
      ? "[" +
        question.status +
        (question.readOnly
          ? "; history only"
          : question.blocked && question.status === "pending"
            ? "; waiting on you"
            : "") +
        "]"
      : "",
    question.text,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Describe saved intent separately from delivery; a remote observation is not a human reply. */
function renderAnswerDelivery(question: Question, displayId: string): string | undefined {
  if (question.status !== "answered") return undefined;
  if (question.remote && !question.answer) return "Remote ledger says answered; no local human reply inferred.";
  switch (question.delivery) {
    case "dispatching":
      return question.remote
        ? "Human answer saved · remote delivery uncertain; reconnect to reconcile. No duplicate answer will be sent."
        : "Answer saved · delivery uncertain; check parent chat";
    case "delivered":
      return question.remote ? "Human answer delivered to pinned remote owner" : "Answer sent to parent";
    case "queued":
      return "Answer saved · waiting for parent";
    default:
      return `Answer saved · /questions resume ${displayId}`;
  }
}

function renderQuestionDetail(question: Question, displayId: string): string {
  return [
    renderQuestion(question, displayId),
    question.requester && `Requester: ${question.requester}`,
    question.remote &&
      "Remote ledger: " +
        question.remote.host +
        " · " +
        question.remote.taskId +
        " · " +
        question.remote.id +
        " v" +
        question.remote.version,
    question.reason && `Why: ${question.reason}`,
    question.choices?.length &&
      "Choices: " +
        question.choices.join(" | ") +
        (question.allowFreeText === false ? " (pick one)" : " (or your own answer)"),
    question.blocked &&
      "Blocked follow-up: " +
        [question.blocked.foreground ? "parent" : "", ...(question.blocked.taskIds ?? [])].filter(Boolean).join(", ") +
        " — " +
        question.blocked.checkpoint,
    question.answer && `Answer: ${question.answer}`,
    question.status === "cancelled" &&
      question.blocked &&
      "Cancelled; follow-up needs a new plan, not a guessed answer.",
    renderAnswerDelivery(question, displayId),
    question.resolutionReason && `Closed: ${question.resolutionReason}`,
    question.taskIds?.length &&
      "Tasks: " +
        question.taskIds.join(", ") +
        (question.remote
          ? ". Reply is human-only through the pinned remote ledger."
          : ". Child in-place replies are not supported."),
  ]
    .filter(Boolean)
    .join("\n");
}

function pick(
  ctx: ExtensionContext,
  title: string,
  items: { value: string; label: string; description?: string }[],
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>(
    (tui, theme, keys, done) =>
      new QuestionPicker(
        title,
        items,
        theme,
        keys,
        done,
        () => tui.requestRender(),
        () => tui.terminal.rows,
      ),
  );
}

/** Escape returns to the inbox; an empty or cancelled editor stays on this question. */
async function promptAnswer(ctx: ExtensionContext, question: Question): Promise<string | undefined> {
  const options = (question.choices ?? []).map((choice, index) => ({ value: String(index), label: choice }));
  if (question.allowFreeText !== false) options.push({ value: "write", label: "Write an answer…" });
  while (true) {
    const selected = options.length ? await pick(ctx, question.text, options) : undefined;
    if (selected === undefined) return undefined;
    const answer = selected === "write" ? await ctx.ui.editor(question.text) : question.choices?.[Number(selected)];
    if (answer?.trim()) return answer.trim();
  }
}

/** No modal, focus transfer or repeated notification on background changes. */
export function registerQuestions(
  pi: ExtensionAPI,
  getService: (ctx: ExtensionContext) => QuestionCommands,
): { refresh: () => Promise<void> } {
  let context: ExtensionContext | undefined;
  let unsubscribe: (() => void) | undefined;
  let subscribed: QuestionCommands | undefined;
  let generation = 0;
  const refresh = async () => {
    const current = context;
    if (!current) return;
    // No-history sessions cannot own durable questions. This is not a storage failure.
    if (current.sessionManager?.getSessionFile && !current.sessionManager.getSessionFile()) {
      current.ui.setStatus("bruv-questions", undefined);
      return;
    }
    const token = generation;
    try {
      const service = getService(current);
      if (subscribed !== service) {
        unsubscribe?.();
        subscribed = service;
        unsubscribe = service.subscribe?.(() => {
          void refresh();
        });
      }
      const open = records(await service.handle("questions.list", {})).filter(
        (question) =>
          !question.readOnly &&
          (!question.status ||
            question.status === "pending" ||
            question.status === "answered" ||
            (question.status === "cancelled" && !!question.blocked)),
      );
      const saved = open.filter((q) => q.status === "answered").length;
      const waiting = open.some((q) => q.status !== "answered" && q.blocked);
      const cancelled = open.some((q) => q.status === "cancelled" && q.blocked);
      if (token === generation && context === current)
        current.ui.setStatus(
          "bruv-questions",
          open.length
            ? open.length +
                " question" +
                (open.length === 1 ? "" : "s") +
                (saved ? ` · ${saved} saved` : cancelled ? "" : " pending") +
                (waiting ? (cancelled ? " · follow-up blocked" : " · waiting on you") : "")
            : undefined,
        );
    } catch {
      // Commands report errors; background refresh must not create notice spam.
      if (token === generation && context === current) {
        try {
          current.ui.setStatus("bruv-questions", "/questions unavailable");
        } catch (statusError) {
          // Pi invalidates a command context as soon as a session is replaced,
          // before its shutdown hook necessarily runs. Ignore only that lifecycle error.
          if (!isStaleExtensionContext(statusError)) throw statusError;
        }
      }
    }
  };

  const resolveId = async (service: QuestionCommands, id: string): Promise<string> => {
    if (id.length < 8) return id;
    const matches = records(await service.handle("questions.list", {})).filter((q) => q.id.startsWith(id));
    if (matches.some((q) => q.id === id)) return id;
    if (matches.length > 1) throw new Error("Question ID is ambiguous; use more characters from /questions.");
    return matches[0]?.id ?? id;
  };

  const inbox = async (ctx: ExtensionContext, service: QuestionCommands) => {
    while (true) {
      const all = records(await service.handle("questions.list", {}));
      const pending = all.filter((q) => q.status === "pending" && !q.readOnly);
      if (!pending.length) {
        ctx.ui.notify("No unanswered questions", "info");
        return;
      }
      const id = await pick(
        ctx,
        `Questions · ${pending.length} unanswered`,
        pending.map((q) => ({
          value: q.id,
          label: q.text,
          description: q.reason,
        })),
      );
      if (!id) return;
      const question = pending.find((item) => item.id === id);
      if (!question) continue;
      const answer = await promptAnswer(ctx, question);
      if (answer === undefined) continue;
      // Submit the displayed snapshot. The runtime checks its owner/version before accepting a reply.
      await service.handle("questions.answer", {
        id: question.id,
        answer,
        owner: question.owner,
        version: question.version,
      });
      await refresh();
    }
  };

  pi.registerCommand("questions", {
    getArgumentCompletions: async (prefix) => {
      const verbs = ["list", "detail", "answer", "cancel", "resume"];
      const parts = prefix.match(/^(\S+)\s+(.*)$/s);
      if (!parts) return verbs.filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v }));
      const [, verb, typed] = parts;
      if (!verbs.includes(verb) || /\s/.test(typed)) return null;
      try {
        if (!context) return null;
        const all = records(await getService(context).handle("questions.list", {}));
        return all
          .filter((q) =>
            verb === "resume"
              ? q.status === "answered"
              : verb === "answer" || verb === "cancel"
                ? q.status === "pending"
                : true,
          )
          .filter((q) => !q.readOnly && (q.id.startsWith(typed) || q.text.toLowerCase().includes(typed.toLowerCase())))
          .map((q) => ({
            value: `${verb} ${q.id}`,
            label: q.text.replace(/\s+/g, " "),
            description: q.status,
          }));
      } catch {
        return null;
      }
    },
    description: "List, inspect, answer, cancel or resume questions",
    async handler(args, ctx) {
      context = ctx;
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const [verb = "list", id, ...rest] = parts;
      try {
        const service = getService(ctx);
        if (!args.trim() && ctx.mode === "tui") {
          await inbox(ctx, service);
        } else if (verb === "list") {
          if (id) throw new Error("Usage: /questions [list|detail <id>|answer <id> <text>|cancel <id>|resume <id>]");
          const questions = records(await service.handle("questions.list", {}));
          ctx.ui.notify(
            questions.length
              ? questions.map((q) => renderQuestion(q, shortId(q, questions))).join("\n")
              : "No questions",
            "info",
          );
        } else if (verb === "detail") {
          if (!id || rest.length) throw new Error("Usage: /questions detail <id>");
          const question = (await service.handle("questions.get", {
            id: await resolveId(service, id),
          })) as Question | null;
          if (!question) throw new Error(`Question not found: ${id}`);
          const all = records(await service.handle("questions.list", {}));
          const displayId = shortId(question, all);
          ctx.ui.notify(renderQuestionDetail(question, displayId), "info");
        } else if (verb === "answer") {
          const answer =
            args
              .trim()
              .match(/^answer\s+\S+\s+([\s\S]+)$/)?.[1]
              .trim() ?? "";
          if (!id || !answer) throw new Error("Usage: /questions answer <id> <text>");
          await service.handle("questions.answer", { id: await resolveId(service, id), answer });
          ctx.ui.notify(`Answer saved for ${id}`, "info");
        } else if (verb === "resume") {
          if (!id || rest.length) throw new Error("Usage: /questions resume <id>");
          const resumed = (await service.handle("questions.resume", { id: await resolveId(service, id) })) as Question;
          ctx.ui.notify(
            resumed.remote
              ? (resumed.remote.replyState === "delivered"
                  ? "Remote human reply delivered: "
                  : "Remote human reply saved; outcome uncertain: ") + id
              : `Saved answer queued for a new parent turn: ${id}`,
            "info",
          );
        } else if (verb === "cancel") {
          if (!id || rest.length) throw new Error("Usage: /questions cancel <id>");
          await service.handle("questions.cancel", { id: await resolveId(service, id) });
          ctx.ui.notify(`Question ${id} cancelled`, "info");
        } else throw new Error("Usage: /questions [list|detail <id>|answer <id> <text>|cancel <id>|resume <id>]");
        await refresh();
      } catch (error) {
        ctx.ui.notify(
          error instanceof SyntaxError
            ? "Could not read saved questions: invalid data. Repair the questions file before retrying."
            : error instanceof Error
              ? error.message
              : String(error),
          "warning",
        );
      }
    },
  });

  const attach = (ctx: ExtensionContext) => {
    context = ctx;
    generation++;
    void refresh();
  };
  pi.on("session_start", (_event, ctx) => attach(ctx));
  pi.on("session_tree", (_event, ctx) => attach(ctx));
  pi.on("tool_execution_end", (_event, ctx) => attach(ctx));
  pi.on("before_agent_start", (_event, ctx) => {
    if (context !== ctx) attach(ctx);
    else void refresh();
  });
  pi.on("agent_end", (_event, ctx) => {
    context = ctx;
    void refresh();
  });
  pi.on("session_shutdown", () => {
    generation++;
    context?.ui.setStatus("bruv-questions", undefined);
    context = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    subscribed = undefined;
  });
  return { refresh };
}
