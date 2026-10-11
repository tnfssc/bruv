import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "./jobs";

type Question = { id: string; question: string; choices?: string[] };

/** What the user's typed reply means for the oldest open question: a choice number picks that choice. */
export function answerText(question: Question, text: string) {
  const index = /^\s*(\d+)\s*$/.exec(text)?.[1];
  const choice = index && question.choices?.[Number(index) - 1];
  return `Answer to ${question.id} (${question.question}): ${choice || text}`;
}

export function registerQuestions(pi: ExtensionAPI) {
  let nextId = 0;
  // Terminal questions wait above the input; the user answers by typing a normal message.
  let open: Question[] = [];
  let ui: ExtensionContext["ui"] | undefined;
  const show = () => {
    ui?.setWidget(
      "bruv-questions",
      open.length
        ? open.flatMap((item) => [
            ` ? ${item.id} · ${item.question}`,
            ...(item.choices ?? []).map((choice, index) => `     ${index + 1}. ${choice}`),
          ])
        : undefined,
      { placement: "aboveEditor" },
    );
  };
  pi.on("session_start", (_event, ctx) => {
    nextId = 0;
    open = [];
    ui = ctx.mode === "tui" ? ctx.ui : undefined;
    show();
  });
  pi.on("session_shutdown", () => {
    open = [];
    show();
    ui = undefined;
  });
  pi.on("input", (event) => {
    if (!open.length || event.source !== "interactive" || event.text.startsWith("/")) return { action: "continue" };
    const question = open.shift() as Question;
    show();
    return { action: "transform", text: answerText(question, event.text) };
  });
  pi.registerTool({
    name: "ask",
    label: "Ask",
    description:
      "Ask the user something only they can decide, with your pick, and keep working. The answer arrives as a message.",
    exposure: "codemode",
    parameters: Type.Object({
      question: Type.String(),
      choices: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
    }),
    outputSchema: Type.Object({ id: Type.String() }),
    async execute(_id, args, _signal, _update, ctx) {
      if (!ctx.hasUI) throw new Error("No one can answer questions in this mode.");
      const id = `q${++nextId}`;
      if (ctx.mode === "tui") {
        open.push({ id, question: args.question, choices: args.choices });
        show();
        return toolResult({ id });
      }
      // T3 and other clients show their own question prompt without blocking the thread.
      const sessionId = ctx.sessionManager.getSessionId();
      const answer = args.choices ? ctx.ui.select(args.question, args.choices) : ctx.ui.input(args.question);
      void answer
        .then((value) => {
          if (ctx.sessionManager.getSessionId() !== sessionId) return;
          pi.sendMessage(
            {
              customType: "bruv-answer",
              display: true,
              content: `${id}: ${args.question}\n${value === undefined ? "Question dismissed." : value}`,
              details: { id, question: args.question, answer: value ?? null, dismissed: value === undefined },
            },
            { deliverAs: ctx.isIdle() ? "nextTurn" : "steer" },
          );
        })
        .catch((error: unknown) => {
          ctx.ui.notify(`Question failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        });
      return toolResult({ id });
    },
  });
}
