import test from "node:test";
import assert from "node:assert/strict";
import {
  reply,
  startModel,
  modelId,
  modelSlug,
  modelsConfig,
  title,
} from "../scripts/claude-native-acceptance/subagent-model.mjs";
const options = { state: "/isolated/local-normal-state" };
const request = (user, tail = []) => ({
  model: modelId,
  tools: [{ type: "function", function: { name: "execute" } }],
  messages: [{ role: "user", content: user }, ...tail],
  __sequence: 1,
});
const code = (delta) => JSON.parse(delta.tool_calls[0].function.arguments).code;
test("exact local identity and actual normal background helper, no fabricated native frames", () => {
  assert.equal(modelSlug, "bruv-acceptance/local-deterministic-v1");
  assert.equal(modelsConfig(18001).providers["bruv-acceptance"].models[0].id, modelId);
  assert.throws(() => reply({ ...request("ACCEPT_LOCAL_SUBAGENT"), model: "opus" }, options), /Wrong model/);
  const launch = code(reply(request("ACCEPT_LOCAL_SUBAGENT"), options));
  assert.ok(launch.includes('await subagent({type:"normal"'));
  assert.match(launch, /waitSeconds:0/);
  assert.ok(launch.includes(title));
  assert.doesNotMatch(launch, /task_started|task_notification|parent_tool_use_id/);
});
test("root background ACK requires real result; child answer requires its actual tool result", () => {
  assert.throws(
    () => reply(request("ACCEPT_LOCAL_SUBAGENT", [{ role: "tool", content: "no runtime result" }]), options),
    /background launch/,
  );
  assert.equal(
    reply(
      request("ACCEPT_LOCAL_SUBAGENT", [{ role: "tool", content: '{"id":"task_fixture","background":true}' }]),
      options,
    ).content,
    "ROOT_BACKGROUND_RETURN_REAL",
  );
  const child = code(reply(request("CHILD_LOCAL_REAL"), options));
  assert.match(child, /fs.writeFile/);
  assert.match(child, /child.release/);
  assert.equal(
    reply(request("CHILD_LOCAL_REAL", [{ role: "tool", content: "CHILD_TOOL_RESULT_REAL" }]), options).content,
    "CHILD_ANSWER_REAL",
  );
  assert.throws(
    () => reply(request("CHILD_LOCAL_REAL", [{ role: "tool", content: "failed" }]), options),
    /Child tool failed/,
  );
});
test("actual completion and killed-job notifications get distinct continuations", () => {
  assert.equal(
    reply(request("1 asynchronous task completed. task_fixture completed CHILD_ANSWER_REAL"), options).content,
    "ROOT_COMPLETION_ONCE_REAL",
  );
  assert.equal(
    reply(request("1 asynchronous task completed. task_fixture killed"), options).content,
    "ROOT_KILLED_COMPLETION_REAL",
  );
  assert.throws(() => reply(request("1 asynchronous task completed. unknown"), options), /Unexpected real completion/);
});
test("cancellation requires confirmed inspection and Stop leaves teardown with the owner", () => {
  const cancel = code(reply(request("ACCEPT_LOCAL_CANCEL"), options));
  assert.ok(cancel.includes("jobs.stop(r.id)"));
  assert.match(cancel, /final.status!=="killed"/);
  assert.equal(
    reply(request("ACCEPT_LOCAL_CANCEL", [{ role: "tool", content: "CANCEL_INSPECT_REAL" }]), options).content,
    "ROOT_CANCEL_CONFIRMED_REAL",
  );
  assert.throws(
    () => reply(request("ACCEPT_LOCAL_CANCEL", [{ role: "tool", content: "not stopped" }]), options),
    /not confirmed/,
  );
  const stop = code(reply(request("ACCEPT_LOCAL_STOP"), options));
  assert.match(stop, /await subagent/);
  assert.doesNotMatch(stop, /jobs.stop/);
});
test("loopback SSE uses real provider tool delta and bounded explicit token accounting", async () => {
  const model = await startModel(options);
  try {
    const response = await fetch("http://127.0.0.1:" + model.port + "/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(request("ACCEPT_LOCAL_SUBAGENT")),
    });
    assert.equal(response.status, 200);
    const chunk = JSON.parse((await response.text()).split("\n\n")[0].slice(6));
    assert.equal(chunk.model, modelId);
    assert.equal(chunk.choices[0].delta.tool_calls[0].function.name, "execute");
    assert.equal(chunk.usage.total_tokens, 18);
  } finally {
    await model.close();
  }
});
