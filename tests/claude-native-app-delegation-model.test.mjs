import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  startWorkerModel,
  reply,
  workerModels,
  workerId,
  workerProvider,
} from "../scripts/claude-native-acceptance/app-delegation-model.mjs";

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
