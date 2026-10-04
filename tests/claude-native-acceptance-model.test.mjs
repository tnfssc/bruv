import { test } from "node:test";
import assert from "node:assert/strict";
import { startModel, reply, modelsConfig, modelId, modelSlug } from "../scripts/claude-native-acceptance/model.mjs";
const options = { state: "/isolated/state", worker: "/fixture/worker.mjs" };
const request = (content, extra = []) => ({
  model: modelId,
  messages: [{ role: "user", content }, ...extra],
  tools: [{ type: "function", function: { name: "execute" } }],
});
test("test model is explicitly custom provider/id, never a Claude alias", () => {
  const config = modelsConfig(1234);
  assert.equal(modelSlug, "bruv-acceptance/local-deterministic-v1");
  assert.equal(config.providers["bruv-acceptance"].baseUrl, "http://127.0.0.1:1234/v1");
  assert.equal(config.providers["bruv-acceptance"].models[0].reasoning, false);
  assert.throws(() => reply({ ...request("ACCEPT_EXECUTE"), model: "claude-sonnet-4-6" }, options), /Wrong test model/);
});
test("deterministic model requests actual execute and managed shell, not native packets", () => {
  const execute = reply(request("ACCEPT_EXECUTE"), options).tool_calls[0];
  assert.equal(execute.function.name, "execute");
  assert.match(JSON.parse(execute.function.arguments).code, /BRUV_EXECUTE_REAL/);
  const early = reply(request("ACCEPT_EARLY_RETURN"), options).tool_calls[0];
  const code = JSON.parse(early.function.arguments).code;
  assert.match(code, /await shell/);
  assert.match(code, /waitSeconds:0/);
  assert.ok(code.includes("/isolated/state"));
  assert.equal(reply(request("ACCEPT_STEER_NOW"), options).content, "STEER_ADMITTED_REAL");
});
test("no completion or early-return is generated without runtime result evidence", () => {
  assert.throws(
    () => reply(request("ACCEPT_EARLY_RETURN", [{ role: "tool", content: "not a job" }]), options),
    /Expected actual managed/,
  );
  assert.equal(
    reply(
      request("ACCEPT_EARLY_RETURN", [{ role: "tool", content: '{"id":"task_example","background":true}' }]),
      options,
    ).content,
    "EARLY_RETURN_REAL",
  );
  assert.equal(
    reply(request("ACCEPT_EARLY_RETURN", [{ role: "tool", content: "MANAGED_DONE_early" }]), options).content,
    "TASK_COMPLETED_REAL",
  );
});
test("loopback endpoint has exact API path and truthful SSE model identity", async () => {
  const model = await startModel(options);
  try {
    const url = "http://127.0.0.1:" + model.port;
    assert.equal((await fetch(url + "/v1/chat/completions")).status, 404);
    const response = await fetch(url + "/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(request("ACCEPT_EXECUTE")),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const chunks = (await response.text()).trim().split("\n\n");
    assert.equal(chunks.at(-1), "data: [DONE]");
    const delta = JSON.parse(chunks[0].slice(6));
    assert.equal(delta.model, modelId);
    assert.equal(delta.choices[0].delta.tool_calls[0].function.name, "execute");
    const wrong = await fetch(url + "/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ ...request("ACCEPT_EXECUTE"), model: "opus" }),
    });
    assert.equal(wrong.status, 400);
  } finally {
    await model.close();
  }
});
test("integrated protocol validator rejects absent actual implementation evidence", async () => {
  const { checkWire } = await import("../scripts/claude-native-acceptance/driver.mjs");
  assert.throws(() => checkWire([]), /steering admission/);
});

test("post-Stop cancellation launches a fresh owned job and requires confirmed exit", () => {
  const call = reply(request("ACCEPT_CANCEL"), options).tool_calls[0];
  const code = JSON.parse(call.function.arguments).code;
  assert.match(code, /const job = await shell/);
  assert.match(code, /jobs.stop\(job.id\)/);
  assert.match(code, /jobs.inspect\(job.id\)/);
  assert.doesNotMatch(code, /jobs.list|survived generation Stop/);
  assert.throws(
    () => reply(request("ACCEPT_CANCEL", [{ role: "tool", content: "no evidence" }]), options),
    /terminal inspection/,
  );
  assert.equal(
    reply(request("ACCEPT_CANCEL", [{ role: "tool", content: "CANCEL_INSPECT_REAL" }]), options).content,
    "CANCEL_CONFIRMED_REAL",
  );
});

test("actual killed-job completion has its own response without a fake new prompt", () => {
  const notification =
    "1 asynchronous task completed.\n\ntask_fixture killed\nCommand: /usr/bin/node " +
    options.worker +
    " " +
    options.state +
    " cancel";
  assert.equal(reply(request(notification), options).content, "CANCELLATION_COMPLETED_REAL");
  assert.throws(() => reply(request("1 asynchronous task completed. unrelated"), options), /Unrecognized/);
});
