import { expect, setDefaultTimeout, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, type SystemMessage } from "@earendil-works/pi-ai";
import { type Goal, registerGoal } from "../src/goal";
import { registerPrompt } from "../src/prompt";
import { sdk } from "./sdk";

setDefaultTimeout(15000);
const update = (args: object) =>
  fauxAssistantMessage(fauxToolCall("codemode", { code: `return await tools.goal_update(${JSON.stringify(args)});` }), {
    stopReason: "toolUse",
  });
async function setup(tokens?: number) {
  const runs = { started: 0, settled: 0 };
  const app = await sdk([
    (pi) => {
      if (tokens)
        pi.on("message_end", (event) => {
          if (event.message.role === "assistant") event.message.usage.totalTokens = tokens;
        });
      registerGoal(pi);
      registerPrompt(pi);
      pi.on("agent_start", () => {
        runs.started++;
      });
      pi.on("agent_settled", () => {
        runs.settled++;
      });
    },
  ]);
  const state = () => {
    const entry = app.session.sessionManager
      .getBranch()
      .reverse()
      .find((e) => e.type === "custom" && e.customType === "bruv-goal");
    return entry?.type === "custom" ? (entry.data as Goal | null) : undefined;
  };
  const run = async (command: string) => {
    const settled = Promise.withResolvers<void>();
    const unsubscribe = app.session.subscribe((event) => {
      if (event.type === "agent_settled") settled.resolve();
    });
    try {
      await app.session.prompt(command);
      await settled.promise;
    } finally {
      unsubscribe();
    }
  };
  return { ...app, state, run, runs };
}

test("goal continues until its token budget and restores branch state", async () => {
  const app = await setup(600);
  try {
    let system: SystemMessage | undefined;
    const message = fauxAssistantMessage("step");
    app.faux.setResponses([
      (context) => {
        system = structuredClone(context.messages.find((m) => m.role === "system"));
        expect(system).toBeDefined();
        return message;
      },
      (context) => {
        expect(context.messages.find((m) => m.role === "system")).toEqual(system);
        expect(app.state()?.tokensUsed).toBe(0);
        expect(
          app.session.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === "bruv-goal"),
        ).toHaveLength(1);
        return message;
      },
    ]);
    await app.run('/goal task-781 --criteria "a; b" --budget 1k');
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
    const round = [
      update({ status: "blocked", blocker: "missing-781" }),
      update({ status: "blocked", blocker: "missing-781" }),
      fauxAssistantMessage("end"),
    ];
    app.faux.setResponses([...round, ...round, ...round]);
    await app.run("/goal task");
    expect(app.state()?.status).toBe("blocked");
    expect(app.faux.state.callCount).toBe(9);
    app.faux.setResponses([
      ...round,
      update({ status: "completed", evidence: "verified-781" }),
      fauxAssistantMessage("done"),
    ]);
    await app.run("/goal resume");
    expect(app.state()).toMatchObject({ status: "completed", evidence: "verified-781" });
  } finally {
    await app.close();
  }
});

test("abort pauses the goal and completion requires evidence", async () => {
  const app = await setup();
  try {
    const message = fauxAssistantMessage("stopped", { stopReason: "aborted" });
    app.faux.setResponses([message]);
    await app.run("/goal task --budget 2m");
    expect(app.state()?.status).toBe("paused");
    expect(app.faux.state.callCount).toBe(1);
    app.faux.setResponses([
      update({ status: "completed" }),
      (context) => {
        expect(app.state()?.status).toBe("active");
        expect(context.messages.some((m) => m.role === "toolResult" && m.isError)).toBe(true);
        return fauxAssistantMessage("stop", { stopReason: "aborted" });
      },
    ]);
    await app.run("/goal resume");
    expect(app.state()?.status).toBe("paused");
  } finally {
    await app.close();
  }
});

test("the goal command starts and settles exactly one agent run over RPC", async () => {
  const app = await setup(10);
  try {
    app.faux.setResponses([fauxAssistantMessage("done")]);
    await app.run("/goal task-782 --budget 10");
    expect(app.runs).toEqual({ started: 1, settled: 1 });
    expect(app.faux.state.callCount).toBe(1);
    expect(app.state()).toMatchObject({ status: "budget_exceeded", tokensUsed: 10 });
  } finally {
    await app.close();
  }
});
