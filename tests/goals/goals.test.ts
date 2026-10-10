import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { inspectDiagnostics } from "../../src/diagnostics";
import { GoalContinuationController, REQUIRED_BLOCKED_TURNS } from "../../src/goals/controller";
import { registerGoalMode } from "../../src/goals/extension";
import { GOAL_ENTRY_TYPE, GoalStore, latestGoal } from "../../src/goals/store";

const input = {
  objective: "Ship goal mode",
  criteria: ["tests pass", "state persists"],
  constraints: ["no installs"],
};

describe("goal durable state", () => {
  test("requires fields and replays validated append-only entries", () => {
    const entries: any[] = [];
    let tick = 0;
    const store = new GoalStore(
      (customType, data) => entries.push({ type: "custom", customType, data }),
      [],
      () => `t${++tick}`,
    );

    expect(() => store.set({ ...input, criteria: [] })).toThrow("criteria is required");
    const active = store.set(input);
    expect(active).toMatchObject({ ...input, status: "active", revision: 1 });
    expect(latestGoal(entries)).toEqual(active);
    expect(() => store.update({ status: "completed" })).toThrow("completion evidence");
    expect(() => store.update({ status: "blocked" })).toThrow("blocker explanation");

    const done = store.update({ status: "completed", evidence: "bun test: 42 pass" });
    expect(new GoalStore(() => {}, entries).get()).toEqual(done);
    store.clear();
    expect(latestGoal(entries)).toBeUndefined();
    expect(entries.every((entry) => entry.customType === GOAL_ENTRY_TYPE)).toBe(true);
  });

  test("fails closed on corrupt, future, and obsolete updates", () => {
    const entries: any[] = [];
    const store = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }));
    const active = store.set(input);

    entries.push({
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 99, operation: "update", goal: active, at: "later" },
    });
    expect(latestGoal(entries)).toBeUndefined();

    entries.push({
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 1, operation: "update", goal: active, at: "latest" },
    });
    expect(latestGoal(entries)).toBeUndefined();
  });

  test("corrupt restore reports affected waiting job references", () => {
    const entries: any[] = [];
    const store = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }));
    store.set(input);
    store.update({ status: "waiting", pendingJobIds: ["task_owned"] }, new Set(["task_owned"]));
    entries.push({ type: "custom", customType: GOAL_ENTRY_TYPE, data: { version: 99 } });
    const owner = {};
    expect(latestGoal(entries, owner)).toBeUndefined();
    expect(inspectDiagnostics(owner).records).toContainEqual({
      version: 1,
      generated: expect.any(String),
      component: "resume",
      code: "state_invalid",
      outcome: "fallback",
      taskId: "task_owned",
    });
  });

  test("rejected waiting updates revoke both sides of the authority boundary", () => {
    const entries: any[] = [];
    const store = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }));
    store.set(input);
    const waiting = store.update({ status: "waiting", pendingJobIds: ["task_prior"] }, new Set(["task_prior"]));
    entries.push({
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 1, operation: "update", at: "later", goal: { ...waiting, pendingJobIds: ["task_rejected"] } },
    });
    const owner = {};
    expect(latestGoal(entries, owner)).toBeUndefined();
    expect(inspectDiagnostics(owner).records.map((record) => record.taskId)).toEqual([
      undefined,
      "task_prior",
      "task_rejected",
    ]);

    // Even a newer update cannot revive authority once its predecessor was revoked.
    entries.push({
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 1, operation: "update", at: "latest", goal: { ...waiting, revision: waiting.revision + 1 } },
    });
    expect(latestGoal(entries)).toBeUndefined();
    store.clear();
    const replacement = store.set(input);
    const recoveredOwner = {};
    expect(latestGoal(entries, recoveredOwner)).toEqual(replacement);
    expect(inspectDiagnostics(recoveredOwner).records).toEqual([]);
  });

  test("malformed entries use untrusted references only for closed-schema diagnostics", () => {
    const entries: any[] = [];
    const store = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }));
    store.set(input);
    entries.push({
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: {
        version: 99,
        goal: { pendingJobIds: ["forged arbitrary text", "task_named", "task_named", 42] },
      },
    });
    const owner = {};
    expect(latestGoal(entries, owner)).toBeUndefined();
    const diagnostics = inspectDiagnostics(owner);
    expect(diagnostics.records.map((record) => record.taskId)).toEqual([undefined, "task_named"]);
    expect(diagnostics.invalid).toBe(0);

    store.clear();
    const clearedOwner = {};
    expect(latestGoal(entries, clearedOwner)).toBeUndefined();
    expect(inspectDiagnostics(clearedOwner).records).toEqual([]);
  });

  test("unrelated journal entries are ignored but mismatched goal updates revoke authority", () => {
    const entries: any[] = [];
    const store = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }));
    const active = store.set(input);
    entries.push({ type: "custom", customType: "unrelated", data: { version: 99 } });
    entries.push({ type: "message", customType: GOAL_ENTRY_TYPE, data: { version: 99 } });
    entries.push(null);
    expect(latestGoal(entries)).toEqual(active);
    entries.push({
      type: "custom",
      customType: GOAL_ENTRY_TYPE,
      data: { version: 1, operation: "update", at: "later", goal: { ...active, id: "foreign", revision: 2 } },
    });
    expect(latestGoal(entries)).toBeUndefined();
  });

  test("does not mutate memory when durable append fails", () => {
    let fail = false;
    const store = new GoalStore(() => {
      if (fail) throw new Error("disk full");
    });
    const active = store.set(input);
    fail = true;
    expect(() => store.update({ status: "paused", reason: "later" })).toThrow("disk full");
    expect(store.get()).toEqual(active);
    expect(() => store.clear()).toThrow("disk full");
    expect(store.get()).toEqual(active);
  });

  test("waiting accepts only currently owned running jobs", () => {
    const store = new GoalStore(() => {});
    store.set(input);
    expect(() => store.update({ status: "waiting", pendingJobIds: ["foreign"] }, new Set(["mine"]))).toThrow(
      "your running jobs",
    );
    expect(store.update({ status: "waiting", pendingJobIds: ["mine"] }, new Set(["mine"]))).toMatchObject({
      status: "waiting",
      pendingJobIds: ["mine"],
    });
  });
});

