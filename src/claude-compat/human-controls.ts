import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ClaudeCompatTransport } from "./transport";
import type { QuestionCommands } from "../questions/extension";
import type { Question } from "../questions/service";
import { NATIVE_QUESTION_ACCESS, type NativeQuestionAccess } from "../questions/runtime";

export interface HumanControlOptions {
  /** Bind the SAME transport serving the owning AgentSession. */
  request: ClaudeCompatTransport["request"];
  /** Native T3 supports AskUserQuestion; set false for a host without it. */
  askUserQuestion?: boolean;
  diagnostic?: (error: unknown) => void;
}

/** A projection of the existing saved ledger, not another session or reply scheduler.
 * Only a correlated native human callback may save a reply. The question runtime
 * owns delivery to a new parent turn, including durable claims and restart resume.
 */
export function createClaudeCompatHumanControls(options: HumanControlOptions) {
  const enabled = options.askUserQuestion !== false;
  const diagnostic = options.diagnostic ?? (() => {});
  let frontend: ReturnType<typeof bindQuestions> | undefined;

  function dispose() {
    frontend?.close();
    frontend = undefined;
  }

  function openQuestion(id: string, signal?: AbortSignal): Promise<Question> {
    if (!frontend) return Promise.reject(new Error("Native question frontend is not bound to a parent session"));
    return frontend.openQuestion(id, signal);
  }

  function interrupt(reason = new Error("Native human projection interrupted; question remains saved")) {
    frontend?.interrupt(reason);
  }

  async function flush() {
    // A session replacement during the drain may open new owning dialogs.
    while (frontend) {
      const draining = frontend;
      await draining.flush();
      if (frontend === draining) return;
    }
  }

  const factory: ExtensionFactory = (pi) => {
    const attach = (context: NativeQuestionAccess["context"]) => {
      dispose();
      pi.events.emit(NATIVE_QUESTION_ACCESS, {
        context,
        accept(port, release) {
          frontend = bindQuestions(port, release);
        },
      } satisfies NativeQuestionAccess);
      if (!frontend) diagnostic(new Error("Saved questions unavailable: no parent question runtime binding"));
    };
    pi.on("session_start", (_event, context) => attach(context));
    pi.on("session_tree", (_event, context) => attach(context));
    pi.on("session_shutdown", dispose);
  };

  return {
    factory,
    openQuestion,
    interrupt,
    flush,
    dispose,
    capabilities: {
      get savedQuestions() {
        return frontend !== undefined;
      },
      get askUserQuestion() {
        return enabled && frontend !== undefined;
      },
      tuiPicker: false,
      resumeReturnDialog: false,
      audio: false,
    },
    /** Actual owning command port; absent until the parent session has started. */
    questions: () => frontend?.port,
  };

  // One lease owns its command authority, subscriptions and dialog history.
  // Closing it invalidates callbacks even if the transport ignores abort.
  function bindQuestions(port: QuestionCommands, release: () => void) {
    let closed = false;
    const seen = new Map<string, number>();
    const active = new Map<string, { controller: AbortController; promise: Promise<Question> }>();

    function interrupt(reason: Error) {
      for (const item of active.values()) item.controller.abort(reason);
      active.clear();
    }

    async function flush() {
      // questions.ask stays nonblocking; only the native terminal result waits for
      // its actual human callback so T3 cannot finalize the dialog's owning turn.
      while (active.size) await Promise.allSettled([...active.values()].map((item) => item.promise));
    }

    async function project(id: string, signal: AbortSignal): Promise<Question> {
      const question = (await port.handle("questions.get", { id })) as Question;
      if (question.readOnly) throw new Error("Question belongs to another branch; history only");
      if (question.status !== "pending") return question;
      if (!enabled) return question; // Ledger/CLI commands still work without a native dialog.
      const toolUseId = `bruv-question:${question.id}:${question.version}`;
      // Official T3 live SDK questions have no dismiss control. Offer a truthful
      // human defer action; this native selection is never saved as an answer.
      let deferLabel = "Keep pending (do not answer)";
      while (question.choices?.includes(deferLabel)) deferLabel += " — Bruv";
      const response = await options.request(
        {
          subtype: "can_use_tool",
          tool_name: "AskUserQuestion",
          tool_use_id: toolUseId,
          input: {
            questions: [
              {
                question: question.text,
                header: "Bruv",
                multiSelect: false,
                options: [
                  ...(question.choices ?? []).map((label) => ({ label, description: label })),
                  { label: deferLabel, description: "Leave the saved question pending and reopen it later." },
                ],
              },
            ],
          },
        },
        { signal },
      );
      // Denial/abort/disconnect is NOT an answer, cancellation or permission to mint one.
      if (response.behavior === "deny") return (await port.handle("questions.get", { id })) as Question;
      if (response.behavior !== "allow") throw new Error("Invalid native question response; question remains pending");
      if (signal.aborted || closed) throw new Error("Native question frontend changed; reopen saved question");
      if (response.toolUseID !== undefined && response.toolUseID !== toolUseId)
        throw new Error("Native question correlation mismatch");
      const input = response.updatedInput as { answers?: Record<string, unknown> } | undefined;
      const answer = input?.answers?.[question.text];
      if (answer === deferLabel) return (await port.handle("questions.get", { id })) as Question;
      if (typeof answer !== "string" || !answer.trim()) throw new Error("No explicit human answer in native callback");
      return (await port.handle("questions.answer", {
        id: question.id,
        owner: question.owner,
        version: question.version,
        answer,
      })) as Question;
    }

    function openQuestion(id: string, signal?: AbortSignal): Promise<Question> {
      const existing = active.get(id);
      if (existing) return existing.promise;
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      const promise = project(id, controller.signal).finally(() => {
        signal?.removeEventListener("abort", abort);
        if (active.get(id)?.controller === controller) active.delete(id);
      });
      active.set(id, { controller, promise });
      return promise;
    }

    async function refresh() {
      const questions = (await port.handle("questions.list")) as Question[];
      if (closed || !enabled) return;
      for (const question of questions) {
        if (question.status !== "pending" || question.readOnly) {
          const obsolete = active.get(question.id);
          if (obsolete) {
            active.delete(question.id);
            obsolete.controller.abort(new Error("Saved question is no longer pending for this owner"));
          }
          continue;
        }
        if (seen.get(question.id) === question.version) continue;
        const previous = active.get(question.id);
        if (previous) {
          active.delete(question.id);
          previous.controller.abort(new Error("Question changed while open; showing current saved question"));
        }
        seen.set(question.id, question.version);
        void openQuestion(question.id).catch(diagnostic);
      }
    }

    const unsubscribe = port.subscribe?.(() => {
      void refresh().catch(diagnostic);
    });
    void refresh().catch(diagnostic);

    function close() {
      unsubscribe?.();
      release();
      closed = true;
      interrupt(new Error("Native human frontend closed; question remains saved"));
      seen.clear();
    }

    return { port, openQuestion, interrupt, flush, close };
  }
}
