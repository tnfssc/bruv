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
const state = { tasks: { "task-a": task }, connection: { host: "host" } } as unknown as RemoteState;
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