test("a blocker must recur on separate goal turns before it can stop continuation", () => {
  const controller = new GoalContinuationController();
  for (let turn = 1; turn <= REQUIRED_BLOCKED_TURNS; turn++) {
    controller.beginRun();
    for (let report = 0; report < 5; report++) {
      expect(controller.reportBlocker("Credentials unavailable")).toBe(turn === REQUIRED_BLOCKED_TURNS);
      expect(controller.audit()?.attempts).toBe(turn);
    }
    controller.endRun();
  }
});

test("a changed blocker or a turn without that blocker starts a fresh audit", () => {
  const controller = new GoalContinuationController();
  for (let turn = 0; turn < REQUIRED_BLOCKED_TURNS - 1; turn++) {
    controller.beginRun();
    controller.reportBlocker("Credentials unavailable");
    controller.endRun();
  }
  controller.beginRun();
  expect(controller.reportBlocker("Service offline")).toBe(false);
  expect(controller.audit()).toMatchObject({ blocker: "Service offline", attempts: 1 });
  controller.endRun();
  controller.beginRun();
  controller.endRun();
  expect(controller.audit()).toBeUndefined();
  controller.beginRun();
  expect(controller.reportBlocker("Service offline")).toBe(false);
  expect(controller.audit()?.attempts).toBe(1);
});

test("active progress is bounded and duplicate milestones are idempotent", () => {
  const store = new GoalStore(() => {});
  store.set(input);
  store.update({ status: "active", progress: "same evidence" });
  store.update({ status: "active", progress: "same evidence" });
  expect(store.get()?.progress).toEqual(["same evidence"]);
  for (let i = 0; i < 12; i++) store.update({ status: "active", progress: "milestone " + i });
  expect(store.get()?.progress).toHaveLength(8);
  expect(() => store.update({ status: "active", progress: "x".repeat(501) })).toThrow("too long");
});

