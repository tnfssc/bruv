import { expect, test } from "bun:test";
import { renderHuman, taskLine, RemoteAttention } from "../src/remote/human-rendering";
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

const page = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  taskId: "task",
  offset: 0,
  events: events.map((event, i) => ({ seq: i + 1, event })),
  ...extra,
});

test("cached transcript reads as conversation and tools, not machine JSON", () => {
  const output = renderHuman(
    page([
      {
        type: "message_end",
        message: {
          role: "user",
          content: [
            { type: "text", text: "Investigate" },
            { type: "image", mimeType: "image/png", data: "secret" },
          ],
        },
      },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running check" },
            { type: "toolCall", name: "shell", arguments: { command: "ls" } },
            { type: "text", text: "Done" },
          ],
          textSignature: "secret",
        },
      },
      { type: "tool_execution_start", toolName: "shell", args: { command: "ls" }, requestId: "internal" },
      {
        type: "tool_execution_end",
        toolName: "shell",
        result: { content: [{ type: "text", text: "file.ts\nsecond line" }] },
      },
      {
        type: "message_end",
        message: {
          role: "toolResult",
          toolName: "shell",
          isError: true,
          content: [{ type: "text", text: "permission denied" }],
        },
      },
      { type: "message_end", message: { role: "assistant", content: "Final answer" } },
    ]),
    "transcript",
  );
  for (const text of [
    "#1 user:\nInvestigate",
    "[image image/png]",
    "#2 assistant:\nRunning check",
    "Tool call shell",
    "file.ts\nsecond line",
    "Tool result shell (error)",
    "permission denied",
    "Final answer",
  ])
    expect(output).toContain(text);
  for (const text of ["textSignature", "secret", "requestId", '"type":"message_end"'])
    expect(output).not.toContain(text);
});

