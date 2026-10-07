import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  reply,
  startWorkerModel,
  workerId,
  workerInstance,
  workerModels,
  workerProvider,
  workerSlug,
} from "../scripts/claude-native-acceptance/app-delegation-model.mjs";

import { modelId } from "../scripts/claude-native-acceptance/model.mjs";

// Tool outputs below are transcript fixtures, not evidence of a native runtime.
function request(model, user) {
  return {
    model,
    __sequence: 1,
    tools: ["__orchestrator_capabilities", "__delegate_task", "__task_status", "__task_cancel", "execute"].map(
      (name) => ({ function: { name: name === "execute" ? name : "mcp__t3-code" + name } }),
    ),
    messages: [{ role: "user", content: user }],
  };
}
function result(body, value) {
  body.messages.push({ role: "tool", content: typeof value === "string" ? value : JSON.stringify(value) });
}
function called(delta) {
  return { name: delta.tool_calls[0].function.name, input: JSON.parse(delta.tool_calls[0].function.arguments) };
}
async function stateDirectory(t) {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "native-app-journey-"));
  t.after(() => fs.rm(state, { recursive: true, force: true }));
  return state;
}

test("normal fixture is a distinct exact reasoning provider with a supported summary API", () => {
  const model = workerModels(1234).providers[workerProvider];
  assert.equal(model.api, "openai-responses");
  assert.equal(model.models[0].id, workerId);
  assert.equal(model.models[0].reasoning, true);
  assert.match(model.baseUrl, /127\.0\.0\.1:1234/);
});
test("loopback Responses SSE requests real injected delegation and enforces actual high reasoning", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "native-app-model-test-"));
  const endpoint = await startWorkerModel({ state });
  try {
    const input = {
      model: workerId,
      input: [{ role: "user", content: [{ type: "input_text", text: "APP_CHILD_DONE" }] }],
      reasoning: { effort: "high", summary: "auto" },
      tools: [{ type: "function", name: "mcp__t3-code__delegate_task", parameters: { type: "object" } }],
    };
    const result = await fetch("http://127.0.0.1:" + endpoint.port + "/v1/responses", {
      method: "POST",
      body: JSON.stringify(input),
    });
    assert.equal(result.status, 200);
    const sse = await result.text();
    assert.match(sse, /response.output_item.done/);
    assert.match(sse, /mcp__t3-code__delegate_task/);
    assert.match(sse, /response.completed/);
    assert.equal(endpoint.records[0].reasoningEffort, "high");
    const wrong = await fetch("http://127.0.0.1:" + endpoint.port + "/v1/responses", {
      method: "POST",
      body: JSON.stringify({ ...input, reasoning: { effort: "low", summary: "auto" } }),
    });
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /exact model.*high reasoning/);
  } finally {
    await endpoint.close();
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("root cancellation re-reads actual nonterminal status before confirming and checks its real job registry", async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "native-app-cancel-model-"));
  try {
    const task = { taskId: "task-real", childThreadId: "child-real" };
    await fs.writeFile(path.join(state, "cancel.task.json"), JSON.stringify(task));
    const body = {
      model: "local-deterministic-v1",
      __sequence: 1,
      tools: ["task_status", "execute"].map((name) => ({
        function: { name: name === "execute" ? name : "mcp__t3-code__" + name },
      })),
      messages: [
        { role: "user", content: "APP_CANCEL" },
        { role: "tool", content: JSON.stringify({ ...task, status: "cancel_requested" }) },
        { role: "tool", content: JSON.stringify({ ...task, status: "running" }) },
      ],
    };
    assert.equal((await reply(body, { state })).tool_calls[0].function.name, "mcp__t3-code__task_status");
    body.messages.push({ role: "tool", content: JSON.stringify({ ...task, status: "interrupted" }) });
    assert.equal((await reply(body, { state })).tool_calls[0].function.name, "execute");
    body.messages.push({ role: "tool", content: "ROOT_JOBS_REAL []" });
    assert.equal((await reply(body, { state })).content, "APP_CANCEL_CONFIRMED_REAL");
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("root launch checks capabilities, preserves request identity, and records only the returned native task", async (t) => {
  const state = await stateDirectory(t);
  for (const scenario of ["done", "cancel"]) {
    const body = request(modelId, "APP_DELEGATE_" + scenario.toUpperCase());
    assert.equal(called(await reply(body, { state })).name, "mcp__t3-code__orchestrator_capabilities");
    result(body, "No configured worker");
    await assert.rejects(reply(body, { state }), /capabilities omit named worker.model/);
    body.messages.pop();
    const capabilities = workerInstance + " " + workerSlug;
    result(body, capabilities);
    const launch = called(await reply(body, { state }));
    assert.equal(launch.name, "mcp__t3-code__delegate_task");
    assert.equal(launch.input.clientRequestId, "actual-native-" + scenario);
    assert.equal(launch.input.title, "Native normal " + scenario);
    assert.match(launch.input.task, new RegExp("APP_CHILD_" + scenario.toUpperCase()));
    assert.equal(await fs.readFile(path.join(state, "capabilities.json"), "utf8"), capabilities);
    result(body, { taskId: "incomplete" });
    await assert.rejects(reply(body, { state }), /did not return a taskId.childThreadId/);
    body.messages.pop();
    const task = { taskId: "fixture-" + scenario, childThreadId: "fixture-child-" + scenario };
    result(body, [{ type: "text", text: JSON.stringify(task) }]);
    assert.equal((await reply(body, { state })).content, "APP_TASK_PENDING_REAL_" + scenario);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(state, scenario + ".task.json"), "utf8")), task);
  }
});