function harness(
  entries: any[] = [],
  options: {
    hasBlockingQuestions?: () => boolean;
    hasPendingMessages?: () => boolean;
    startSession?: boolean;
  } = {},
) {
  const handlers: Record<string, Function[]> = {};
  const commands: Record<string, any> = {};
  const sent: string[] = [];
  const messages: any[] = [];
  const notices: any[] = [];
  const appended: any[] = [];
  let aborts = 0;
  let branch = [...entries];
  let leaf = "initial";
  const statuses = new Map<string, "running" | "finished" | "unavailable">([["job_1", "running"]]);
  const pi: any = {
    on(name: string, handler: Function) {
      handlers[name] ??= [];
      handlers[name].push(handler);
    },
    registerCommand(name: string, options: any) {
      commands[name] = options;
    },
    appendEntry(customType: string, data: any) {
      const entry = { type: "custom", customType, data };
      appended.push(entry);
      branch.push(entry);
      leaf = `entry-${appended.length}`;
    },
    sendUserMessage(message: string) {
      sent.push(message);
    },
    sendMessage(message: any) {
      messages.push(message);
    },
  };
  const runtime = registerGoalMode(
    pi,
    {
      runningIds: () => new Set([...statuses].filter(([, status]) => status === "running").map(([id]) => id)),
      status: (id) => statuses.get(id) ?? "unavailable",
    },
    options,
  );
  const ctx: any = {
    sessionManager: {
      getBranch: () => branch,
      getLeafId: () => leaf,
      getEntries: () => {
        throw new Error("must restore only the active branch");
      },
    },
    ui: { notify: (...args: any[]) => notices.push(args) },
    hasPendingMessages: options.hasPendingMessages ?? (() => false),
    isIdle: () => false,
    abort: () => aborts++,
  };
  const startSession = () => handlers.session_start[0]({}, ctx);
  if (options.startSession !== false) startSession();
  return {
    sent,
    messages,
    notices,
    appended,
    runtime,
    statuses,
    get aborts() {
      return aborts;
    },
    advanceLeaf(id: string) {
      leaf = id;
    },
    navigateTo(id: string, entries: any[]) {
      leaf = id;
      branch = [...entries];
    },
    restartSession() {
      handlers.session_shutdown[0]();
      startSession();
    },
    finishJob(id: string) {
      statuses.set(id, "finished");
      runtime.jobsChanged();
    },
    goalCommand: (args: string) => commands.goal.handler(args, ctx),
    receiveInput: (event: { source: string; text?: string; streamingBehavior?: string }) =>
      handlers.input[0](event, ctx),
    assembleContext: (messages: any[] = []) => handlers.context[0]({ messages }, ctx),
    handoff: (message = "Waiting for owned work") =>
      handlers.tool_execution_end[0](
        { toolName: "execute", isError: false, result: { details: { handoff: message } } },
        ctx,
      ),
    beginRun: () => handlers.agent_start[0]({}, ctx),
    recordUsage: (usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }) =>
      handlers.message_end[0](
        { message: { role: "assistant", usage: { cacheRead: 0, cacheWrite: 0, ...usage } } },
        ctx,
      ),
    endRun: (stopReason: "stop" | "toolUse") =>
      handlers.agent_end[0]({ messages: [{ role: "assistant", stopReason }] }, ctx),
    settle: () => handlers.agent_settled[0]({}, ctx),
  };
}

test("only active goals continue and user steering preserves waiting work", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  expect(() => h.runtime.handle("goal.update", { status: "completed" })).toThrow();
  h.settle();
  expect(h.sent).toHaveLength(1);

  h.handoff();
  h.settle();
  expect(h.sent).toHaveLength(1);
  h.receiveInput({ source: "interactive", streamingBehavior: "steer" });
  expect(h.runtime.get()).toMatchObject({ status: "waiting", pendingJobIds: ["job_1"] });
  h.finishJob("job_1");
  h.settle();
  expect(h.runtime.get()?.status).toBe("active");
  expect(h.sent).toHaveLength(2);
});

test("successful execute handoff waits only when owned work is running", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  const handoffMessage = "Waiting for owned work";
  h.handoff(handoffMessage);
  expect(h.runtime.get()).toMatchObject({ status: "waiting", pendingJobIds: ["job_1"] });

  h.runtime.handle("goal.update", { status: "paused", reason: "deliberate" });
  h.handoff(handoffMessage);
  expect(h.runtime.get()?.status).toBe("paused");

  const empty = harness();
  empty.runtime.handle("goal.set", input);
  empty.statuses.clear();
  empty.handoff(handoffMessage);
  expect(empty.runtime.get()?.status).toBe("active");
});