test("unknown and lifecycle events, paging, transcript gaps and explicit raw remain visible", () => {
  const input = page(
    [
      { type: "agent_start" },
      { type: "new_event", payload: { useful: "visible", textSignature: "internal" } },
      {
        type: "tool_execution_update",
        toolName: "shell",
        partialResult: { content: [{ type: "text", text: "still running" }] },
      },
    ],
    { offset: 50, nextOffset: 53, transcriptComplete: false, task: { textOutputGap: "lost bytes" } },
  );
  const output = renderHuman(input, "transcript");
  for (const text of [
    "offset 50",
    "#1 agent_start",
    "new_event",
    "visible",
    "still running",
    "/remote transcript task 53",
    "transcript incomplete",
    "lost bytes",
  ])
    expect(output).toContain(text);
  expect(output).not.toContain("textSignature");
  expect(renderHuman(input, "transcript-raw")).toContain("textSignature");
  expect(renderHuman(page([], { offset: 53 }), "transcript")).toContain("End of cached transcript.");
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

test("human capability outcomes are readable scoped receipts, not protocol JSON", () => {
  const grant = renderHuman({ grant: { id: "g", taskId: "t", kinds: ["repo.read"] }, scope: "/fixture/repo" });
  for (const value of [
    "Local capability granted",
    "task t",
    "Authority: repo.read",
    "Local repository: /fixture/repo",
    "Grant: g",
  ])
    expect(grant).toContain(value);
  expect(grant).not.toContain('"grant":');
  expect(renderHuman({ revoked: true, grantId: "g", ownerNotified: true })).toBe(
    "Local capability revoked · g\nOwner acknowledged revocation.",
  );
  for (const ownerNotified of [false, undefined]) {
    expect(renderHuman({ revoked: true, grantId: "g", ownerNotified })).toBe(
      "Local capability revoked · g\nOwner not notified; local authority has ended.",
    );
  }
});

test("known lifecycle message envelopes remain readable without losing new event fields", () => {
  const input = page([
    {
      type: "agent_end",
      messages: [{ role: "assistant", content: [{ type: "text", text: "Finished" }], usage: { internal: 7 } }],
      willRetry: false,
      future: "kept",
    },
    {
      type: "turn_end",
      message: { role: "assistant", content: "Turn finished" },
      toolResults: [{ role: "toolResult", toolName: "shell", content: "ok" }],
    },
  ]);
  const output = renderHuman(input, "transcript");
  for (const text of ["Finished", "Turn finished", "Tool result shell", "kept", "willRetry"])
    expect(output).toContain(text);
  expect(output).not.toContain('"role":"assistant"');
  expect(output).not.toContain('"usage"');
  expect(renderHuman(input, "transcript-raw")).toContain('"usage"');
});

const titledTask = (state = "done") =>
  ({
    ...task(state),
    prompt: "Update the tracked fixture file",
    transcriptComplete: true,
    events: [{ seq: 1, event: { type: "message_end", message: { role: "assistant", content: "Useful conclusion" } } }],
  }) as RemoteTask;

test("saved results lead with work and recorded return, before cached diagnostics and IDs", () => {
  const t = {
    ...titledTask(),
    lastError: "SSH timeout",
    integrationError: "artifact fetch failed",
    repository: { status: "applied", artifact: "/local/result.patch", receipt: "/local/receipt.json" },
    localArtifacts: { complete: false, files: { log: { path: "/local/log.txt" } } },
    artifactsComplete: false,
    transcriptComplete: false,
    task: { state: "done", textOutputGap: "missing events" },
  } as unknown as RemoteTask;
  const before = JSON.stringify(t);
  const text = renderHuman(t);
  expect(text.split("\n")[0]).toBe("Remote Update the tracked fixture file · done");
  expect(text).toContain("Repository return: applied (recorded local return)");
  for (const value of [
    "/local/result.patch",
    "/local/receipt.json",
    "/local/log.txt",
    "artifact fetch failed",
    "missing events",
    "transcript incomplete",
    "artifact sync incomplete",
    "SSH timeout",
    "/remote transcript task-1",
    "not live status",
  ])
    expect(text).toContain(value);
  expect(text.indexOf("Useful conclusion")).toBeLessThan(text.indexOf("Warning:"));
  expect(text.indexOf("Useful conclusion")).toBeLessThan(text.indexOf("SSH timeout"));
  expect(text.indexOf("Useful conclusion")).toBeLessThan(text.indexOf("Task: task-1"));
  expect(taskLine(t)).toStartWith("Update the tracked fixture file · done");
  expect(taskLine(t)).toContain("task task-1");
  expect(status([t])).toContain("repository return applied");
  expect(JSON.stringify(t)).toBe(before); // human formatting cannot mutate automation data
});

test.each([
  [undefined, "unknown; application not confirmed"],
  [{ status: "future", artifact: "/local/patch" }, "unknown; application not confirmed"],
  [
    { status: "review", reason: "local file changed", artifact: "/local/patch", receipt: "/local/attempt" },
    "review needed; application not confirmed",
  ],
  [{ status: "no_changes", artifact: "/local/patch" }, "no changes"],
] as const)("done does not imply application: %j", (repository, expected) => {
  const text = renderHuman({ ...titledTask(), repository });
  expect(text).toContain("Repository return: " + expected);
  expect(text).not.toContain("Repository return: applied");
  if (repository?.status === "review") {
    expect(text).toContain("local file changed");
    expect(text).toContain("Inspect local worktree before applying");
    expect(text).toContain("/local/attempt");
  }
});

test.each(["running", "blocked", "failed", "cancelled"])(
  "%s never presents cached assistant text as a completion",
  (state) => {
    const text = renderHuman({ ...titledTask(state), task: { state, error: "observed failure" } });
    expect(text).not.toContain("Useful conclusion");
    expect(text).not.toContain("Saved assistant text:");
    expect(text).toContain("observed failure");
  },
);

test("question notices lead with title and question, keeping uncertainty and gap diagnostics", () => {
  const t = {
    ...titledTask("running"),
    lastError: "SSH unavailable",
    replyDelivery: { q: { replyId: "reply-1", status: "uncertain" } },
    task: {
      state: "running",
      textOutputGap: "gap detail",
      questions: [{ id: "q", status: "pending", text: "Which region?" }],
    },
  } as unknown as RemoteTask;
  const attention = new RemoteAttention();
  const state = { tasks: { "task-1": t } } as any;
  const notices = attention.update(state);
  expect(notices[0]).toStartWith(
    "Remote Update the tracked fixture file · Question: Which region? · saved reply; reconcile in /remote",
  );
  expect(notices[0]).toContain("question q");
  expect(notices[0]).toContain("Task: task-1");
  for (const value of [
    "SSH unavailable",
    "gap detail",
    "answer delivery uncertain",
    "reconcile saved reply before retrying",
    "reply-1",
  ])
    expect(notices.join("\n")).toContain(value);
  expect(attention.update(state)).toEqual([]);
});

test("completion reports applied return, assistant text, and incomplete transcript without UUID-first framing", () => {
  const t = { ...titledTask(), repository: { status: "applied", artifact: "/local/patch" }, transcriptComplete: false };
  const notices = new RemoteAttention().update({ tasks: { "task-1": t } } as any);
  expect(notices[0]).toStartWith("Remote Update the tracked fixture file · done");
  expect(notices[0]).toContain("Repository return: applied");
  expect(notices[0]).toContain("/local/patch");
  expect(notices[0]).toContain("Saved assistant text:\nUseful conclusion");
  expect(notices.join("\n")).toContain("transcript incomplete");
});

test("late repository outcome is noticed once without replaying completed assistant text, including reload", () => {
  const t = titledTask();
  const state = { tasks: { "task-1": t } } as any;
  const attention = new RemoteAttention();
  const keys: string[] = [];
  expect(attention.update(state, (key) => keys.push(key)).join("\n")).toContain("Repository return: unknown");
  t.repository = { status: "applied", artifact: "/local/patch", receipt: "/local/receipt" };
  const update = attention.update(state, (key) => keys.push(key)).join("\n");
  expect(update).toContain("Repository return: applied");
  expect(update).toContain("/local/receipt");
  expect(update).not.toContain("Useful conclusion");
  expect(attention.update(state)).toEqual([]);
  const restored = new RemoteAttention();
  restored.restore(keys);
  expect(restored.update(state)).toEqual([]);
  const baseline = new RemoteAttention();
  expect(baseline.update(state, undefined, () => true)).toEqual([]);
  expect(baseline.update(state)).toEqual([]);
});

test("accepted launch is a prompt-first handoff, not a terminal transcript warning", () => {
  const text = renderHuman({ ...titledTask("accepted"), transcriptComplete: false });
  expect(text).toStartWith("Remote Update the tracked fixture file · accepted\nNext: /remote");
  expect(text).toContain("partial cached observations; completion not confirmed");
  expect(text).not.toContain("Warning: transcript incomplete");
  expect(text).not.toContain("Useful conclusion");
  expect(text).toContain("not live status");
});

test("fresh status/connect explains the next human action without fake cached work", () => {
  const fresh = renderHuman({ tasks: [] }, "status");
  expect(fresh).toContain("Open /remote and choose Connect");
  expect(fresh).not.toContain("cached observations");
  expect(renderHuman({ connection: { host: "fixture" }, tasks: [] }, "status")).toContain(
    "launch work from this repository",
  );
  expect(renderHuman({ host: "fixture" }, "connect")).toContain("Open /remote to launch work");
});

test("a pending question with a saved reply offers reconciliation, not a new answer", () => {
  const t = {
    ...titledTask("running"),
    replies: { q: {} },
    task: { state: "running", questions: [{ id: "q", status: "pending", text: "Which?" }] },
  } as unknown as RemoteTask;
  expect(renderHuman(t)).toContain("Question: Which? · saved reply; reconcile in /remote");
  expect(new RemoteAttention().update({ tasks: { t } } as any).join("\n")).toContain(
    "Question: Which? · saved reply; reconcile in /remote",
  );
});
