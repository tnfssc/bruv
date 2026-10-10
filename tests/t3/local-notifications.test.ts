import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { T3LocalNotificationDelivery, T3LocalNotificationOutbox } from "../../src/t3/tasks/local-notifications";
import type { T3McpClient } from "../../src/t3/tasks/mcp-client";

const directories: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bruv-t3-notify-"));
  directories.push(dir);
  const session = join(dir, "session.jsonl");
  writeFileSync(session, "");
  return session;
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// Each attempt gets a fresh client; tests provide the transport effects they observe.
function deliveryWithClient(
  outbox: T3LocalNotificationOutbox,
  client: { callTool: T3McpClient["callTool"]; close?: T3McpClient["close"] },
) {
  return new T3LocalNotificationDelivery(
    outbox,
    { kind: "remote", url: "http://127.0.0.1/mcp", token: "secret" },
    () => ({ close: async () => {}, ...client }) as unknown as T3McpClient,
  );
}

describe("T3 local notification outbox", () => {
  test("reports the outbox size limit and pending delivery", () => {
    const session = fixture();
    const outbox = new T3LocalNotificationOutbox(session);
    expect(() => outbox.assertLaunchCapacity(50)).toThrow("T3 local delivery full. Wait for pending notices.");
    writeFileSync(outbox.path, Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(() => outbox.list()).toThrow("T3 local notification outbox exceeds the size limit");
  });

  test("persists before delivery and survives crash/reload", () => {
    const session = fixture();
    const first = new T3LocalNotificationOutbox(session);
    const row = first.add({ taskId: "task-one", kind: "completion", text: "done" });
    expect(new T3LocalNotificationOutbox(session).list()).toEqual([row]);
    new T3LocalNotificationOutbox(session).acknowledge(row.notificationId);
    expect(new T3LocalNotificationOutbox(session).list()).toEqual([]);
  });

  test("a late ACK from a replaced connection cannot clobber newer rows", () => {
    const session = fixture();
    const oldConnection = new T3LocalNotificationOutbox(session);
    const first = oldConnection.add({ taskId: "task-old", kind: "completion", text: "old" });
    const resumedConnection = new T3LocalNotificationOutbox(session);
    const second = resumedConnection.add({ taskId: "task-new", kind: "completion", text: "new" });
    oldConnection.acknowledge(first.notificationId);
    expect(new T3LocalNotificationOutbox(session).list()).toEqual([second]);
  });

  test("completion durably supersedes attention for the same task", () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    outbox.add({ taskId: "task-three", kind: "attention", text: "still running" });
    outbox.add({ taskId: "task-three", kind: "completion", text: "done" });
    expect(outbox.list().map((row) => row.kind)).toEqual(["completion"]);
  });

  test("completion identity survives duplicate terminal callback even after ACK", () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    const first = outbox.add({ taskId: "terminal", kind: "completion", text: "done" });
    expect(outbox.add({ taskId: "terminal", kind: "completion", text: "done" })).toEqual(first);
    outbox.acknowledge(first.notificationId);
    expect(outbox.add({ taskId: "terminal", kind: "completion", text: "done" }).notificationId).toBe(
      first.notificationId,
    );
  });

  test("capacity is reserved before launch, without sacrificing terminal records", () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    expect(() => outbox.assertLaunchCapacity(50)).toThrow("T3 local delivery full. Wait for pending notices.");
    for (let i = 0; i < 64; i++) outbox.add({ taskId: "task-" + i, kind: "completion", text: "\u0000".repeat(5000) });
    expect(outbox.list()).toHaveLength(64);
    expect(() => outbox.assertLaunchCapacity(0)).toThrow("T3 local delivery full. Wait for pending notices.");
  });
});