test("model-facing updates reject runtime-owned waiting bookkeeping", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);

  expect(() => h.runtime.handle("goal.update", { status: "waiting" })).toThrow("Runtime owns waiting status");
  expect(() => h.runtime.handle("goal.update", { status: "active", pendingJobIds: ["job_1"] })).toThrow(
    "Runtime owns pendingJobIds",
  );
  expect(h.runtime.get()?.status).toBe("active");
});

function reportBlockerRun(h: ReturnType<typeof harness>, blocker = "Credentials unavailable") {
  h.beginRun();
  const result = h.runtime.handle("goal.update", { status: "blocked", blocker });
  h.endRun("stop");
  h.settle();
  return result;
}

test("ordinary automatic turns continue without milestone keepalives", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  for (let turn = 0; turn < 8; turn++) {
    h.beginRun();
    h.endRun("stop");
    h.settle();
    expect(h.runtime.get()?.status).toBe("active");
  }
  expect(h.sent).toHaveLength(8);
  expect(h.runtime.get()?.progress).toBeUndefined();
});

test("helper-created goals keep working across repeated owned-job handoffs", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  for (let turn = 0; turn < 7; turn++) {
    h.beginRun();
    h.statuses.set("job_1", "running");
    h.handoff("Waiting for the next useful result");
    h.endRun("toolUse");
    h.settle();
    expect(h.runtime.get()?.status).toBe("waiting");
    h.finishJob("job_1");
    expect(h.runtime.get()?.status).toBe("active");
  }
  expect(h.sent).toHaveLength(0);
});

test("the same external blocker stops a goal only on its third consecutive run", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  for (let attempt = 1; attempt < REQUIRED_BLOCKED_TURNS; attempt++) {
    expect(reportBlockerRun(h)).toMatchObject({
      status: "active",
      blockerAudit: { blocker: "Credentials unavailable", attempts: attempt, required: REQUIRED_BLOCKED_TURNS },
    });
  }
  expect(reportBlockerRun(h)).toMatchObject({ status: "blocked", blocker: "Credentials unavailable" });
  expect(h.sent).toHaveLength(REQUIRED_BLOCKED_TURNS - 1);
});

test("repeated blocker reports within one provider run count as one attempt", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  h.beginRun();
  for (let report = 0; report < 10; report++) {
    expect(h.runtime.handle("goal.update", { status: "blocked", blocker: "Credentials unavailable" })).toMatchObject({
      status: "active",
      blockerAudit: { attempts: 1 },
    });
  }
  h.endRun("stop");
  expect(reportBlockerRun(h)).toMatchObject({ status: "active", blockerAudit: { attempts: 2 } });
  expect(reportBlockerRun(h)).toMatchObject({ status: "blocked" });
});

test("a changed blocker starts a fresh audit in the runtime", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  reportBlockerRun(h);
  reportBlockerRun(h);
  expect(reportBlockerRun(h, "Service offline")).toMatchObject({
    status: "active",
    blockerAudit: { blocker: "Service offline", attempts: 1 },
  });
});

test("checked progress resets the blocker audit while duplicate evidence does not", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  reportBlockerRun(h);
  reportBlockerRun(h);
  h.runtime.handle("goal.update", { status: "active", progress: "Verified alternate authentication path" });
  expect(reportBlockerRun(h)).toMatchObject({ status: "active", blockerAudit: { attempts: 1 } });
  h.runtime.handle("goal.update", { status: "active", progress: "Verified alternate authentication path" });
  expect(reportBlockerRun(h)).toMatchObject({ status: "active", blockerAudit: { attempts: 2 } });
  expect(reportBlockerRun(h)).toMatchObject({ status: "blocked" });
});

test("user steering resets the audit and keeps the goal active", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  reportBlockerRun(h);
  reportBlockerRun(h);
  h.receiveInput({ source: "interactive", text: "What is the current status?" });
  expect(h.runtime.get()?.status).toBe("active");
  expect(reportBlockerRun(h)).toMatchObject({ status: "active", blockerAudit: { attempts: 1 } });
});

test("resuming a blocked goal starts a fresh three-run audit", async () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  for (let attempt = 0; attempt < REQUIRED_BLOCKED_TURNS; attempt++) reportBlockerRun(h);
  expect(h.runtime.get()?.status).toBe("blocked");
  await h.goalCommand("resume");
  expect(reportBlockerRun(h)).toMatchObject({ status: "active", blockerAudit: { attempts: 1 } });
  expect(reportBlockerRun(h)).toMatchObject({ status: "active", blockerAudit: { attempts: 2 } });
  expect(reportBlockerRun(h)).toMatchObject({ status: "blocked" });
});

