import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteJobDeliveryOutbox } from "../src/remote/job-delivery";
import { clearRemoteJobEvents, remoteJobEvents } from "../src/remote/job-events";

const terminal = { ownerId: "pinned", epoch: "epoch1", taskId: "job", state: "done" as const, preview: "initial" };
describe("session-scoped SSH observations and delivery", () => {
  test("ownership source is isolated; stale unknown cannot reopen terminal", () => {
    const a = remoteJobEvents("session-a"),
      b = remoteJobEvents("session-b");
    const seen: string[] = [];
    const off = a.subscribe((event) => seen.push(event.state));
    a.publish({ ...terminal, state: "running" });
    a.publish(terminal);
    a.publish({ ...terminal, state: "unknown" });
    expect(seen).toEqual(["running", "done"]);
    expect(b.snapshot()).toEqual([]);
    off();
    clearRemoteJobEvents("session-a");
    clearRemoteJobEvents("session-b");
  });
  test("persistent terminal dedup ignores artifact preview, retries with stable envelope", () => {
    const root = mkdtempSync(join(tmpdir(), "remote-delivery-"));
    try {
      const file = join(root, "session");
      let box = new RemoteJobDeliveryOutbox(file);
      box.enqueue({ ...terminal, state: "unknown" });
      expect(box.pending()).toEqual([]);
      box.enqueue(terminal);
      box.enqueue({ ...terminal, preview: "later artifact update" });
      const first = box.pending();
      expect(first).toHaveLength(1);
      expect(first[0].observation.preview).toBe("initial");
      box.failed(first, 100);
      expect(box.pending(101)).toHaveLength(0);
      box.close();
      box = new RemoteJobDeliveryOutbox(file);
      box.replay(); // crash between dispatch and ACK may redeliver the SAME id
      expect(box.pending()[0].id).toBe(first[0].id);
      box.delivered(box.pending());
      box.enqueue(terminal);
      expect(box.pending()).toEqual([]);
      box.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("durable claims fence concurrent dispatch; uncertain crashes replay only after lease", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-claim-"));
  const a = new RemoteJobDeliveryOutbox(join(root, "session")),
    b = new RemoteJobDeliveryOutbox(join(root, "session"));
  try {
    a.enqueue(terminal);
    const first = a.claim(100);
    expect(first).toHaveLength(1);
    b.replay(101);
    expect(b.claim(101)).toEqual([]);
    const retry = b.claim(30_101);
    expect(retry[0].id).toBe(first[0].id);
    a.delivered(first); // stale sender cannot acknowledge the new claim
    expect(b.hasPending()).toBe(true);
    b.delivered(retry);
    expect(a.hasPending()).toBe(false);
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("actionable waits dedup across refresh/restart and terminal supersedes queued waits", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-attention-")),
    file = join(root, "session");
  let box = new RemoteJobDeliveryOutbox(file);
  try {
    const wait = { ...terminal, state: "running" as const, actionable: "question q version 2" };
    box.enqueue(wait);
    box.enqueue({ ...wait, preview: "new transcript" });
    expect(box.pending()).toHaveLength(1);
    expect(box.pending()[0].kind).toBe("attention");
    box.delivered(box.claim());
    box.close();
    box = new RemoteJobDeliveryOutbox(file);
    box.enqueue(wait);
    expect(box.pending()).toEqual([]);
    box.enqueue({ ...wait, actionable: "question q version 3" });
    expect(box.pending()).toHaveLength(1);
    box.enqueue(terminal);
    expect(box.pending().map((row) => row.kind)).toEqual(["completion"]);
  } finally {
    box.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("dispatch failures remain retryable with stable id and a bounded automatic attempt budget", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-retry-")),
    file = join(root, "session");
  const box = new RemoteJobDeliveryOutbox(file);
  try {
    box.enqueue(terminal);
    let id = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const now = attempt * 100_000,
        rows = box.claim(now);
      expect(rows).toHaveLength(1);
      id ||= rows[0].id;
      expect(rows[0].id).toBe(id);
      box.failed(rows, now);
    }
    expect(box.hasPending()).toBe(false);
    expect(box.pending(1_000_000)).toEqual([]);
    box.replay(1_000_001);
    expect(box.claim(1_000_001)[0].id).toBe(id);
  } finally {
    box.close();
    rmSync(root, { recursive: true, force: true });
  }
});