test("normal worker must pass both delegation denials and scope checks before release and result", async (t) => {
  const state = await stateDirectory(t);
  for (const scenario of ["done", "cancel"]) {
    const body = request(workerId, "APP_CHILD_" + scenario.toUpperCase());
    const task = { taskId: "fixture-" + scenario, childThreadId: "fixture-child" };
    await fs.writeFile(path.join(state, scenario + ".task.json"), JSON.stringify(task));
    assert.deepEqual(called(await reply(body, { state })), {
      name: "mcp__t3-code__delegate_task",
      input: { task: "Worker must be denied", clientRequestId: "worker-denied" },
    });
    result(body, "Admitted");
    await assert.rejects(reply(body, { state }), /Worker delegation was not denied/);
    body.messages.pop();
    result(body, "normal workers cannot delegate");
    assert.match(called(await reply(body, { state })).input.code, /await subagent/);
    result(body, "unexpected admission");
    await assert.rejects(reply(body, { state }), /Normal local worker delegation admitted/);
    body.messages.pop();
    result(body, "LOCAL_WORKER_DENIAL_REAL Only orchestrator agents can delegate");
    assert.match(called(await reply(body, { state })).input.code, /CHILD_SCOPE_REAL/);
    result(body, 'CHILD_SCOPE_REAL {"rootControls":["T3_ROOT"],"jobs":0}');
    await assert.rejects(reply(body, { state }), /Root controls leaked into execute/);
    body.messages.pop();
    result(body, 'CHILD_SCOPE_REAL {"rootControls":[],"jobs":0}');
    assert.deepEqual(called(await reply(body, { state })), {
      name: "mcp__t3-code__task_status",
      input: { taskId: task.taskId },
    });
    result(body, { ...task, status: "running" });
    await assert.rejects(reply(body, { state }), /Child credential could read root app task/);
    await assert.rejects(fs.access(path.join(state, scenario + ".started")), { code: "ENOENT" });
    body.messages.pop();
    result(body, "does not belong to thread");
    await fs.writeFile(path.join(state, scenario + ".release"), "fixture release");
    assert.equal((await reply(body, { state })).content, "APP_CHILD_RESULT_REAL_" + scenario);
    assert.match(
      await fs.readFile(path.join(state, scenario + ".scope-denial.json"), "utf8"),
      /does not belong to thread/,
    );
    assert.match(await fs.readFile(path.join(state, scenario + ".started"), "utf8"), /reached scoped execute/);
  }
});

test("completion turn inspects the saved native ID and requires the returned child result before acknowledgement", async (t) => {
  const state = await stateDirectory(t);
  const task = { taskId: "fixture-done", childThreadId: "fixture-child" };
  await fs.writeFile(path.join(state, "done.task.json"), JSON.stringify(task));
  const body = request(modelId, "APP_DELEGATE_DONE");
  result(body, "earlier launch result");
  body.messages.push({ role: "user", content: "fixture native completion wake" });
  assert.deepEqual(called(await reply(body, { state })), {
    name: "mcp__t3-code__task_status",
    input: { taskId: task.taskId },
  });
  result(body, { ...task, status: "completed" });
  await assert.rejects(reply(body, { state }), /task_status omitted child result/);
  await assert.rejects(fs.access(path.join(state, "done.status.json")), { code: "ENOENT" });
  body.messages.pop();
  result(body, { ...task, status: "completed", result: "APP_CHILD_RESULT_REAL_done" });
  assert.equal((await reply(body, { state })).content, "APP_COMPLETION_ACK_REAL");
  const evidence = await fs.readFile(path.join(state, "done.status.json"), "utf8");
  assert.match(evidence, /APP_CHILD_RESULT_REAL_done/);
  assert.doesNotMatch(evidence, /earlier launch result/);
});

test("cancellation rejects other terminal states and duplicate Bruv ownership", async (t) => {
  const state = await stateDirectory(t);
  const task = { taskId: "fixture-cancel", childThreadId: "fixture-child" };
  await fs.writeFile(path.join(state, "cancel.task.json"), JSON.stringify(task));
  const body = request(modelId, "APP_CANCEL");
  assert.deepEqual(called(await reply(body, { state })), {
    name: "mcp__t3-code__task_cancel",
    input: { taskId: task.taskId },
  });
  result(body, { ...task, status: "cancel_requested" });
  assert.deepEqual(called(await reply(body, { state })), {
    name: "mcp__t3-code__task_status",
    input: { taskId: task.taskId },
  });
  result(body, { ...task, status: "completed" });
  await assert.rejects(reply(body, { state }), /Unexpected actual native cancellation terminal: completed/);
  body.messages.pop();
  result(body, { ...task, status: "interrupted" });
  assert.match(called(await reply(body, { state })).input.code, /jobs.list/);
  result(body, 'ROOT_JOBS_REAL [{"id":"duplicate"}]');
  await assert.rejects(reply(body, { state }), /duplicated in root Bruv registry/);
  await assert.rejects(fs.access(path.join(state, "cancel.status.json")), { code: "ENOENT" });
  body.messages.pop();
  result(body, "ROOT_JOBS_REAL []");
  assert.equal((await reply(body, { state })).content, "APP_CANCEL_CONFIRMED_REAL");
  assert.match(await fs.readFile(path.join(state, "cancel.status.json"), "utf8"), /ROOT_JOBS_REAL \[\]/);
});