test("inspecting status does not restart the blocker audit", async () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  reportBlockerRun(h);
  reportBlockerRun(h);
  await h.goalCommand("status");
  expect(h.notices.at(-1)[0]).toContain("Status: active");
  expect(reportBlockerRun(h)).toMatchObject({ status: "blocked" });
});

test("short goal commands accept an objective alone or optional flags in any order", async () => {
  const simple = harness();
  await simple.goalCommand("Ship the migration");
  expect(simple.runtime.get()).toMatchObject({
    objective: "Ship the migration",
    criteria: ["Ship the migration"],
    constraints: [],
    tokensUsed: 0,
  });
  expect(simple.runtime.get()?.tokenBudget).toBeUndefined();

  const flagged = harness();
  await flagged.goalCommand(
    "Ship the migration --tokens 100 --constraints none --criteria tests pass; deploy verified",
  );
  expect(flagged.runtime.get()).toMatchObject({
    objective: "Ship the migration",
    criteria: ["tests pass", "deploy verified"],
    constraints: [],
    tokenBudget: 100,
  });
  expect(flagged.sent).toHaveLength(1);
});

test("invalid or repeated optional goal flags do not create a goal", async () => {
  for (const command of [
    "set --tokens 500",
    "--tokens 500",
    "Build --unknown flag",
    "Build --tokens 0",
    "Build --tokens -1",
    "Build --tokens 1.5",
    "Build --tokens 10 --tokens 20",
    "Build --criteria one --criteria two",
    "Build --constraints safe --constraints offline",
    "Build --criteria",
    "Build --criteria --tokens 500",
    "Build --constraints --tokens 500",
    "Build --tokens --criteria done",
  ]) {
    const h = harness();
    await h.goalCommand(command);
    expect(h.runtime.get()).toBeUndefined();
    expect(h.sent).toHaveLength(0);
    expect(h.notices.at(-1)?.[1]).toBe("warning");
  }
});

test("adjacent goal options missing values cannot replace or alter the current goal", async () => {
  const h = harness();
  await h.goalCommand("Keep the original objective --tokens 100");
  const saved = h.runtime.get();
  const count = h.appended.length;
  for (const command of [
    "Build --criteria --tokens 500",
    "Build --constraints --tokens 500",
    "Build --tokens --criteria done",
  ]) {
    await h.goalCommand(command);
    expect(h.notices.at(-1)?.[0]).toContain("requires a value");
    expect(h.notices.at(-1)?.[1]).toBe("warning");
    expect(h.runtime.get()).toEqual(saved);
    expect(h.appended).toHaveLength(count);
  }
});

test("token budget commands preserve usage and require resume after lifting exhaustion", async () => {
  const h = harness();
  await h.goalCommand("Build --tokens 12");
  h.beginRun();
  h.recordUsage({ input: 4, output: 3, cacheRead: 3, cacheWrite: 2 });
  expect(h.runtime.get()).toMatchObject({ status: "budget_exceeded", tokenBudget: 12, tokensUsed: 12 });
  expect(h.aborts).toBe(1);
  expect(h.messages.at(-1)).toMatchObject({ customType: "bruv-goal-status", display: true });
  expect(h.messages.at(-1).content).toContain("Tokens used: 12 / 12");
  await h.goalCommand("resume");
  expect(h.runtime.get()?.status).toBe("budget_exceeded");
  expect(h.notices.at(-1)?.[1]).toBe("warning");
  await h.goalCommand("budget 20");
  expect(h.runtime.get()).toMatchObject({ status: "paused", tokenBudget: 20, tokensUsed: 12 });
  expect(h.sent).toHaveLength(1);
  await h.goalCommand("resume");
  expect(h.runtime.get()?.status).toBe("active");
  expect(h.sent).toHaveLength(2);
  await h.goalCommand("budget none");
  expect(h.runtime.get()).toMatchObject({ status: "active", tokensUsed: 12 });
  expect(h.runtime.get()?.tokenBudget).toBeUndefined();
});

