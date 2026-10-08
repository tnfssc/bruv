import { describe, expect, test } from "bun:test";
import type { RemoteState, RemoteTask } from "../src/remote/client";
import {
  inboxItems,
  pendingQuestions,
  questionOptions,
  remoteCompletions,
  remoteLabel,
  taskActions,
  taskOwned,
} from "../src/remote/menu";

function pendingTask(): RemoteTask {
  return {
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
          owner: { sessionId: "s", branchId: "b" },
          version: 1,
        },
      ],
    },
  };
}

function pinnedState(task: RemoteTask): RemoteState {
  return {
    tasks: { [task.taskId]: task },
    connection: {
      host: task.host,
      bruvPath: "bruv",
      hello: {
        protocol: 1,
        ownerId: task.ownerId,
        epoch: task.epoch,
        version: "test",
        platform: "linux",
        profile: { name: "normal", model: "test/model", auth: "configured" },
      },
    },
  };
}

describe("pending question picker", () => {
  test("a fresh pinned owner exposes the answer route, choices and searchable IDs", () => {
    const task = pendingTask();
    const state = pinnedState(task);
    expect(taskOwned(task, state)).toBe(true);
    expect(inboxItems(state)).toContainEqual({
      value: "question:task-a:q-one",
      label: "Question: Choose deployment region?",
      description: "Review long migration · task-a",
    });
    expect(remoteCompletions("answer Choose", state)?.[0]).toMatchObject({
      value: "answer task-a q-one ",
      label: "Question: Choose deployment region?",
    });
    expect(remoteCompletions("answer task-a q-", state)?.[0]?.label).toBe("Question: Choose deployment region?");
    expect(questionOptions(pendingQuestions(state)[0]!.q)).toEqual([
      { value: "0", label: "North region" },
      { value: "1", label: "South region" },
      { value: "write", label: "Write an answer…" },
    ]);
  });

  test("offline cached questions keep their identity but cannot enter the answer route", () => {
    const task = pendingTask();
    const state: RemoteState = { tasks: { [task.taskId]: task } };
    expect(taskOwned(task, state)).toBe(false);
    expect(inboxItems(state)).toContainEqual({
      value: "offline:question:task-a:q-one",
      label: "Question: Choose deployment region?",
      description: "Answer unavailable · sync pinned owner first · Review long migration · task-a",
    });
  });

  test("a failed sync blocks a new answer even while the pinned owner remains connected", () => {
    const task = { ...pendingTask(), lastError: "SSH offline" };
    const state = pinnedState(task);
    expect(taskOwned(task, state)).toBe(true);
    expect(inboxItems(state)).toContainEqual({
      value: "offline:question:task-a:q-one",
      label: "Question: Choose deployment region?",
      description: "Answer unavailable · sync pinned owner first · Review long migration · task-a",
    });
    expect(taskActions(task, taskOwned(task, state)).map((item) => item.value)).toEqual([
      "transcript",
      "details",
      "sync",
      "offline",
    ]);
  });

  test("connecting to a different owner does not authorize a cached question", () => {
    const task = pendingTask();
    const state = pinnedState(task);
    state.connection!.hello.ownerId = "different-owner";
    expect(taskOwned(task, state)).toBe(false);
    expect(inboxItems(state)).toContainEqual({
      value: "offline:question:task-a:q-one",
      label: "Question: Choose deployment region?",
      description: "Answer unavailable · sync pinned owner first · Review long migration · task-a",
    });
  });

  test("a choice-only question has no write-answer action", () => {
    expect(questionOptions({ id: "q", status: "pending", allowFreeText: false, choices: ["Only"] })).toEqual([
      { value: "0", label: "Only" },
    ]);
  });
});