describe("T3 local notification delivery", () => {
  test("replays one stable identity after an ambiguous ACK and then removes it", async () => {
    const session = fixture();
    const outbox = new T3LocalNotificationOutbox(session);
    const row = outbox.add({ taskId: "task-two", kind: "completion", text: "finished" });
    const calls: Array<Record<string, unknown>> = [];
    const delivery = deliveryWithClient(outbox, {
      callTool: async (_name: string, args: Record<string, unknown>) => {
        calls.push(args);
        if (calls.length === 1) throw new Error("response lost after commit");
        return {
          structuredContent: { version: 1, notificationId: row.notificationId, state: "committed" },
        };
      },
    });
    try {
      await delivery.flush();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(calls[1]);
      expect(calls[0]?.notificationId).toBe(row.notificationId);
      expect(new T3LocalNotificationOutbox(session).list()).toEqual([]);
    } finally {
      await delivery.stop();
    }
  });

  test("a completion arriving during an in-flight ACK is delivered without another user turn", async () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    const { promise: firstStarted, resolve: started } = Promise.withResolvers<void>();
    const { promise: blocked, resolve: release } = Promise.withResolvers<void>();
    const calls: string[] = [];
    const delivery = deliveryWithClient(outbox, {
      callTool: async (_name: string, args: Record<string, unknown>) => {
        calls.push(args.taskId as string);
        if (calls.length === 1) {
          started();
          await blocked;
        }
        return { structuredContent: { notificationId: args.notificationId, state: "committed" } };
      },
    });
    try {
      delivery.enqueue({ taskId: "one", kind: "completion", text: "one done" });
      await firstStarted;
      delivery.enqueue({ taskId: "two", kind: "completion", text: "two done" });
      release();
      await delivery.flush();
      expect(calls).toEqual(["one", "two"]);
      expect(outbox.list()).toEqual([]);
    } finally {
      release();
      await delivery.stop();
    }
  });

  test("idle pending delivery retries after outage without another enqueue", async () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    let calls = 0;
    const { promise: complete, resolve: delivered } = Promise.withResolvers<void>();
    const delivery = deliveryWithClient(outbox, {
      callTool: async (_: string, args: Record<string, unknown>) => {
        if (++calls <= 5) throw Error("temporarily unavailable");
        delivered();
        return { structuredContent: { notificationId: args.notificationId, state: "committed" } };
      },
    });
    try {
      delivery.enqueue({ taskId: "retry-idle", kind: "completion", text: "done" });
      await complete;
      await delivery.flush();
      expect(calls).toBe(6);
      expect(outbox.list()).toEqual([]);
    } finally {
      await delivery.stop();
    }
  });

  test("a rejected attention cannot starve another task completion", async () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    outbox.add({ taskId: "stale", kind: "attention", text: "still running" });
    outbox.add({ taskId: "done", kind: "completion", text: "finished" });
    const calls: string[] = [];
    const delivery = deliveryWithClient(outbox, {
      callTool: async (_: string, args: Record<string, unknown>) => {
        calls.push(args.taskId as string);
        return {
          structuredContent:
            args.taskId === "stale"
              ? { code: "task_not_found" }
              : { notificationId: args.notificationId, state: "committed" },
        };
      },
    });
    try {
      await delivery.flush();
      expect(calls[0]).toBe("done");
      expect(outbox.list().map((row) => row.taskId)).toEqual(["stale"]);
    } finally {
      await delivery.stop();
    }
  });

  test("only a matching terminal ACK retires a row, after its client closes", async () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    const row = outbox.add({ taskId: "ack-contract", kind: "completion", text: "done" });
    const calls: Array<Record<string, unknown>> = [];
    const replies = [
      { isError: true, structuredContent: { notificationId: row.notificationId, state: "committed" } },
      { structuredContent: { notificationId: "another-notification", state: "committed" } },
      { structuredContent: { notificationId: row.notificationId, state: "pending" } },
      { structuredContent: { notificationId: row.notificationId, state: "disposed" } },
    ];
    let closed = 0;
    const delivery = deliveryWithClient(outbox, {
      callTool: async (_: string, args: Record<string, unknown>) => {
        expect(closed).toBe(calls.length);
        expect(outbox.list()).toEqual([row]);
        calls.push(args);
        return replies[calls.length - 1];
      },
      close: async () => {
        expect(outbox.list()).toEqual([row]);
        closed++;
      },
    });
    try {
      await delivery.flush();
      expect(calls).toHaveLength(4);
      expect(calls.every((args) => JSON.stringify(args) === JSON.stringify(calls[0]))).toBe(true);
      expect(closed).toBe(4);
      expect(outbox.list()).toEqual([]);
    } finally {
      await delivery.stop();
    }
  });

  test("an in-flight attention ACK cannot retire its superseding completion", async () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    const { promise: firstStarted, resolve: started } = Promise.withResolvers<void>();
    const { promise: blocked, resolve: release } = Promise.withResolvers<void>();
    const calls: Array<Record<string, unknown>> = [];
    const delivery = deliveryWithClient(outbox, {
      callTool: async (_: string, args: Record<string, unknown>) => {
        calls.push(args);
        if (calls.length === 1) {
          started();
          await blocked;
        } else {
          expect(outbox.list().map((row) => row.kind)).toEqual(["completion"]);
        }
        return { structuredContent: { notificationId: args.notificationId, state: "committed" } };
      },
    });
    try {
      delivery.enqueue({ taskId: "superseded", kind: "attention", text: "running" });
      await firstStarted;
      delivery.enqueue({ taskId: "superseded", kind: "completion", text: "finished" });
      release();
      await delivery.flush();
      expect(calls.map((args) => args.kind)).toEqual(["attention", "completion"]);
      expect(calls[0]?.notificationId).not.toBe(calls[1]?.notificationId);
      expect(outbox.list()).toEqual([]);
    } finally {
      release();
      await delivery.stop();
    }
  });

  test("Stop cancels retry delay and never sends a post-stop request", async () => {
    const outbox = new T3LocalNotificationOutbox(fixture());
    let calls = 0;
    const delivery = deliveryWithClient(outbox, {
      callTool: async () => {
        calls++;
        throw Error("retry");
      },
    });
    try {
      delivery.enqueue({ taskId: "stopped", kind: "completion", text: "done" });
      await Bun.sleep(5);
      await delivery.stop();
      await Bun.sleep(30);
      expect(calls).toBe(1);
      expect(outbox.list()).toHaveLength(1);
    } finally {
      await delivery.stop();
    }
  });

  test("Stop closes the active client and retains an ambiguous notification for resume", async () => {
    const session = fixture();
    const outbox = new T3LocalNotificationOutbox(session);
    const { promise: requestStarted, resolve: started } = Promise.withResolvers<void>();
    const { promise: interrupted, resolve: interrupt } = Promise.withResolvers<void>();
    let calls = 0;
    let closed = false;
    const delivery = deliveryWithClient(outbox, {
      callTool: async () => {
        calls++;
        started();
        await interrupted;
        throw Error("connection closed before ACK");
      },
      close: async () => {
        closed = true;
        interrupt();
      },
    });
    try {
      delivery.enqueue({ taskId: "cancelled-delivery", kind: "completion", text: "done" });
      await requestStarted;
      await delivery.stop();
      await delivery.flush();
      expect(closed).toBe(true);
      expect(calls).toBe(1);
      expect(new T3LocalNotificationOutbox(session).list()).toEqual(outbox.list());
      expect(outbox.list()).toHaveLength(1);
    } finally {
      await delivery.stop();
    }
  });
});
