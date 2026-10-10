import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { registerQuestions } from "../src/questions";
import { sdk } from "./sdk";

const ask = (choices?: string[]) =>
  fauxAssistantMessage(
    fauxToolCall("codemode", {
      code: `return await tools.ask(${JSON.stringify({ question: "question-781", choices })});`,
    }),
    { stopReason: "toolUse" },
  );

test("ask returns while the dialog is open and steers its answer into the run", async () => {
  const dialog = Promise.withResolvers<string | undefined>();
  const afterTool = Promise.withResolvers<void>();
  const answering = Promise.withResolvers<void>();
  let choices: string[] = [];
  const app = await sdk([registerQuestions], {
    select: (_question, options) => {
      choices = options;
      return dialog.promise;
    },
  });
  try {
    app.faux.setResponses([
      ask(["a", "b"]),
      async (context) => {
        const result = context.messages.filter((m) => m.role === "toolResult").at(-1);
        expect(result?.role === "toolResult" && result.isError).toBe(false);
        expect(JSON.stringify(result)).toContain("q1");
        afterTool.resolve();
        await answering.promise;
        return fauxAssistantMessage("working");
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("answer-781");
        return fauxAssistantMessage("done");
      },
    ]);
    const run = app.session.prompt("go");
    await afterTool.promise;
    expect(choices).toEqual(["a", "b"]);
    expect(app.session.isStreaming).toBe(true);
    dialog.resolve("answer-781");
    await dialog.promise;
    answering.resolve();
    await run;
    expect(app.faux.state.callCount).toBe(3);
    const entry = app.session.sessionManager
      .getBranch()
      .find((e) => e.type === "custom_message" && e.customType === "bruv-answer");
    expect(entry?.type === "custom_message" && entry.details).toMatchObject({
      id: "q1",
      answer: "answer-781",
      dismissed: false,
    });
  } finally {
    answering.resolve();
    dialog.resolve(undefined);
    await app.close();
  }
});

test.each(["answer-781", undefined])(
  "unanswered questions settle; answers and dismissal arrive next turn (%s)",
  async (value) => {
    const dialog = Promise.withResolvers<string | undefined>();
    let opened = false;
    const app = await sdk([registerQuestions], {
      input: () => {
        opened = true;
        return dialog.promise;
      },
    });
    try {
      app.faux.setResponses([ask(), fauxAssistantMessage("finished")]);
      await app.session.prompt("go");
      expect(opened).toBe(true);
      expect(app.faux.state.callCount).toBe(2);
      expect(app.session.isStreaming).toBe(false);
      dialog.resolve(value);
      await dialog.promise;
      expect(app.faux.state.callCount).toBe(2);
      app.faux.setResponses([fauxAssistantMessage("received")]);
      await app.session.prompt("next");
      const entry = app.session.sessionManager
        .getBranch()
        .find((e) => e.type === "custom_message" && e.customType === "bruv-answer");
      expect(entry?.type === "custom_message" && entry.details).toMatchObject({
        id: "q1",
        answer: value ?? null,
        dismissed: value === undefined,
      });
    } finally {
      dialog.resolve(undefined);
      await app.close();
    }
  },
);

test("ask fails without UI", async () => {
  const app = await sdk([registerQuestions]);
  try {
    await app.session.bindExtensions({ mode: "print" });
    app.faux.setResponses([
      ask(),
      (context) => {
        expect(context.messages.some((m) => m.role === "toolResult" && m.isError)).toBe(true);
        return fauxAssistantMessage("done");
      },
    ]);
    await app.session.prompt("go");
    expect(
      app.session.sessionManager.getBranch().some((e) => e.type === "custom_message" && e.customType === "bruv-answer"),
    ).toBe(false);
  } finally {
    await app.close();
  }
});
