import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  checkSameRootReply,
  checkConsumedPromptOwnership,
} from "../scripts/claude-native-acceptance/subagent-driver.mjs";
import { collectReturnEvidence } from "../scripts/claude-native-acceptance/subagent-return-evidence.mjs";
import { reply, modelId } from "../scripts/claude-native-acceptance/subagent-model.mjs";
const frame = (value, kind = "stdout") => ({ kind, value });
const assistant = (text, session_id = "same-root") =>
  frame({ type: "assistant", session_id, message: { content: [{ type: "text", text }] } });
const success = () => [
  assistant("ROOT_BACKGROUND_RETURN_REAL"),
  assistant("ROOT_AFTER_CHILD_REAL"),
  frame({ type: "result", session_id: "same-root", result: "ROOT_AFTER_CHILD_REAL", is_error: false }),
];
test("return requires one actual next reply and success result in the original native session", () => {
  assert.deepEqual(checkSameRootReply(success()), { sameRootSessionReply: true });
  assert.throws(() => checkSameRootReply(success().slice(0, 1)), /Exactly one actual/);
  assert.throws(() => checkSameRootReply(success().slice(0, 2)), /actual success result/);
  const other = success();
  other[1].value.session_id = "new-root";
  assert.throws(() => checkSameRootReply(other), /original root/);
  const foreign = success();
  foreign[2].value.session_id = "new-root";
  assert.throws(() => checkSameRootReply(foreign));
  const child = success();
  child[1].value.parent_tool_use_id = "child";
  assert.throws(() => checkSameRootReply(child), /Exactly one actual/);
  assert.throws(() => checkSameRootReply([...success(), success()[1]]), /Exactly one actual/);
  const failure = success();
  failure[2].value.is_error = true;
  assert.throws(() => checkSameRootReply(failure));
});
test("after-child marker is a separate real provider reply, not a reused earlier followup", () => {
  assert.equal(
    reply({ model: modelId, messages: [{ role: "user", content: "ACCEPT_LOCAL_AFTER_CHILD" }] }, { state: "/fixture" })
      .content,
    "ROOT_AFTER_CHILD_REAL",
  );
});
test("failure evidence retains correlation and committed source/status, excludes auth and prompt text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-return-test-"));
  try {
    const agent = path.join(root, "agent"),
      base = path.join(root, "t3-runtime", "t3-base");
    await fs.mkdir(path.join(agent, "native-sessions"), { recursive: true });
    await fs.mkdir(path.join(base, "userdata", "logs", "provider"), { recursive: true });
    await fs.writeFile(
      path.join(base, "userdata", "logs", "provider", "events.thread.log"),
      "[fixture] NTIVE: " +
        JSON.stringify({
          providerSessionId: "provider-session",
          event: {
            direction: "incoming",
            payload: {
              type: "result",
              session_id: "same-root",
              user_message_uuid: "human",
              origin: { kind: "human" },
              result: "ROOT_AFTER_CHILD_REAL secret prompt",
              environment: { secret: "secret-token" },
            },
          },
        }) +
        "\n",
    );
    const source = path.join(agent, "source.jsonl"),
      wire = path.join(root, "wire.ndjson");
    await fs.writeFile(
      source,
      JSON.stringify({
        id: "source-1",
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ROOT_COMPLETION_ONCE_REAL secret prompt" }],
        },
      }) + "\n",
    );
    await fs.writeFile(path.join(agent, "native-sessions", "same-root.json"), JSON.stringify({ file: source }));
    await fs.writeFile(
      wire,
      [
        { kind: "lifecycle", owner: 1234, value: { event: "spawn", pid: 1234, flags: ["--input-format"] } },
        {
          ...frame(
            { type: "user", uuid: "human", message: { content: "ACCEPT_LOCAL_AFTER_CHILD secret prompt" } },
            "stdin",
          ),
          owner: 1234,
        },
        {
          ...frame({
            type: "result",
            uuid: "res",
            session_id: "same-root",
            user_message_uuid: "human",
            origin: { kind: "human" },
            result: "ROOT_AFTER_CHILD_REAL",
          }),
          owner: 1234,
        },
      ]
        .map(JSON.stringify)
        .join("\n") + "\n",
    );
    const db = new DatabaseSync(path.join(base, "state.sqlite"));
    db.exec(
      "CREATE TABLE orchestration_v2_projection_runs (run_id TEXT, status TEXT, payload_json TEXT);" +
        "INSERT INTO orchestration_v2_projection_runs VALUES ('run-1', 'running', 'secret prompt');" +
        "CREATE TABLE auth (id TEXT, token TEXT); INSERT INTO auth VALUES ('auth-id', 'secret-token');" +
        "CREATE TABLE orchestration_events (sequence INTEGER,event_type TEXT,stream_id TEXT,occurred_at TEXT,payload_json TEXT,metadata_json TEXT,application_event_version INTEGER);" +
        `INSERT INTO orchestration_events VALUES (7,'run.updated','thread','fixture','{"status":"running","secret":"secret prompt"}','{"runId":"run-1"}',2);`,
    );
    db.close();
    const page = {
      url: () => "http://fixture/same-root",
      getByRole: (_, { name }) => ({ isVisible: async () => name === "Stop generation" }),
    };
    await collectReturnEvidence(
      { wire, state: path.join(root, "state"), proof: root, env: { BRUV_CODING_AGENT_DIR: agent } },
      page,
    );
    const raw = await fs.readFile(path.join(root, "same-root-return-evidence.json"), "utf8"),
      e = JSON.parse(raw);
    assert.equal(e.correlation[1].echoedPrompt, e.correlation[0].uuid);
    assert.equal(e.correlation[0].sequence, 1);
    assert.equal(e.correlation[1].sequence, 2);
    assert.equal(e.lifecycle[0].owner, e.correlation[0].owner);
    assert.equal(e.correlation[1].owner, e.correlation[0].owner);
    assert.deepEqual(e.journals[0].entries[0].markers, ["ROOT_COMPLETION_ONCE_REAL"]);
    assert.deepEqual(e.persistence[0].rows, [{ run_id: "run-1", status: "running" }]);
    assert.equal(e.provider[0].echoedPrompt, e.correlation[0].uuid);
    assert.deepEqual(e.provider[0].markers, ["ROOT_AFTER_CHILD_REAL"]);
    assert.equal(e.events[0].sequence, 7);
    assert.equal(e.events[0].status, "running");
    assert.equal(e.stopVisible, true);
    assert.equal(e.submitVisible, false);
    assert.doesNotMatch(raw, /secret prompt|secret-token|auth-id/);
    await collectReturnEvidence(
      { wire, state: path.join(root, "state"), proof: root, env: { BRUV_CODING_AGENT_DIR: agent } },
      undefined,
      "final-provider-evidence.json",
    );
    const final = JSON.parse(await fs.readFile(path.join(root, "final-provider-evidence.json"), "utf8"));
    assert.equal(final.submitVisible, undefined);
    assert.equal(final.stopVisible, undefined);
    assert.equal(final.provider[0].echoedPrompt, final.correlation[0].uuid);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("native ownership gate rejects missing or foreign consumption echoes and human-attributed wakes", () => {
  const wire = [];
  for (const [prompt, answer] of [
    ["ACCEPT_LOCAL_SUBAGENT", "ROOT_BACKGROUND_RETURN_REAL"],
    ["ACCEPT_LOCAL_FOLLOWUP", "ROOT_FOLLOWUP_REAL"],
    ["ACCEPT_LOCAL_AFTER_CHILD", "ROOT_AFTER_CHILD_REAL"],
  ]) {
    wire.push(frame({ type: "user", uuid: prompt, message: { content: prompt } }, "stdin"));
    wire.push(frame({ type: "result", result: answer, user_message_uuid: prompt }));
  }
  wire.push(frame({ type: "result", result: "ROOT_COMPLETION_ONCE_REAL", origin: { kind: "task-notification" } }));
  assert.deepEqual(checkConsumedPromptOwnership(wire), { consumedPromptOwnership: true });
  const missing = structuredClone(wire);
  delete missing[1].value.user_message_uuid;
  assert.throws(() => checkConsumedPromptOwnership(missing), /Consumed prompt UUID/);
  const foreign = structuredClone(wire);
  foreign[1].value.user_message_uuid = "other";
  assert.throws(() => checkConsumedPromptOwnership(foreign), /Consumed prompt UUID/);
  const plural = structuredClone(wire);
  delete plural[1].value.user_message_uuid;
  plural[1].value.user_message_uuids = ["ACCEPT_LOCAL_SUBAGENT"];
  assert.deepEqual(checkConsumedPromptOwnership(plural), { consumedPromptOwnership: true });
  const human = structuredClone(wire);
  human.at(-1).value.origin.kind = "human";
  assert.throws(() => checkConsumedPromptOwnership(human), /non-human/);
  const reused = structuredClone(wire);
  reused.at(-1).value.user_message_uuid = "ACCEPT_LOCAL_SUBAGENT";
  assert.throws(() => checkConsumedPromptOwnership(reused), /must not recharge/);
});
