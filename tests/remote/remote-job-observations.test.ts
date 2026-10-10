import { expect, test } from "bun:test";
import type { RemoteTask } from "../../src/remote/client";
import { clearRemoteJobEvents, type RemoteJobObservation, remoteJobEvents } from "../../src/remote/job-events";
import {
  publishRemoteJobObservations,
  remoteJobObservation,
  remoteCompletionSummary,
} from "../../src/remote/job-observations";

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
  expect(observation.actionable).toContain("Waiting for user: /questions answer");
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

test("bounded normal completion includes the actual child result and safe return, not long artifact metadata", () => {
  const t = task("done", "/parent");
  t.task = { taskId: "done", state: "done" };
  t.repository = { status: "applied", artifact: "/long/".repeat(100) };
  t.events = [
    {
      seq: 1,
      event: {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "ACTUAL_CHILD_RESULT" }] },
      },
    },
  ];
  const text = remoteCompletionSummary(remoteJobObservation(t), "ssh:encoded");
  expect(text).toContain("ACTUAL_CHILD_RESULT");
  expect(text).toContain("return applied");
  expect(text.length).toBeLessThanOrEqual(430);
});

test("accepted remains active; human notices keep sorted unanswered questions and their route", () => {
  const t = task("accepted");
  t.task = {
    taskId: t.taskId,
    state: "accepted",
    questions: [
      { id: "z", status: "pending", question: "Last?" },
      { id: "answered", status: "pending", text: "Already answered" },
      { id: "a", status: "pending", version: 3, text: "First?" },
      { id: "closed", status: "resolved", text: "Closed" },
    ],
  };
  t.replies = {
    answered: {
      id: "answered",
      owner: { sessionId: "native", branchId: "branch" },
      version: 1,
      text: "yes",
      replyId: "r",
    },
  };
  t.events = [
    { seq: 1, event: { type: "message_end", message: { role: "assistant", content: "Not a final result" } } },
  ];
  const observation = remoteJobObservation(t);
  expect(observation.state).toBe("running");
  expect(JSON.parse(observation.preview!)).toEqual({ cached: true, state: "accepted" });
  expect(JSON.parse(observation.actionable!)).toEqual({
    questions: [
      { id: "a", version: 3, text: "First?" },
      { id: "z", text: "Last?" },
    ],
    capabilityNeeds: [],
    action: "Waiting for user: /remote answer or /remote grant.",
  });
});

test("cancelled carries the latest completed assistant text, not later tool or partial messages", () => {
  const t = task("cancelled", "/parent");
  t.task = { taskId: t.taskId, state: "cancelled", questions: [{ id: "stale", status: "pending", text: "Proceed?" }] };
  t.events = [
    { seq: 1, event: { type: "message_end", message: { role: "assistant", content: "Earlier" } } },
    {
      seq: 2,
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Latest" },
            { type: "toolCall", name: "execute" },
            { type: "text", text: "result" },
          ],
        },
      },
    },
    { seq: 3, event: { type: "message_end", message: { role: "toolResult", content: "Tool output" } } },
    { seq: 4, event: { type: "message_update", message: { role: "assistant", content: "Unfinished" } } },
  ];
  const events = structuredClone(t.events);
  const observation = remoteJobObservation(t);
  expect(observation.state).toBe("cancelled");
  expect(observation.actionable).toBeUndefined();
  expect(JSON.parse(observation.preview!).lastAssistant).toEqual({ message: { content: "Latest\nresult" } });
  expect(remoteCompletionSummary(observation, "ssh:cancelled")).toBe("ssh:cancelled cached cancelled — Latest\nresult");
  expect(t.events).toEqual(events);
});

test("cached result bounds include JSON escaping", () => {
  const t = task("escaped", "/parent");
  t.task = { taskId: t.taskId, state: "done" };
  t.events = [
    { seq: 1, event: { type: "message_end", message: { role: "assistant", content: '"\n\t\\'.repeat(2000) } } },
  ];
  const observation = remoteJobObservation(t);
  const content = JSON.parse(observation.preview!).lastAssistant.message.content;
  expect(content.length).toBeGreaterThan(0);
  expect(JSON.stringify(content).length).toBeLessThanOrEqual(1400);
  expect(observation.preview!.length).toBeLessThanOrEqual(4000);
});

test("completion summaries decode persisted blocks and preserve malformed preview text", () => {
  const observation: RemoteJobObservation = {
    ownerId: "owner",
    epoch: "epoch",
    taskId: "escaped",
    state: "done",
    preview: JSON.stringify({
      repository: { status: "review", reason: "Tracked file changed" },
      error: "offline",
      lastAssistant: {
        message: {
          content: [{ type: "text", text: "Saved result" }, { type: "toolCall" }, { type: "text", text: "Next line" }],
        },
      },
    }),
  };
  expect(remoteCompletionSummary(observation, "ssh:escaped")).toBe(
    "ssh:escaped cached done; return review; error offline — Saved result\nNext line; Tracked file changed",
  );
  expect(remoteCompletionSummary({ ...observation, preview: "not JSON" }, "ssh:escaped")).toBe(
    "ssh:escaped cached done — not JSON",
  );
});
