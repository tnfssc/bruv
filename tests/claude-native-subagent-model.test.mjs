import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  reply,
  startModel,
  modelId,
  modelSlug,
  modelsConfig,
  title,
  cancelTitle,
  stopTitle,
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
  assert.match(launch, /await subagent\(\{\s*type:\s*"normal"/);
  assert.match(launch, /waitSeconds:\s*0/);
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
  assert.match(cancel, /final.status\s*!==\s*"killed"/);
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

// These execute the emitted JavaScript with explicit runtime stubs, not a native connector.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
async function stateDirectory(t) {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-program-"));
  // Quoted paths must remain data when embedded in the emitted tool program.
  const nested = path.join(state, 'quoted "state"');
  await fs.mkdir(nested);
  t.after(() => fs.rm(state, { recursive: true, force: true }));
  return nested;
}
for (const [marker, scenario] of [
  ["CHILD_LOCAL_REAL", "child"],
  ["CHILD_CANCEL_REAL", "cancel"],
  ["CHILD_STOP_REAL", "stop"],
]) {
  test(`emitted ${scenario} tool records its PID and only answers after release`, async (t) => {
    const state = await stateDirectory(t);
    const output = [];
    const waits = [];
    const program = code(reply(request(marker), { state }));
    await new AsyncFunction("process", "console", "setTimeout", program)(
      { pid: 301 },
      { log: (...args) => output.push(args) },
      (resume, delay) => {
        waits.push(delay);
        assert.equal(readFileSync(path.join(state, scenario + ".ready"), "utf8"), "301");
        assert.deepEqual(output, []);
        writeFileSync(path.join(state, scenario + ".release"), "release");
        resume();
      },
    );
    assert.deepEqual(waits, [50]);
    assert.deepEqual(output, [["CHILD_TOOL_RESULT_REAL"]]);
  });
}
test("emitted cancellation waits for child startup, stops the job, then observes killed status", async (t) => {
  const state = await stateDirectory(t);
  const events = [];
  const output = [];
  let inspections = 0;
  const program = code(reply(request("ACCEPT_LOCAL_CANCEL"), { state }));
  await new AsyncFunction("subagent", "jobs", "console", "setTimeout", program)(
    async (options) => {
      events.push("launch");
      assert.deepEqual(options, {
        type: "normal",
        title: cancelTitle,
        prompt: "CHILD_CANCEL_REAL: run the actual waiting child tool.",
        waitSeconds: 0,
      });
      return { id: "task_fixture", background: true };
    },
    {
      inspect: async (id) => {
        assert.equal(id, "task_fixture");
        events.push("inspect");
        return { pid: 201, status: ++inspections < 3 ? "running" : "killed" };
      },
      stop: async (id) => {
        assert.equal(id, "task_fixture");
        events.push("stop");
        assert.equal(readFileSync(path.join(state, "cancel.ready"), "utf8"), "301");
        return { acknowledged: true };
      },
    },
    { log: (...args) => output.push(args) },
    (resume, delay) => {
      events.push(delay);
      if (delay === 50) {
        assert.equal(readFileSync(path.join(state, "cancel.worker.pid"), "utf8"), "201");
        writeFileSync(path.join(state, "cancel.ready"), "301");
      }
      resume();
    },
  );
  assert.deepEqual(events, ["launch", "inspect", 50, "stop", "inspect", 25, "inspect"]);
  assert.deepEqual(output, [
    [JSON.stringify({ acknowledged: true })],
    ["CANCEL_INSPECT_REAL", JSON.stringify({ pid: 201, status: "killed" })],
  ]);
});
test("emitted Stop root records both owned processes and holds without cancelling the job itself", async (t) => {
  const state = await stateDirectory(t);
  const events = [];
  const program = code(reply(request("ACCEPT_LOCAL_STOP"), { state }));
  await new AsyncFunction("subagent", "jobs", "console", "process", "setTimeout", program)(
    async (options) => {
      events.push("launch");
      assert.deepEqual(options, {
        type: "normal",
        title: stopTitle,
        prompt: "CHILD_STOP_REAL: run the actual waiting child tool.",
        waitSeconds: 0,
      });
      return { id: "task_fixture", background: true };
    },
    {
      inspect: async (id) => {
        assert.equal(id, "task_fixture");
        events.push("inspect");
        return { pid: 201, status: "running" };
      },
      stop: () => assert.fail("Stop belongs to the native owner, not the root tool"),
    },
    { log: () => assert.fail("Stop root should hold, not publish a result") },
    { pid: 101 },
    (resume, delay) => {
      events.push(delay);
      assert.equal(readFileSync(path.join(state, "stop.worker.pid"), "utf8"), "201");
      if (delay === 50) writeFileSync(path.join(state, "stop.ready"), "301");
      else {
        assert.equal(delay, 30000);
        assert.equal(readFileSync(path.join(state, "stop.ready"), "utf8"), "301");
        assert.equal(readFileSync(path.join(state, "stop.root-tool.pid"), "utf8"), "101");
      }
      resume();
    },
  );
  assert.deepEqual(events, ["launch", "inspect", 50, 30000]);
});
test("emitted cancellation rejects a nonterminal job even after a stop report", async (t) => {
  const state = await stateDirectory(t);
  await fs.writeFile(path.join(state, "cancel.ready"), "301");
  const output = [];
  const times = [0, 30001];
  const program = code(reply(request("ACCEPT_LOCAL_CANCEL"), { state }));
  await assert.rejects(
    new AsyncFunction("subagent", "jobs", "console", "Date", "setTimeout", program)(
      async () => ({ id: "task_fixture", background: true }),
      {
        inspect: async () => ({ pid: 201, status: "running" }),
        stop: async () => ({ acknowledged: true }),
      },
      { log: (...args) => output.push(args) },
      { now: () => times.shift() },
      (resume, delay) => {
        assert.equal(delay, 25);
        resume();
      },
    ),
    /Cancel not terminal: running/,
  );
  assert.deepEqual(output, [[JSON.stringify({ acknowledged: true })]]);
});