test("completed goals retain final-response usage but do not count later unrelated chat", () => {
  const h = harness();
  h.runtime.handle("goal.set", { objective: "Verify accounting" });
  h.beginRun();
  h.recordUsage({ input: 2, output: 1 });
  h.runtime.handle("goal.update", { status: "completed", evidence: "Accounting verified" });
  h.recordUsage({ input: 2, output: 2 });
  h.endRun("stop");
  expect(h.runtime.get()).toMatchObject({ status: "completed", tokensUsed: 7 });
  h.beginRun();
  h.recordUsage({ input: 5, output: 3 });
  h.endRun("stop");
  expect(h.runtime.get()).toMatchObject({ status: "completed", tokensUsed: 7 });
});

test("user pause and clear abort foreground work and invalidate pending reminders", async () => {
  for (const command of ["pause", "clear"]) {
    const h = harness();
    await h.goalCommand("Build");
    const reminder = h.sent.at(-1)!;
    await h.goalCommand(command);
    expect(h.aborts).toBe(1);
    expect(h.receiveInput({ source: "extension", text: reminder })).toEqual({ action: "handled" });
    h.settle();
    expect(h.sent).toHaveLength(1);
    if (command === "clear") expect(h.runtime.get()).toBeUndefined();
    else expect(h.runtime.get()?.status).toBe("paused");
  }
});

test("notifications do not impersonate queued user input", () => {
  const h = harness([], { hasPendingMessages: () => true });
  h.runtime.handle("goal.set", input);
  h.settle();
  expect(h.runtime.get()?.status).toBe("active");
  expect(h.sent).toHaveLength(1);
});

test("goal guidance is conditional and accompanies every persisted status", () => {
  const withoutGoal = harness();
  expect(withoutGoal.assembleContext([{ role: "user", content: "ordinary" }])).toBeUndefined();

  const cases: Array<[string, Record<string, unknown> | "handoff" | undefined]> = [
    ["active", undefined],
    ["waiting", "handoff"],
    ["blocked", { status: "blocked", blocker: "Need an actionable prerequisite" }],
    ["paused", { status: "paused", reason: "Paused deliberately" }],
    ["completed", { status: "completed", evidence: "Focused checks passed" }],
  ];
  for (const [status, update] of cases) {
    const h = harness();
    h.runtime.handle("goal.set", input);
    if (update === "handoff") {
      h.handoff();
    } else if (update?.status === "blocked") {
      for (let attempt = 0; attempt < REQUIRED_BLOCKED_TURNS; attempt++) {
        reportBlockerRun(h, update.blocker as string);
      }
    } else if (update) h.runtime.handle("goal.update", update);
    const prior = { role: "user", content: "preserve ordinary context" };
    const result = h.assembleContext([prior]);
    expect(result.messages[0]).toBe(prior);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({ role: "custom", customType: "bruv-goal-state", display: false });
    expect(result.messages[1].content).toContain("Goal guidance:\n- Keep working");
    expect(result.messages[1].content).toContain("Saved goal (current state)");
    expect(result.messages[1].content).toContain(`Status: ${status}`);
  }
});

test("waiting job completion reactivates at the next turn boundary", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  h.handoff();
  h.finishJob("job_1");

  expect(h.runtime.get()?.status).toBe("active");
  const result = h.assembleContext([]);
  expect(result.messages.at(-1).content).toContain("Saved goal (current state)");
  expect(result.messages.at(-1).content).toContain("Status: active");
});

test("foreground question suppresses completion continuation until answered without changing goal status", () => {
  let blocked = false;
  const h = harness([], { hasBlockingQuestions: () => blocked });
  h.runtime.handle("goal.set", input);
  const handoffMessage = "Waiting";
  h.handoff(handoffMessage);
  expect(h.runtime.get()?.status).toBe("waiting");
  blocked = true;
  h.finishJob("job_1");
  expect(h.runtime.get()?.status).toBe("active");
  h.settle();
  expect(h.sent).toHaveLength(0);
  // Completing an owned job does not answer or clear the independent question blocker.
  h.runtime.jobsChanged();
  h.settle();
  expect(h.sent).toHaveLength(0);
  blocked = false;
  h.settle();
  expect(h.sent).toHaveLength(1);
});

