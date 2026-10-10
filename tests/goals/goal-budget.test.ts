import { describe, expect, test } from "bun:test";
import { GOAL_ENTRY_TYPE, GoalStore, latestGoal } from "../../src/goals/store";
import type { GoalEntry } from "../../src/goals/types";

function journal() {
  const entries: { type: "custom"; customType: string; data: GoalEntry }[] = [];
  const store = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }));
  return { entries, store };
}

describe("goal creation", () => {
  test("an objective alone creates an unlimited goal with useful defaults", () => {
    const { store, entries } = journal();
    const goal = store.set({ objective: "  Finish the migration  " });
    expect(goal).toMatchObject({
      objective: "Finish the migration",
      criteria: ["Finish the migration"],
      constraints: [],
      tokensUsed: 0,
      status: "active",
    });
    expect(goal.tokenBudget).toBeUndefined();
    expect(latestGoal(entries)).toEqual(goal);
  });

  test("explicit empty criteria and invalid optional budgets are rejected without persisting", () => {
    const { store, entries } = journal();
    expect(() => store.set({ objective: "Finish", criteria: [] })).toThrow("criteria is required");
    for (const tokenBudget of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100", null]) {
      expect(() => store.set({ objective: "Finish", tokenBudget })).toThrow("positive safe integer");
    }
    expect(entries).toHaveLength(0);
    expect(store.set({ objective: "Finish", tokenBudget: 1 }).tokenBudget).toBe(1);
  });

  test("an unfinished goal cannot be replaced, including while paused, blocked, waiting, or exhausted", () => {
    const { store, entries } = journal();
    const initial = store.set({ objective: "Original goal", tokenBudget: 100 });
    const rejectReplacement = () => {
      const before = store.get();
      const length = entries.length;
      expect(() => store.set({ objective: "Replacement" })).toThrow("unfinished goal");
      expect(store.get()).toEqual(before);
      expect(entries).toHaveLength(length);
    };
    rejectReplacement();
    store.update({ status: "paused" });
    rejectReplacement();
    store.update({ status: "blocked", blocker: "External credentials needed" });
    rejectReplacement();
    store.update({ status: "waiting", pendingJobIds: ["task_owned"] }, new Set(["task_owned"]));
    rejectReplacement();
    store.addUsage(100);
    rejectReplacement();
    store.clear();
    const replacement = store.set({ objective: "Replacement" });
    expect(replacement.id).not.toBe(initial.id);
    expect(replacement.tokensUsed).toBe(0);
    store.update({ status: "completed", evidence: "Verified all requested behavior" });
    expect(store.set({ objective: "Next goal" }).objective).toBe("Next goal");
  });
});

