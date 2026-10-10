import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "../../scripts/claude-native-acceptance/goal-controls-driver.mjs";
import {
  budgetObjective,
  objective,
  reply,
  usage,
  verifyModelOutcome,
} from "../../scripts/claude-native-acceptance/goal-controls-model.mjs";
import { modelId, startModel } from "../../scripts/claude-native-acceptance/model.mjs";
import { runAcceptance } from "../../scripts/claude-native-acceptance/run.mjs";

const request = (selected) => ({
  model: modelId,
  tools: [{ type: "function", function: { name: "execute" } }],
  messages: [{ role: "user", content: `Persistent goal state (authoritative):\nGoal: ${selected}\nStatus: active` }],
});

test("native goal fixture requires authoritative state and real completion tool evidence", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "goal-native-model-test-"));
  try {
    await assert.rejects(reply(request("unrecognized"), { state }), /authoritative goal state/);
    assert.equal((await reply(request(objective), { state })).content, "GOAL_FIRST_UNFINISHED_REAL");
    const budget = await reply(request(budgetObjective), { state });
    assert.match(JSON.parse(budget.tool_calls[0].function.arguments).code, /budget-forbidden.effect/);
    const resume = await reply(request(budgetObjective), { state });
    const code = JSON.parse(resume.tool_calls[0].function.arguments).code;
    assert.match(code, /await goal.get\(\)/);
    assert.match(code, /await goal.update/);
    assert.doesNotMatch(code, /Goal set:|synthetic|command_lifecycle/);
    const completed = request(budgetObjective);
    completed.messages.push({ role: "tool", content: `GOAL_COMPLETED_TOOL_REAL:${budgetObjective}` });
    assert.equal((await reply(completed, { state })).content, "GOAL_BUDGET_COMPLETED_REAL");
    completed.messages.push(
      { role: "user", content: "NATIVE_GOAL_POST_COMPLETION" },
      { role: "user", content: "Native permission state: default" },
    );
    assert.equal((await reply(completed, { state })).content, "GOAL_POST_COMPLETION_REAL");
    assert.throws(() => verifyModelOutcome([]), /Exactly one/);
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("local SSE usage reaches provider accounting and interrupted gate settles cleanly", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "goal-native-sse-test-"));
  const model = await startModel({ state, reply, usage });
  try {
    const url = `http://127.0.0.1:${model.port}/v1/chat/completions`;
    const result = await fetch(url, { method: "POST", body: JSON.stringify(request(objective)) });
    const chunks = (await result.text())
      .split("\n\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)));
    assert.deepEqual(chunks.find((chunk) => chunk.usage)?.usage, usage);
    const controller = new AbortController();
    const streaming = await fetch(url, {
      method: "POST",
      body: JSON.stringify(request(objective)),
      signal: controller.signal,
    });
    const rejected = assert.rejects(streaming.text(), /abort/i);
    while (
      !(await fs.access(path.join(state, "goal-2.started")).then(
        () => true,
        () => false,
      ))
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await rejected;
    const deadline = Date.now() + 1000;
    while (!model.records.some((row) => row.aborted) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      model.records.some((row) => row.aborted),
      true,
    );
    assert.equal(
      model.records.some((row) => row.error),
      false,
    );
  } finally {
    await model.close();
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("native runner rejects unknown scenarios before touching configured artifacts", async () => {
  await assert.rejects(runAcceptance({ scenario: "missing" }), /Unknown native acceptance scenario/);
});

test("goal capture supports the native bootstrap hook and retains only projected correlation", async () => {
  assert.deepEqual(await capture({ page: {} }), {});
  const proof = await fs.mkdtemp(path.join(os.tmpdir(), "goal-native-capture-test-"));
  try {
    await capture({
      proof,
      records: [
        {
          kind: "stdout",
          value: {
            type: "assistant",
            user_message_uuid: "private-uuid",
            message: { model: "<synthetic>", content: [{ type: "text", text: `Goal set: ${objective}` }] },
          },
        },
        {
          kind: "stdout",
          value: {
            type: "assistant",
            message: { model: "fixture", content: [{ type: "text", text: "PRIVATE_CONTENT" }] },
          },
        },
        {
          kind: "stdout",
          value: { type: "result", terminal_reason: "stop_hook_prevented", user_message_uuids: ["private-uuid"] },
        },
      ],
    });
    const raw = await fs.readFile(path.join(proof, "goal-controls-wire.json"), "utf8");
    assert.doesNotMatch(raw, /private-uuid|PRIVATE_CONTENT/);
    const rows = JSON.parse(raw);
    assert.equal(rows[0].goalMarker, "Goal set: <OBJECTIVE>");
    assert.equal(rows[2].terminalReason, "stop_hook_prevented");
    assert.equal(rows[0].userUuidHash, rows[2].userUuidHashes[0]);
  } finally {
    await fs.rm(proof, { recursive: true, force: true });
  }
});
