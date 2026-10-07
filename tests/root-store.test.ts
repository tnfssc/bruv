import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RootDialog, RootIntent } from "../src/remote/root-contract";
import { RootStore } from "../src/remote/root-store";

const intent: RootIntent = {
  ownerId: "owner",
  epoch: "epoch",
  sessionId: "session",
  role: "root",
  depth: 0,
  repoPath: "/repository",
};
function withStore(run: (store: RootStore) => void, budget?: number) {
  const directory = mkdtempSync(join(tmpdir(), "root-store-"));
  const store = new RootStore(directory, budget);
  try {
    store.accept(intent, "create");
    run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("claims follow acceptance order, commit before return and never reclaim dispatching commands", () => {
  withStore((store) => {
    store.enqueue("session", "z-first", { kind: "abort" });
    store.enqueue("session", "a-second", { kind: "prompt", text: "second" });
    store.enqueue("session", "m-third", { kind: "close" });
    const observer = new RootStore(store.directory);
    try {
      expect(store.claimCommand("session")).toEqual({
        command: { kind: "abort" },
        receipt: { commandId: "z-first", state: "dispatching" },
      });
      expect(observer.receipt("session", "z-first").state).toBe("dispatching");
      const second = observer.claimCommand("session");
      expect(second?.receipt.commandId).toBe("a-second");
      store.finish("session", { commandId: "a-second", state: "completed", result: "done" });
      expect(store.claimCommand("session")?.receipt.commandId).toBe("m-third");
      expect(observer.claimCommand("session")).toBeUndefined();
      expect(store.enqueue("session", "z-first", { kind: "abort" }).state).toBe("dispatching");
    } finally {
      observer.close();
    }
  });
});

test("unknown settles only unresolved commands and exact retries retain their original disposition", () => {
  withStore((store) => {
    store.enqueue("session", "done", { kind: "abort" });
    store.enqueue("session", "written", { kind: "prompt", text: "written" });
    store.enqueue("session", "waiting", { kind: "close" });
    store.claimCommand("session");
    const completed = { commandId: "done", state: "completed" as const, result: { settled: false }, error: "denied" };
    store.finish("session", completed);
    store.claimCommand("session");
    store.unknown("session", "lost owner");
    expect(store.receipt("session", "done")).toEqual(completed);
    for (const id of ["written", "waiting"])
      expect(store.receipt("session", id)).toEqual({ commandId: id, state: "unknown", error: "lost owner" });
    expect(store.claimCommand("session")).toBeUndefined();
    store.unknown("session", "later error");
    expect(store.get("session").record.error).toBe("lost owner");
    expect(store.enqueue("session", "waiting", { kind: "close" })).toEqual({
      commandId: "waiting",
      state: "unknown",
      error: "lost owner",
    });
    expect(() => store.enqueue("session", "waiting", { kind: "abort" })).toThrow("intent conflict");
    expect(() => store.enqueue("session", "new", { kind: "abort" })).toThrow("not accepting");
  });
});

test("closed roots and other sessions are untouched by uncertain owner settlement", () => {
  withStore((store) => {
    store.enqueue("session", "pending", { kind: "abort" });
    const saved = store.get("session");
    saved.record.state = "closed";
    store.save(saved);
    store.accept({ ...intent, sessionId: "other" }, "other-create");
    store.enqueue("other", "pending", { kind: "abort" });
    store.unknown("session", "late exit");
    expect(store.get("session")).toEqual(saved);
    expect(store.receipt("session", "pending").state).toBe("queued");
    store.unknown("other", "other exit");
    expect(store.receipt("other", "pending").state).toBe("unknown");
    expect(store.receipt("session", "pending").state).toBe("queued");
  });
});

test("event retention keeps the same contiguous byte-bounded suffix, including an empty journal", () => {
  withStore((store) => {
    store.accept({ ...intent, sessionId: "other" }, "other-create");
    store.append("other", "independent");
    const retained: Array<{ seq: number; event: unknown }> = [];
    const events = [
      "tiny",
      "é".repeat(12),
      "x".repeat(35),
      "wide".repeat(20),
      "tail",
      "😀".repeat(30),
      null,
      { type: "notice" },
    ];
    for (const [index, event] of events.entries()) {
      const seq = index + 1;
      store.append("session", event);
      retained.push({ seq, event });
      while (retained.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row.event)), 0) > store.eventBudget)
        retained.shift();
      const cursor = (retained[0]?.seq ?? seq + 1) - 1;
      expect(store.observe("session", cursor)).toMatchObject({ events: retained, cursor: seq, hasMore: false });
      expect(store.get("session").seq).toBe(seq);
      if (cursor > 0) expect(() => store.observe("session", cursor - 1)).toThrow("gap");
      expect(() => store.observe("session", seq + 1)).toThrow("gap");
    }
    expect(store.observe("other", 0).events).toEqual([{ seq: 1, event: "independent" }]);
  }, 70);
});

test("dialog state outlives event eviction and replacement at the dialog limit remains atomic", () => {
  withStore((store) => {
    for (let i = 0; i < 20; i++)
      store.append("session", { type: "extension_ui_request", id: "dialog-" + i, method: "confirm" });
    const before = store.get("session");
    expect(() => store.append("session", { type: "extension_ui_request", id: "extra", method: "input" })).toThrow(
      "Too many",
    );
    expect(store.get("session")).toEqual(before);
    const replacement: RootDialog = {
      type: "extension_ui_request",
      id: "dialog-0",
      method: "editor",
      prefill: "replacement",
    };
    store.append("session", replacement);
    const reopened = new RootStore(store.directory, 0);
    try {
      const observation = reopened.observe("session", 21);
      expect(observation.events).toEqual([]);
      expect(observation.record.dialogs).toHaveLength(20);
      expect(observation.record.dialogs?.at(-1)).toEqual(replacement);
      reopened.append("session", { type: "root_ui_response", id: "dialog-0" });
      expect(store.observe("session", 22).record.dialogs).toHaveLength(19);
      store.append("session", { type: "extension_ui_request", id: "notification", method: "notify" });
      expect(store.get("session").record.dialogs).toHaveLength(19);
      const current = store.get("session");
      expect(() => store.append("session", "x".repeat(512 * 1024))).toThrow("oversized");
      expect(store.get("session")).toEqual(current);
    } finally {
      reopened.close();
    }
  }, 0);
});

test("failed receipt settlement rolls back the root's unknown transition", () => {
  withStore((store) => {
    store.enqueue("session", "waiting", { kind: "abort" });
    const before = store.get("session");
    store.db.exec(
      "CREATE TRIGGER reject_receipt BEFORE UPDATE ON commands BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END",
    );
    expect(() => store.unknown("session", "lost owner")).toThrow("fixture receipt failure");
    expect(store.get("session")).toEqual(before);
    expect(store.receipt("session", "waiting").state).toBe("queued");
  });
});

test("failed event pruning rolls back the sequence, pending dialog and journal insertion together", () => {
  withStore((store) => {
    store.append("session", "retained event");
    const before = store.get("session");
    const observation = store.observe("session", 0);
    store.db.exec(
      "CREATE TRIGGER reject_pruning BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'fixture pruning failure'); END",
    );
    expect(() => store.append("session", { type: "extension_ui_request", id: "human", method: "confirm" })).toThrow(
      "fixture pruning failure",
    );
    expect(store.get("session")).toEqual(before);
    expect(store.observe("session", 0)).toEqual(observation);
  }, 40);
});
