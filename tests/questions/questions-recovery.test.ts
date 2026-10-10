import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerQuestionRuntime } from "../../src/questions/runtime";
import { registerGoalMode } from "../../src/goals/extension";

function fixture(withGoals = false) {
  const directory = mkdtempSync(join(tmpdir(), "bruv-question-recovery-"));
  const handlers = new Map<string, Array<(event: any, context: any) => unknown>>();
  const commands = new Map<string, any>();
  const entries: any[] = [{ id: "root" }];
  const followUps: string[] = [];
  const sent: any[] = [];
  let idle = false;
  const context: any = {
    sessionManager: {
      getSessionFile: () => join(directory, "session.jsonl"),
      getSessionId: () => "owner",
      getLeafId: () => entries.at(-1).id,
      getBranch: () => entries,
    },
    isIdle: () => idle,
    ui: { notify() {} },
    abort() {},
  };
  const pi: any = {
    on(name: string, handler: any) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ id: `entry-${entries.length}`, type: "custom", customType, data });
    },
    sendMessage(message: any) {
      sent.push(message);
    },
    sendUserMessage(message: string) {
      followUps.push(message);
    },
  };
  const runtime = registerQuestionRuntime(pi, { supported: () => true, hasMainToolOwner: () => false });
  const goals = withGoals
    ? registerGoalMode(
        pi,
        { runningIds: () => new Set(), status: () => "unavailable" },
        {
          hasBlockingQuestions: () => runtime.hasBlockingQuestions(),
          onHumanStart: (ctx) => runtime.acceptHumanWork(ctx),
        },
      )
    : undefined;
  const emit = async (name: string, event: any = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, context);
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    runtime,
    sent,
    goals,
    goal: (args: string) => commands.get("goal").handler(args, context),
    replies: () => sent.filter((message) => message.customType === "question-answer"),
    followUps,
    emit,
    tick,
    start: () => emit("session_start"),
    ask: (text: string) => runtime.service.ask(context, { text }),
    answer: (id: string) => runtime.commands(context).handle("questions.answer", { id, answer: "Human reply" }),
    read: (id: string) => runtime.commands(context).handle("questions.get", { id }),
    resume: (id: string) => runtime.commands(context).handle("questions.resume", { id }),
    finish: (stopReason: string) => emit("agent_end", { messages: [{ role: "assistant", stopReason }] }),
    async settle(aborted = false) {
      idle = true;
      await emit("agent_settled", { aborted });
      await tick();
    },
    async begin(source: "rpc" | "extension", text = "Continue this work") {
      idle = false;
      await emit("input", { source, text });
      await emit("before_agent_start");
      await emit("agent_start");
    },
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

test("a recovered provider retry preserves queued human replies until successful settlement", async () => {
  const h = fixture();
  try {
    await h.start();
    const question = await h.ask("Which option should the current work use?");
    await h.answer(question.id);
    await h.finish("error");
    expect(h.sent).toHaveLength(0);
    await h.emit("agent_start");
    await h.finish("stop");
    await h.settle();
    expect(h.sent.map((message) => message.details.questionId)).toEqual([question.id]);
    expect(await h.read(question.id)).toMatchObject({ delivery: "delivered" });
  } finally {
    h.cleanup();
  }
});

test.each(["resume", "set"])(
  "explicit human goal %s after Stop enables new questions without renewing old question delivery",
  async (operation) => {
    const h = fixture(true);
    try {
      await h.start();
      await h.goal("set Original objective");
      const old = await h.ask("Question from interrupted goal work");
      await h.finish("aborted");
      await h.settle(true);
      if (operation === "set") await h.goal("clear");
      await h.goal(operation === "set" ? "set New objective" : "resume");
      expect(h.goals!.get()?.status).toBe("active");
      await h.begin("extension", h.followUps.at(-1));
      const fresh = await h.ask("Question from human-authorized goal work");
      await h.answer(old.id);
      await h.answer(fresh.id);
      h.goals!.handle("goal.update", { status: "completed", evidence: "Fixture complete" });
      await h.finish("stop");
      await h.settle();
      expect(await h.read(old.id)).toMatchObject({ delivery: "resume-needed" });
      expect(h.replies().map((message) => message.details.questionId)).toEqual([fresh.id]);
    } finally {
      h.cleanup();
    }
  },
);

