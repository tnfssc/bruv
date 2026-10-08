import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { capture, flushCapture } from "../scripts/claude-native-acceptance/driver.mjs";

const hash = (id) => createHash("sha256").update(id).digest("hex").slice(0, 16);
function observedPage() {
  const page = new EventEmitter();
  const observation = capture({ page });
  const socket = new EventEmitter();
  page.emit("websocket", socket);
  return {
    observation,
    receive: (value) => socket.emit("framereceived", { payload: JSON.stringify(value) }),
    socket,
  };
}
async function projectedItems(observation, proof) {
  await fs.mkdir(proof);
  await flushCapture({ proof, observation });
  return JSON.parse(await fs.readFile(path.join(proof, "t3-item-projection.json"), "utf8"));
}

test("each browser observation owns its cancellation identity and evidence sequence", async () => {
  const proof = await fs.mkdtemp(path.join(os.tmpdir(), "native-capture-"));
  try {
    const first = observedPage();
    first.receive({ type: "user_message", text: "ACCEPT_CANCEL: first", runId: "first-run" });
    const second = observedPage();
    assert.equal(second.observation.cancellationRunId, undefined);
    second.receive({ type: "user_message", text: "ACCEPT_CANCEL: second", runId: "second-run" });
    // A later frame from the first page must not replace the second run's disclosure identity.
    first.receive({
      threadId: "first-thread",
      items: [
        { type: "user_message", text: "ACCEPT_CANCEL: first again", runId: "first-later-run" },
        { text: "CANCEL_CONFIRMED_REAL private text" },
      ],
    });
    assert.equal(first.observation.cancellationRunId, "first-later-run");
    assert.equal(second.observation.cancellationRunId, "second-run");
    const firstRows = await projectedItems(first.observation, path.join(proof, "first"));
    const secondRows = await projectedItems(second.observation, path.join(proof, "second"));
    assert.deepEqual(
      firstRows.map((row) => row.sequence),
      [0, 1, 2],
    );
    assert.deepEqual(
      secondRows.map((row) => row.sequence),
      [0],
    );
    assert.equal(secondRows[0].runIdHash, hash("second-run"));
    assert.equal(firstRows[2].threadIdHash, hash("first-thread"));
    assert.equal(firstRows[2].location, "root.items[1]");
    assert.deepEqual(firstRows[2].markers, ["CANCEL_CONFIRMED_REAL"]);
    assert.ok(!JSON.stringify(firstRows).includes("private text"));
    assert.ok(!JSON.stringify(secondRows).includes("second-run"));
  } finally {
    await fs.rm(proof, { recursive: true, force: true });
  }
});

test("binary websocket evidence keeps inherited identities and ignores non-JSON frames", async () => {
  const proof = await fs.mkdtemp(path.join(os.tmpdir(), "native-capture-"));
  try {
    const { observation, socket } = observedPage();
    socket.emit("framereceived", { payload: "not json" });
    socket.emit("framereceived", {
      payload: Buffer.from(
        JSON.stringify({
          threadId: "thread",
          items: [{ text: "TASK_COMPLETED_REAL", ordinal: 7 }],
        }),
      ),
    });
    await observation.flush({ proof });
    const rows = JSON.parse(await fs.readFile(path.join(proof, "t3-item-projection.json"), "utf8"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sequence, 0);
    assert.equal(rows[0].threadIdHash, hash("thread"));
    assert.equal(rows[0].ordinal, 7);
    assert.deepEqual(rows[0].markers, ["TASK_COMPLETED_REAL"]);
  } finally {
    await fs.rm(proof, { recursive: true, force: true });
  }
});

// The database is closed before capture starts; finalization must only read it.
async function seedCancellationHistory(root) {
  const { DatabaseSync } = await import("node:sqlite");
  const userdata = path.join(root, "t3-base/userdata");
  await fs.mkdir(userdata, { recursive: true });
  const databasePath = path.join(userdata, "statev2.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "CREATE TABLE orchestration_v2_projection_turn_items (ordinal INTEGER, type TEXT, payload_json TEXT)",
    );
    const insert = database.prepare("INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?)");
    // Insert out of order so the exported chronology must come from the ordinal.
    insert.run(
      2,
      "assistant_message",
      JSON.stringify({
        id: "completion",
        runId: "run",
        messageId: "message",
        text: "CANCELLATION_COMPLETED_REAL private completion",
      }),
    );
    insert.run(
      1,
      "user_message",
      JSON.stringify({ id: "request", runId: "run", text: "ACCEPT_CANCEL: private request" }),
    );
  } finally {
    database.close();
  }
  return databasePath;
}

test("finalization exports live observation and read-only persisted evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-persisted-capture-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const proof = path.join(root, "proof");
  await fs.mkdir(proof);
  const databasePath = await seedCancellationHistory(root);
  const before = await fs.readFile(databasePath);
  const { observation, receive } = observedPage();
  receive({ text: "CANCEL_CONFIRMED_REAL private live acknowledgement", runId: "live-run" });

  await flushCapture({ proof, root, observation });

  const liveRows = JSON.parse(await fs.readFile(path.join(proof, "t3-item-projection.json"), "utf8"));
  assert.deepEqual(liveRows, [
    { sequence: 0, location: "root", runIdHash: hash("live-run"), markers: ["CANCEL_CONFIRMED_REAL"] },
  ]);
  const rows = JSON.parse(await fs.readFile(path.join(proof, "t3-persisted-item-projection.json"), "utf8"));
  assert.deepEqual(
    rows.map((row) => row.ordinal),
    [1, 2],
  );
  assert.deepEqual(
    rows.map((row) => row.markers),
    [["ACCEPT_CANCEL"], ["CANCELLATION_COMPLETED_REAL"]],
  );
  assert.equal(rows[1].messageIdHash, hash("message"));
  assert.equal(rows[0].runIdHash, hash("run"));
  assert.ok(!JSON.stringify(rows).includes("private"));
  assert.deepEqual(await fs.readFile(databasePath), before);
});

test("finalization without a browser observation creates persisted evidence and an empty live projection", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-persisted-capture-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const proof = path.join(root, "proof");
  await fs.mkdir(proof);
  const databasePath = await seedCancellationHistory(root);
  const before = await fs.readFile(databasePath);

  // A fresh proof directory cannot accidentally reuse an earlier observation's files.
  await flushCapture({ proof, root });

  const rows = JSON.parse(await fs.readFile(path.join(proof, "t3-persisted-item-projection.json"), "utf8"));
  assert.deepEqual(rows, [
    { ordinal: 1, type: "user_message", idHash: hash("request"), runIdHash: hash("run"), markers: ["ACCEPT_CANCEL"] },
    {
      ordinal: 2,
      type: "assistant_message",
      idHash: hash("completion"),
      messageIdHash: hash("message"),
      runIdHash: hash("run"),
      markers: ["CANCELLATION_COMPLETED_REAL"],
    },
  ]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(proof, "t3-item-projection.json"), "utf8")), []);
  assert.deepEqual(await fs.readFile(databasePath), before);
});