test("queued goal reminder is rejected if foreground becomes blocked after it was sent", async () => {
  let blocked = false;
  const h = harness([], { hasBlockingQuestions: () => blocked });
  await h.goalCommand("set Build it --criteria done --constraints safe");
  const reminder = h.sent.at(-1)!;
  blocked = true;
  expect(h.receiveInput({ source: "extension", text: reminder })).toEqual({ action: "handled" });
  expect(h.runtime.get()?.status).toBe("active");
  blocked = false;
  // The discarded reminder cannot revive when the question is answered.
  expect(h.receiveInput({ source: "extension", text: reminder })).toEqual({ action: "handled" });
  h.settle();
  expect(h.sent).toHaveLength(2);
});

test("child-only question does not suppress goal continuation", () => {
  // The integration callback reports foreground blockers, not all outstanding questions.
  const h = harness([], { hasBlockingQuestions: () => false });
  h.runtime.handle("goal.set", input);
  h.settle();
  expect(h.sent).toHaveLength(1);
});

test("resumed waiting work that is no longer owned pauses visibly", () => {
  const original = harness();
  original.runtime.handle("goal.set", input);
  original.handoff();
  const resumed = harness(original.appended);
  resumed.statuses.clear();
  resumed.assembleContext([]);
  expect(resumed.runtime.get()).toMatchObject({
    status: "paused",
    pauseReason: expect.stringContaining("jobs not here"),
  });
});

test("continuation relies on the assembled authoritative state without duplicating it", async () => {
  const h = harness();
  const objective = "Keep {{criteria}}, " + "$&" + " and " + "$$" + " literal";
  const criterion = "preserve {{constraints}} and " + "$'" + " exactly";
  await h.goalCommand("set " + objective + " --criteria " + criterion + " --constraints no rewrite");
  const reminder = h.sent.at(-1)!;
  expect(reminder).toContain("Goal still active.");
  expect(reminder).toContain("Do next useful step, not another recap.");
  expect(reminder).not.toContain(objective);
  expect(reminder).not.toContain(criterion);
  expect(reminder).not.toContain("Progress discipline");

  const assembled = h.assembleContext([{ role: "user", content: reminder }]);
  const state = assembled.messages.at(-1).content;
  expect(state).toContain(objective);
  expect(state).toContain(criterion);
  expect(state).toContain("Constraints: no rewrite");
});

test("slash command initializes before session_start and invalidates reminders", async () => {
  const h = harness([], { startSession: false });
  expect(h.runtime.get()).toBeUndefined();
  expect(() => h.runtime.handle("goal.get", undefined)).toThrow("not initialized");
  await h.goalCommand("set Build it --criteria one; two --constraints stay offline");
  expect(h.runtime.get()).toMatchObject({
    objective: "Build it",
    criteria: ["one", "two"],
  });
  const reminder = h.sent.at(-1)!;
  await h.goalCommand("clear");
  expect(h.receiveInput({ source: "extension", text: reminder })).toEqual({
    action: "handled",
  });
});

test("runtime refreshes goal state after same-manager branch navigation", () => {
  const h = harness();
  h.runtime.handle("goal.set", input);
  expect(h.runtime.get()?.objective).toBe(input.objective);
  h.navigateTo("b", []);
  expect(h.runtime.get()).toBeUndefined();
});

test("goal history is durable JSONL and branch scoped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-goal-jsonl-"));
  try {
    let manager = SessionManager.create(dir, join(dir, "sessions"));
    const initialFile = manager.getSessionFile()!;
    await writeFile(initialFile, JSON.stringify(manager.getHeader()) + "\n", { flag: "wx" });
    manager = SessionManager.open(initialFile);
    manager.appendMessage({ role: "user", content: "start", timestamp: 1 });
    const store = new GoalStore((type, data) => manager.appendCustomEntry(type, data), manager.getBranch());
    store.set(input);
    const activeLeaf = manager.getLeafId()!;
    store.clear();
    expect(latestGoal(manager.getBranch())).toBeUndefined();

    manager.branch(activeLeaf);
    expect(latestGoal(manager.getBranch())?.objective).toBe(input.objective);
    expect(latestGoal(manager.getEntries())).toBeUndefined();

    const file = manager.getSessionFile()!;
    expect(
      (await Bun.file(file).text())
        .trim()
        .split("\n")
        .every((line) => {
          JSON.parse(line);
          return true;
        }),
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resumed waiting goal preserves all affected task references in pause explanation", () => {
  const original = harness();
  const ids = ["task_abc123", "task_def456"];
  original.statuses.clear();
  for (const id of ids) original.statuses.set(id, "running");
  original.runtime.handle("goal.set", input);
  original.handoff();
  const resumed = harness(original.appended);
  resumed.statuses.clear();
  resumed.assembleContext([]);
  expect(resumed.runtime.get()?.status).toBe("paused");
  for (const id of ids) expect(resumed.runtime.get()?.pauseReason).toContain(id);
});