// Menu offers do not authorize dispatch: extension.ts rechecks after the picker and confirmation.
describe("task action authority and reconciliation", () => {
  test("cached views and local revocation precede the pinned-owner gate", () => {
    const task = pendingTask();
    const offline: RemoteState = { tasks: { [task.taskId]: task } };
    expect(taskActions(task, taskOwned(task, offline)).map((item) => item.label)).toEqual([
      "View cached transcript",
      "View saved task details",
      "Sync / cancel unavailable (offline)",
    ]);
    expect(taskActions(task, taskOwned(task, offline), true)).toEqual([
      { value: "transcript", label: "View cached transcript", description: "Available offline" },
      {
        value: "details",
        label: "View saved task details",
        description: "Saved status, errors and pending requests · available offline",
      },
      {
        value: "capabilities",
        label: "Local capabilities…",
        description: "Revoke local grants offline; new grants require a live pinned owner",
      },
      {
        value: "offline",
        label: "Sync / cancel unavailable (offline)",
        description: "Connect to the pinned owner first",
      },
    ]);
  });

  test("a new epoch is not the task's pinned owner, even with local grants", () => {
    const task = pendingTask();
    const state = pinnedState(task);
    state.connection!.hello.epoch = "new-epoch";
    expect(taskOwned(task, state)).toBe(false);
    expect(inboxItems(state)).toContainEqual({
      value: "offline:question:task-a:q-one",
      label: "Question: Choose deployment region?",
      description: "Answer unavailable · sync pinned owner first · Review long migration · task-a",
    });
    expect(taskActions(task, taskOwned(task, state), true).map((item) => item.value)).toEqual([
      "transcript",
      "details",
      "capabilities",
      "offline",
    ]);
  });

  test("only a fresh active task offers new grants and cancellation after sync", () => {
    const task = pendingTask();
    const actions = taskActions(task, taskOwned(task, pinnedState(task)));
    expect(actions.map((item) => item.value)).toEqual(["transcript", "details", "capabilities", "sync", "cancel"]);
    expect(actions.at(-1)).toEqual({ value: "cancel", label: "Cancel task…", description: "Requires confirmation" });
    const ended = { ...task, task: { ...task.task!, state: "done" } };
    expect(taskActions(ended, taskOwned(ended, pinnedState(ended))).map((item) => item.value)).toEqual([
      "transcript",
      "details",
      "sync",
    ]);
  });

  test("saving an answer removes the new question; uncertain delivery retains reconciliation through sync failure", () => {
    const saved: RemoteTask = {
      ...pendingTask(),
      replies: {
        "q-one": {
          id: "q-one",
          text: "North region",
          version: 1,
          replyId: "saved-reply",
          owner: { sessionId: "s", branchId: "b" },
        },
      },
    };
    expect(pendingQuestions(pinnedState(saved))).toEqual([]);

    const uncertain: RemoteTask = {
      ...saved,
      replyDelivery: { "q-one": { replyId: "saved-reply", status: "uncertain" } },
    };
    const rows = inboxItems(pinnedState(uncertain));
    expect(rows.some((item) => item.label.startsWith("Question:"))).toBe(false);
    expect(rows).toContainEqual({
      value: "task:task-a",
      label: "Reply uncertain: Choose deployment region?",
      description: "Review long migration · saved reply retained; open task to reconcile",
    });
    expect(taskActions(uncertain, taskOwned(uncertain, pinnedState(uncertain)))).toContainEqual({
      value: "reply:q-one",
      label: "Reconcile saved reply",
      description: "Same saved text and reply identity; never a new answer",
    });

    const stale: RemoteTask = { ...uncertain, lastError: "Native reply outcome uncertain", outcome: "unknown" };
    const actions = taskActions(stale, taskOwned(stale, pinnedState(stale)));
    expect(actions.map((item) => item.value)).toEqual([
      "transcript",
      "details",
      "sync",
      "reply:q-one",
      "retry",
      "offline",
    ]);
    expect(pendingQuestions(pinnedState(stale))).toEqual([]);
    expect(actions).toContainEqual({
      value: "sync",
      label: "Sync task",
      description: "Retry failed sync; other actions unavailable until fresh",
    });
    expect(actions).toContainEqual({
      value: "reply:q-one",
      label: "Reconcile saved reply",
      description: "Same saved text and reply identity; never a new answer",
    });
    expect(taskActions(stale, taskOwned(stale, pinnedState(stale)), true).map((item) => item.value)).toEqual([
      "transcript",
      "details",
      "capabilities",
      "sync",
      "reply:q-one",
      "retry",
      "offline",
    ]);
  });
});

describe("cached presentation and command discovery", () => {
  test("task and launch labels remain searchable alongside command completion IDs", () => {
    const state = pinnedState(pendingTask());
    expect(inboxItems(state).map((item) => item.label)).toEqual(
      expect.arrayContaining(["Task: Review long migration [running]", "Launch local repository…"]),
    );
    expect(remoteCompletions("ans", state)?.[0]?.value).toBe("answer");
    expect(remoteCompletions("grant repo.", state)?.[0]?.value).toBe("grant repo.read");
    expect(remoteCompletions("sync Review", state)?.[0]?.value).toBe("sync task-a");
  });

  test("fully typed commands submit instead of reselecting identical autocomplete", () => {
    const state = pinnedState(pendingTask());
    expect(remoteCompletions("status", state)).toBeNull();
    expect(remoteCompletions("sync task-a", state)).toBeNull();
    expect(remoteCompletions("transcript task-a", state)).toBeNull();
    expect(remoteCompletions("stat", state)?.[0]?.value).toBe("status");
  });

  test("untrusted remote labels are printable", () => {
    expect(remoteLabel("hello\x1b[2J\u202eevil")).toBe("hello [2J evil");
  });

  test("SSH connection discovery explains usernames and aliases", () => {
    expect(inboxItems({ tasks: {} }).find((item) => item.value === "connect")?.description).toBe(
      "user@host or configured SSH alias",
    );
  });

  test("cancel delivery status is shown apart from terminal observation", () => {
    const task: RemoteTask = {
      ...pendingTask(),
      cancelRequested: true,
      cancelDelivery: { status: "uncertain" },
    };
    const row = inboxItems(pinnedState(task)).find((item) => item.value === "task:task-a")!;
    expect(row.description).toContain("cancellation uncertain");
    expect(row.description).toContain("terminal state is separate");
  });

  test("returned conflicts are discoverable from inbox and readable offline", () => {
    const task = pendingTask();
    const review: RemoteTask = {
      ...task,
      task: { ...task.task!, state: "done" },
      repository: { status: "review", artifact: "/safe/return.patch", reason: "local file changed" },
    };
    const offline: RemoteState = { tasks: { [review.taskId]: review } };
    expect(inboxItems(offline).find((item) => item.value === "task:task-a")?.description).toContain("review needed");
    expect(taskActions(review, taskOwned(review, offline))).toContainEqual({
      value: "details",
      label: "Review returned changes",
      description: "Saved conflict reason and local artifact path · available offline",
    });
  });
});
