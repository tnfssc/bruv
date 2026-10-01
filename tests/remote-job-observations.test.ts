import { expect, test } from "bun:test";
import type { RemoteTask } from "../src/remote/client";
import { clearRemoteJobEvents, remoteJobEvents } from "../src/remote/job-events";
import { publishRemoteJobObservations, remoteJobObservation } from "../src/remote/job-observations";

const task = (id: string, session?: string): RemoteTask => ({
  taskId: id,
  jobSessionFile: session,
  host: "host",
  ownerId: "owner",
  epoch: "epoch",
  repoPath: "/repo",
  prompt: "prompt",
  cursor: 0,
  events: [],
  outcome: "accepted",
  task: { taskId: id, state: "running" },
});

test("shared SSH cache observations stay in their durable parent session", () => {
  const a = "/test/remote-observer-a",
    b = "/test/remote-observer-b";
  try {
    const state = { tasks: { a: task("a", a), b: task("b", b), old: task("old") } };
    publishRemoteJobObservations(state, a);
    expect(
      remoteJobEvents(a)
        .snapshot()
        .map((t) => t.taskId),
    ).toEqual(["a"]);
    expect(remoteJobEvents(b).snapshot()).toEqual([]);
    publishRemoteJobObservations(state, b);
    expect(
      remoteJobEvents(b)
        .snapshot()
        .map((t) => t.taskId),
    ).toEqual(["b"]);
    publishRemoteJobObservations(state, undefined);
  } finally {
    clearRemoteJobEvents(a);
    clearRemoteJobEvents(b);
  }
});

test("unknown with an error is not terminal; waits carry human-only instructions", () => {
  const t = task("one", "/session");
  t.task = {
    taskId: "one",
    state: "unknown",
    error: "offline",
    questions: [
      { id: "q", status: "pending", version: 2, owner: { sessionId: "native", branchId: "branch" }, text: "Proceed?" },
    ],
    capabilityNeeds: [{ id: "need", kind: "repo.read", input: "file" }],
  };
  const observation = remoteJobObservation(t);
  expect(observation.state).toBe("unknown");
  expect(observation.actionable).toContain("Human /questions answer");
  expect(observation.actionable).toContain('"version":2');
  expect(observation.actionable).toContain("repo.read");
  t.replies = {
    q: { id: "q", owner: { sessionId: "native", branchId: "branch" }, version: 2, text: "yes", replyId: "reply" },
  };
  expect(remoteJobObservation(t).actionable).not.toContain("Proceed?");
});

test("terminal observations suppress stale waits and bound assistant output", () => {
  const t = task("done", "/session");
  t.task = { taskId: "done", state: "done", capabilityNeeds: [{ id: "old" }] };
  t.events = [{ seq: 1, event: { type: "message_end", message: { role: "assistant", content: "x".repeat(20000) } } }];
  const observation = remoteJobObservation(t);
  expect(observation.state).toBe("done");
  expect(observation.actionable).toBeUndefined();
  expect(observation.preview!.length).toBeLessThanOrEqual(4000);
});

test("normal parent result includes protected repository return before potentially long output", () => {
  const t = task("returned", "/session");
  t.task = { taskId: "returned", state: "done" };
  t.repository = { status: "review", artifact: "/artifacts/return.patch", reason: "Parent tracked file changed" };
  t.events = [{ seq: 1, event: { type: "message_end", message: { role: "assistant", content: "x".repeat(20000) } } }];
  expect(remoteJobObservation(t).preview).toContain("Parent tracked file changed");
});
