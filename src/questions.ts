import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "./jobs";

export function registerQuestions(pi: ExtensionAPI) {
  let nextId = 0;
  pi.on("session_start", () => {
    nextId = 0;
  });
  pi.registerTool({
    name: "ask",
    label: "Ask",
    description: "Ask the user a question and keep working.",
    exposure: "deferred",
    namespace: {
      name: "bruv_questions",
      description: "Ask the user while work continues",
      instructions:
        "Use ask when the user can resolve a choice or provide a missing fact. Answers arrive as messages during the run or with the next turn.",
    },
    parameters: Type.Object({
      question: Type.String(),
      choices: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
    }),
    outputSchema: Type.Object({ id: Type.String() }),
    async execute(_id, args, _signal, _update, ctx) {
      if (!ctx.hasUI) throw new Error("No one can answer questions in this mode.");
      const id = `q${++nextId}`;
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