describe("durable goal token accounting", () => {
  test("usage accumulates across reloads and stops at the exact budget boundary", () => {
    const { store, entries } = journal();
    store.set({ objective: "Finish", tokenBudget: 100 });
    expect(store.addUsage(40)).toMatchObject({ tokensUsed: 40, status: "active" });
    const resumed = new GoalStore((customType, data) => entries.push({ type: "custom", customType, data }), entries);
    expect(resumed.addUsage(60)).toMatchObject({ tokensUsed: 100, tokenBudget: 100, status: "budget_exceeded" });
    expect(() => resumed.update({ status: "active" })).toThrow("budget is exhausted");
    expect(() => resumed.update({ status: "waiting", pendingJobIds: ["task_owned"] })).toThrow("budget is exhausted");
    expect(latestGoal(entries)).toEqual(resumed.get());
  });

  test("a waiting goal becomes budget exhausted and loses its running-job bookkeeping", () => {
    const { store, entries } = journal();
    store.set({ objective: "Finish", tokenBudget: 10 });
    store.update({ status: "waiting", pendingJobIds: ["task_owned"] }, new Set(["task_owned"]));
    expect(store.addUsage(15)).toMatchObject({ tokensUsed: 15, status: "budget_exceeded" });
    expect(store.get()?.pendingJobIds).toBeUndefined();
    expect(latestGoal(entries)).toEqual(store.get());
  });

  test("final usage is retained after completion without undoing the completion result", () => {
    const { store, entries } = journal();
    store.set({ objective: "Finish", tokenBudget: 10 });
    store.update({ status: "completed", evidence: "Migration verified" });
    expect(store.addUsage(15)).toMatchObject({
      status: "completed",
      evidence: "Migration verified",
      tokensUsed: 15,
    });
    expect(latestGoal(entries)).toEqual(store.get());
  });

  test("late usage preserves an explicit pause or blocker and still prevents a budget bypass", () => {
    for (const status of ["paused", "blocked"] as const) {
      const { store } = journal();
      store.set({ objective: "Finish", tokenBudget: 10 });
      store.update({ status, reason: "User paused", blocker: "User input needed" });
      expect(store.addUsage(15)).toMatchObject({ status, tokensUsed: 15 });
      expect(() => store.update({ status: "active" })).toThrow("budget is exhausted");
    }
  });

  test("unlimited accounting saturates safely and invalid usage cannot corrupt it", () => {
    const { store, entries } = journal();
    expect(store.addUsage(100)).toBeUndefined();
    store.set({ objective: "Finish" });
    const original = store.get();
    expect(store.addUsage(0)).toEqual(original);
    expect(entries).toHaveLength(1);
    for (const tokens of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.addUsage(tokens)).toThrow("nonnegative safe integer");
    }
    store.addUsage(Number.MAX_SAFE_INTEGER - 2);
    expect(store.addUsage(20)).toMatchObject({ tokensUsed: Number.MAX_SAFE_INTEGER, status: "active" });
    expect(latestGoal(entries)).toEqual(store.get());
  });

  test("budget exhaustion cannot be set directly and lifting a limit requires an explicit resume", () => {
    const { store, entries } = journal();
    store.set({ objective: "Finish", tokenBudget: 10 });
    expect(() => store.update({ status: "budget_exceeded" })).toThrow("runtime-managed");
    store.addUsage(15);
    expect(store.setBudget(15)).toMatchObject({ status: "budget_exceeded", tokenBudget: 15, tokensUsed: 15 });
    expect(store.setBudget(20)).toMatchObject({ status: "paused", tokenBudget: 20, tokensUsed: 15 });
    expect(store.get()?.pauseReason).toContain("Resume");
    expect(latestGoal(entries)).toEqual(store.get());
    expect(store.update({ status: "active" }).status).toBe("active");
    expect(store.setBudget(5)).toMatchObject({ status: "budget_exceeded", tokensUsed: 15 });
    expect(store.setBudget(undefined)).toMatchObject({ status: "paused", tokensUsed: 15 });
    expect(store.get()?.tokenBudget).toBeUndefined();
    expect(store.update({ status: "active" }).status).toBe("active");
    expect(latestGoal(entries)).toEqual(store.get());
  });

  test("failed budget and usage appends leave in-memory state intact", () => {
    let fail = false;
    const store = new GoalStore(() => {
      if (fail) throw new Error("disk full");
    });
    const initial = store.set({ objective: "Finish", tokenBudget: 10 });
    for (const tokenBudget of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.setBudget(tokenBudget)).toThrow("positive safe integer");
    }
    fail = true;
    expect(() => store.addUsage(20)).toThrow("disk full");
    expect(store.get()).toEqual(initial);
    expect(() => store.setBudget(5)).toThrow("disk full");
    expect(store.get()).toEqual(initial);
  });

  test("legacy version-one entries load with zero usage and no implicit budget", () => {
    const { store, entries } = journal();
    store.set({ objective: "Finish", criteria: ["Migration verified"], constraints: [] });
    const legacy = JSON.parse(JSON.stringify(entries));
    delete legacy[0].data.goal.tokensUsed;
    const goal = latestGoal(legacy);
    expect(goal?.tokensUsed).toBe(0);
    expect(goal?.tokenBudget).toBeUndefined();
    expect(goal?.status).toBe("active");
  });

  test("malformed persisted accounting revokes authority instead of restoring an older goal", () => {
    const { store, entries } = journal();
    const initial = store.set({ objective: "Finish", tokenBudget: 10 });
    const invalid = [
      ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", null].map((tokensUsed) => ({ tokensUsed })),
      ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10", null].map((tokenBudget) => ({ tokenBudget })),
      { status: "active", tokensUsed: 10 },
      { status: "budget_exceeded", tokensUsed: 9 },
      { status: "budget_exceeded", tokensUsed: 10, tokenBudget: undefined },
    ];
    for (const patch of invalid) {
      const corrupted = {
        type: "custom",
        customType: GOAL_ENTRY_TYPE,
        data: {
          version: 1,
          operation: "update",
          at: "later",
          goal: { ...initial, revision: initial.revision + 1, ...patch },
        },
      };
      expect(latestGoal([...entries, corrupted])).toBeUndefined();
    }
  });
});
