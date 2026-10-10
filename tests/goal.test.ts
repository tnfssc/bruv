import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { type Goal, registerGoal } from "../src/goal";
import { registerPrompt } from "../src/prompt";
import { sdk } from "./sdk";

const update = (args: object) =>
  fauxAssistantMessage(fauxToolCall("codemode", { code: `return await tools.goal_update(${JSON.stringify(args)});` }), {
    stopReason: "toolUse",
  });
async function setup(tokens?: number) {
  const app = await sdk([
    (pi) => {
      if (tokens)
        pi.on("message_end", (event) => {
          if (event.message.role === "assistant") event.message.usage.totalTokens = tokens;
        });
      registerPrompt(pi, registerGoal(pi));
    },
  ]);
  const state = () => {
    const entry = app.session.sessionManager
      .getBranch()
      .reverse()
      .find((e) => e.type === "custom" && e.customType === "bruv-goal");
    return entry?.type === "custom" ? (entry.data as Goal | null) : undefined;
  };
  return { ...app, state };
}

test("goal continues until its token budget and restores branch state", async () => {
  const app = await setup(600);
  try {
    await app.session.prompt('/goal task-781 --criteria "a; b" --budget 1k');
    const message = fauxAssistantMessage("step");
    app.faux.setResponses([
      message,
      (context) => {
        expect(context.messages.some((m) => m.role === "system" && m.sections?.bruv_goal?.includes("task-781"))).toBe(
          true,
        );
        return message;
      },
    ]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(2);
    expect(app.state()).toMatchObject({
      status: "budget_exceeded",
      tokensUsed: 1200,
      tokenBudget: 1000,
      criteria: ["a", "b"],
    });
    await app.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
    await app.session.prompt("/goal resume");
    expect(app.state()?.status).toBe("budget_exceeded");
    await app.session.prompt("/goal clear");
    expect(app.state()).toBeNull();
  } finally {
    await app.close();
  }
});

test("three blocker rounds stop the goal and resume starts a fresh count", async () => {
  const app = await setup();
  try {
    await app.session.prompt("/goal task");
    const round = [
      update({ status: "blocked", blocker: "missing-781" }),
      update({ status: "blocked", blocker: "missing-781" }),
      fauxAssistantMessage("end"),
    ];
    app.faux.setResponses([...round, ...round, ...round]);
    await app.session.prompt("go");
    expect(app.state()?.status).toBe("blocked");
    expect(app.faux.state.callCount).toBe(9);
    await app.session.prompt("/goal resume");
    app.faux.setResponses([
      ...round,
      update({ status: "completed", evidence: "verified-781" }),
      fauxAssistantMessage("done"),
    ]);
    await app.session.prompt("go");
    expect(app.state()).toMatchObject({ status: "completed", evidence: "verified-781" });
  } finally {
    await app.close();
  }
});

test("abort pauses the goal and completion requires evidence", async () => {
  const app = await setup();
  try {
    await app.session.prompt("/goal task --budget 2m");
    const message = fauxAssistantMessage("stopped", { stopReason: "aborted" });
    app.faux.setResponses([message]);
    await app.session.prompt("go");
    expect(app.state()?.status).toBe("paused");
    expect(app.faux.state.callCount).toBe(1);
    await app.session.prompt("/goal resume");
    app.faux.setResponses([
      update({ status: "completed" }),
      (context) => {
        expect(app.state()?.status).toBe("active");
        expect(context.messages.some((m) => m.role === "toolResult" && m.isError)).toBe(true);
        return fauxAssistantMessage("stop", { stopReason: "aborted" });
      },
    ]);
    await app.session.prompt("go");
    expect(app.state()?.status).toBe("paused");
  } finally {
    await app.close();
  }
});
