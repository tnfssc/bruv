import { expect, test } from "bun:test";
import { renderHuman, taskLine } from "../src/remote/human-rendering";
import type { RemoteTask } from "../src/remote/client";

const task = (state = "running") => ({ taskId: "task-1", task: { state }, events: [] }) as unknown as RemoteTask;
const status = (tasks: RemoteTask[], repositoryPreparations: unknown[] = []) =>
  renderHuman({ tasks, repositoryPreparations }, "status");

test("preparation-only status preserves both recovery states, without pretending no work exists", () => {
  const text = status(
    [],
    [
      { taskId: "snap", state: "snapshot_incomplete", artifact: "/local/snap" },
      {
        taskId: "prepared",
        state: "prepared_not_confirmed_launched",
        artifact: "/local/prepared",
        prompt: "private prompt",
      },
    ],
  );
  expect(text).toContain("snap · snapshot incomplete");
  expect(text).toContain("inspect local preparation");
  expect(text).toContain("prepared · prepared, launch not confirmed");
  expect(text).toContain("reconcile with owner before retrying same task ID");
  expect(text).toContain("/local/prepared");
  expect(text).not.toContain("No saved tasks");
  expect(text).not.toContain("private prompt");
  expect(status([])).toContain("No saved tasks or repository preparations");
});

test("mixed status includes task and orphan preparation", () => {
  const text = status([task()], [{ taskId: "orphan", state: "prepared_not_confirmed_launched" }]);
  expect(text).toContain("task-1 · running");
  expect(text).toContain("Repository preparation orphan");
});

test("uncertain answer identifies question and saved reply in task and status", () => {
  const t = { ...task(), replyDelivery: { "q-1": { replyId: "reply-7", status: "uncertain" as const } } };
  expect(taskLine(t)).toContain("answer delivery uncertain: q-1");
  for (const text of [status([t]), renderHuman(t)]) {
    expect(text).toContain("Answer q-1 (reply reply-7): delivery uncertain");
    expect(text).toContain("/remote sync task-1 before retrying");
    expect(text).not.toContain('{"replyId"');
  }
});

test.each([
  ["requested", "requested locally", "not terminal"],
  ["uncertain", "delivery uncertain", "not terminal"],
  ["confirmed", "request acknowledged", "not terminal"],
  ["confirmed", "request acknowledged", "terminal"],
] as const)("cancel delivery %s (%s) vs %s", (delivery, label, terminal) => {
  const t = {
    ...task(terminal === "terminal" ? "cancelled" : "running"),
    cancelRequested: true,
    cancelDelivery: { status: delivery },
  } as RemoteTask;
  expect(taskLine(t)).toContain("cancel " + delivery + " (" + terminal + ")");
  for (const text of [status([t]), renderHuman(t)]) {
    expect(text).toContain("Cancellation: " + label);
    expect(text).toContain("observed task state: " + (terminal === "terminal" ? "cancelled" : "running"));
    if (terminal === "not terminal") expect(text).toContain("/remote sync task-1 for terminal truth");
    else expect(text).not.toContain("for terminal truth");
  }
});

test("conflict details identify the retained artifact without implying automatic application", () => {
  const text = renderHuman({
    taskId: "conflict",
    events: [],
    task: { state: "done" },
    repository: { status: "review", reason: "local file changed", artifact: "/safe/return.patch" },
  });
  expect(text).toContain("local file changed");
  expect(text).toContain("/safe/return.patch");
  expect(text).toContain("Inspect local worktree before applying");
});

test("saved task details describe capability waits without granting access", () => {
  const text = renderHuman({
    taskId: "cap",
    events: [],
    task: {
      state: "running",
      capabilityNeeds: [{ kind: "repo.read", input: "on-demand.txt" }],
      questions: [{ id: "q", status: "pending", text: "Choose region" }],
    },
  });
  expect(text).toContain("repo.read");
  expect(text).toContain("on-demand.txt");
  expect(text).toContain("Choose region");
  expect(text).toContain("not granted");
});