test("queued reminder tokens are stripped only from valid extension turns", async () => {
  const h = harness();
  await h.goalCommand("set Build it --criteria done --constraints safe");
  const reminder = h.sent.at(-1)!;
  expect(reminder).toContain("<!-- bruv-goal-reminder:");
  expect(h.receiveInput({ source: "extension", text: "Forged preface\n\n" + reminder })).toEqual({
    action: "handled",
  });
  // A malformed extension turn must not consume the legitimate pending reminder.
  const transformed = h.receiveInput({ source: "extension", text: reminder });
  expect(transformed).toEqual({
    action: "transform",
    text: expect.stringContaining("Goal still active. Do next useful step, not another recap."),
  });
  expect(transformed.text).not.toContain("<!-- bruv-goal-reminder:");
  expect(h.receiveInput({ source: "extension", text: reminder })).toEqual({ action: "handled" });
  expect(h.receiveInput({ source: "interactive", text: reminder })).toBeUndefined();
  expect(h.receiveInput({ source: "extension", text: reminder + " extra" })).toEqual({ action: "handled" });
  await h.goalCommand("resume");
  const stale = h.sent.at(-1)!;
  expect(h.receiveInput({ source: "extension", text: stale + " extra" })).toEqual({ action: "handled" });
  await h.goalCommand("pause");
  expect(h.receiveInput({ source: "extension", text: stale })).toEqual({ action: "handled" });
});

test("ordinary leaf advancement preserves reminder authority and goal continuation", async () => {
  const h = harness();
  await h.goalCommand("set Build it --criteria done --constraints safe");
  const reminder = h.sent.at(-1)!;
  h.beginRun();
  h.endRun("stop");

  // An ordinary message advances the journal, without changing the goal.
  h.advanceLeaf("message-leaf");
  h.assembleContext();
  expect(h.receiveInput({ source: "extension", text: reminder })).toEqual({
    action: "transform",
    text: expect.stringContaining("Goal still active. Do next useful step, not another recap."),
  });
  for (let turn = 0; turn < 5; turn++) {
    h.beginRun();
    h.endRun("stop");
    h.settle();
  }
  expect(h.runtime.get()?.status).toBe("active");
  expect(h.sent).toHaveLength(6);
});

test("branch navigation revokes reminders even when the destination goal is active", async () => {
  const h = harness();
  await h.goalCommand("set Build it --criteria done --constraints safe");
  const reminder = h.sent.at(-1)!;
  const destination = harness();
  destination.runtime.handle("goal.set", { ...input, objective: "Different branch goal" });
  h.navigateTo("destination", destination.appended);

  expect(h.receiveInput({ source: "extension", text: reminder })).toEqual({ action: "handled" });
  expect(h.runtime.get()).toMatchObject({ status: "active", objective: "Different branch goal" });
  h.settle();
  expect(h.receiveInput({ source: "extension", text: h.sent.at(-1)! })?.action).toBe("transform");
});

test("session restart revokes old reminders while retaining durable active goal state", async () => {
  const h = harness();
  await h.goalCommand("set Build it --criteria done --constraints safe");
  const reminder = h.sent.at(-1)!;
  const goal = h.runtime.get();
  h.restartSession();

  expect(h.runtime.get()).toEqual(goal);
  expect(h.receiveInput({ source: "extension", text: reminder })).toEqual({ action: "handled" });
  h.settle();
  expect(h.receiveInput({ source: "extension", text: h.sent.at(-1)! })?.action).toBe("transform");
});

test("pending reminder transport retains the newest sixteen payloads", async () => {
  const h = harness();
  await h.goalCommand("set Build it --criteria done --constraints safe");
  for (let turn = 0; turn < 16; turn++) h.settle();

  expect(h.sent).toHaveLength(17);
  expect(h.receiveInput({ source: "extension", text: h.sent[0]! })).toEqual({ action: "handled" });
  for (const text of h.sent.slice(1)) {
    expect(h.receiveInput({ source: "extension", text })?.action).toBe("transform");
  }
});