test.each(["status", "resume extra"])("goal %s does not renew paused question work", async (command) => {
  const h = fixture(true);
  try {
    await h.start();
    await h.goal("set Original objective");
    await h.finish("aborted");
    await h.settle(true);
    await h.goal(command);
    expect(h.goals!.get()?.status).toBe("paused");
    await h.begin("extension");
    const question = await h.ask("Question without an accepted human restart");
    await h.answer(question.id);
    await h.finish("stop");
    await h.settle();
    expect(h.replies()).toEqual([]);
    expect(await h.read(question.id)).toMatchObject({ delivery: "resume-needed" });
  } finally {
    h.cleanup();
  }
});

test("failed final retries keep saved replies paused until explicit resume", async () => {
  const h = fixture();
  try {
    await h.start();
    const question = await h.ask("Save this answer if the provider is unavailable");
    await h.answer(question.id);
    await h.finish("error");
    await h.settle();
    expect(h.sent).toHaveLength(0);
    expect(await h.read(question.id)).toMatchObject({ delivery: "resume-needed" });
    await h.resume(question.id);
    await h.tick();
    expect(h.sent.map((message) => message.details.questionId)).toEqual([question.id]);
  } finally {
    h.cleanup();
  }
});

test("a saved answer's custom-message turn releases its goal blocker at agent_start", async () => {
  const h = fixture();
  try {
    await h.start();
    const question = await h.ask("Choose the next step");
    await h.answer(question.id);
    await h.finish("stop");
    await h.settle();
    expect(h.sent).toHaveLength(1);
    expect(h.runtime.hasBlockingQuestions()).toBe(true);
    // Pi sendCustomMessage(triggerTurn: true) does not emit before_agent_start.
    await h.emit("agent_start");
    expect(h.runtime.hasBlockingQuestions()).toBe(false);
  } finally {
    h.cleanup();
  }
});

test("a fresh human turn enables new questions without reactivating questions saved before Stop", async () => {
  const h = fixture();
  try {
    await h.start();
    const old = await h.ask("Question from the interrupted work");
    await h.finish("aborted");
    await h.settle(true);
    await h.begin("rpc");
    const fresh = await h.ask("Question from the newly requested work");
    await h.answer(old.id);
    await h.answer(fresh.id);
    await h.finish("stop");
    await h.settle();
    expect(await h.read(old.id)).toMatchObject({ delivery: "resume-needed" });
    expect(h.sent.map((message) => message.details.questionId)).toEqual([fresh.id]);
    await h.emit("before_agent_start");
    await h.resume(old.id);
    await h.tick();
    expect(h.sent.map((message) => message.details.questionId)).toEqual([fresh.id, old.id]);
  } finally {
    h.cleanup();
  }
});

test("an autonomous wake after Stop does not renew authority for old or newly saved questions", async () => {
  const h = fixture();
  try {
    await h.start();
    const old = await h.ask("Original question");
    await h.finish("aborted");
    await h.settle(true);
    await h.begin("extension");
    const autonomous = await h.ask("Question during an autonomous wake");
    await h.answer(old.id);
    await h.answer(autonomous.id);
    await h.finish("stop");
    await h.settle();
    expect(h.sent).toHaveLength(0);
    await h.begin("rpc");
    await h.finish("stop");
    await h.settle();
    expect(h.sent).toHaveLength(0);
    expect(await h.read(autonomous.id)).toMatchObject({ delivery: "resume-needed" });
  } finally {
    h.cleanup();
  }
});
