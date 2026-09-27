import { test, expect } from "bun:test";
import {
  inboxItems,
  pendingQuestions,
  questionOptions,
  remoteCompletions,
  taskActions,
  remoteLabel,
} from "../src/remote/menu";
import type { RemoteState, RemoteTask } from "../src/remote/client";
const task = {
  taskId: "task-a",
  prompt: "Review long migration",
  repoPath: "/repo",
  host: "host",
  ownerId: "owner",
  epoch: "epoch",
  outcome: "accepted",
  cursor: 0,
  events: [],
  task: {
    taskId: "task-a",
    state: "running",
    questions: [
      {
        id: "q-one",
        status: "pending",
        text: "Choose deployment region?",
        choices: ["North region", "South region"],
        allowFreeText: true,
      },
    ],
  },
} as RemoteTask;
const state = {
  tasks: { "task-a": task },
  connection: { host: "host", hello: { ownerId: "owner", epoch: "epoch" } },
} as unknown as RemoteState;
test("remote inbox has searchable actionable labels and relevant completion IDs", () => {
  expect(inboxItems(state).map((i) => i.label)).toEqual(
    expect.arrayContaining([
      "Question: Choose deployment region?",
      "Task: Review long migration [running]",
      "Launch local repository…",
    ]),
  );
  expect(remoteCompletions("ans", state)?.[0]?.value).toBe("answer");
  expect(remoteCompletions("answer Choose", state)?.[0]).toMatchObject({
    value: "answer task-a q-one ",
    label: "Question: Choose deployment region?",
  });
  expect(remoteCompletions("answer task-a q-", state)?.[0]?.label).toBe("Question: Choose deployment region?");
  expect(remoteCompletions("grant repo.", state)?.[0]?.value).toBe("grant repo.read");
  expect(remoteCompletions("sync Review", state)?.[0]?.value).toBe("sync task-a");
  expect(questionOptions(pendingQuestions(state)[0]!.q).map((i) => i.label)).toEqual([
    "North region",
    "South region",
    "Write an answer…",
  ]);
});
test("uncertain replies are never offered as new questions; offline actions are visibly unavailable", () => {
  const uncertain = {
    ...task,
    replies: {
      "q-one": {
        id: "q-one",
        text: "North region",
        version: 1,
        replyId: "reply",
        owner: { sessionId: "s", branchId: "b" },
      },
    },
  } as RemoteTask;
  expect(pendingQuestions({ tasks: { "task-a": uncertain } })).toEqual([]);
  const offline = { tasks: state.tasks } as RemoteState;
  expect(inboxItems(offline).find((i) => i.label.startsWith("Question:"))?.value).toStartWith("offline:");
  expect(taskActions(task, false).map((i) => i.label)).toEqual([
    "View cached transcript",
    "Sync / cancel unavailable (offline)",
  ]);
  expect(questionOptions({ id: "q", status: "pending", allowFreeText: false, choices: ["Only"] })).toHaveLength(1);
});

test("untrusted remote labels are printable", () => {
  expect(remoteLabel("hello\x1b[2J\u202eevil")).toBe("hello [2J evil");
});

test("cached offline and foreign-owner questions are visible but not answer actions", () => {
  const failed = { ...task, lastError: "SSH offline" };
  const row = inboxItems({ ...state, tasks: { "task-a": failed } }).find((i) => i.label.startsWith("Question:"))!;
  expect(row.value).toStartWith("offline:");
  expect(row.description).toContain("unavailable");
  expect(taskActions(failed, true).some((i) => i.value === "cancel")).toBe(false);
  expect(taskActions(failed, true).some((i) => i.value === "sync")).toBe(true);
  const foreign = { ...task, ownerId: "different-owner" };
  expect(
    inboxItems({ ...state, tasks: { "task-a": foreign } }).find((i) => i.label.startsWith("Question:"))!.value,
  ).toStartWith("offline:");
});
test("uncertain reply remains actionable without offering a replacement answer", () => {
  const uncertain = {
    ...task,
    replies: {
      "q-one": {
        id: "q-one",
        owner: { sessionId: "s", branchId: "b" },
        version: 1,
        text: "North region",
        replyId: "reply",
      },
    },
    replyDelivery: { "q-one": { replyId: "reply", status: "uncertain" as const } },
  };
  const rows = inboxItems({ ...state, tasks: { "task-a": uncertain } });
  expect(rows.some((i) => i.label.startsWith("Question:"))).toBe(false);
  expect(rows.find((i) => i.label.startsWith("Reply uncertain:"))?.description).toContain("saved reply retained");
  expect(taskActions(uncertain, true).find((i) => i.value === "reply:q-one")?.label).toBe("Reconcile saved reply");
});

test("cancel delivery status is shown apart from terminal observation", () => {
  const uncertain = {
    ...task,
    cancelRequested: true,
    cancelDelivery: { status: "uncertain" as const },
    task: { taskId: task.taskId, state: "running" },
  };
  const row = inboxItems({ ...state, tasks: { "task-a": uncertain } }).find((i) => i.value === "task:task-a")!;
  expect(row.description).toContain("cancellation uncertain");
  expect(row.description).toContain("terminal state is separate");
});

test("SSH connection discovery explains usernames and aliases", () => {
  expect(inboxItems({ tasks: {} } as RemoteState).find((item) => item.value === "connect")?.description).toBe(
    "user@host or configured SSH alias",
  );
});

test("fully typed remote commands submit instead of reselecting identical autocomplete", () => {
  expect(remoteCompletions("status", state)).toBeNull();
  expect(remoteCompletions("sync task-a", state)).toBeNull();
  expect(remoteCompletions("transcript task-a", state)).toBeNull();
  expect(remoteCompletions("stat", state)?.[0]?.value).toBe("status");
});
