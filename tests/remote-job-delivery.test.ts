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
