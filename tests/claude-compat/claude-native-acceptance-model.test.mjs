import { test } from "node:test";
import assert from "node:assert/strict";
import { startModel, reply, modelsConfig, modelId, modelSlug } from "../../scripts/claude-native-acceptance/model.mjs";
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
  const { checkWire } = await import("../../scripts/claude-native-acceptance/driver.mjs");
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

test("human permission scenarios request actual side effects, never native packets", () => {
  for (const scenario of ["allow", "deny", "stop"]) {
    const call = reply(request("HUMAN_PERMISSION_" + scenario), options).tool_calls[0];
    assert.equal(call.function.name, "execute");
    const code = JSON.parse(call.function.arguments).code;
    assert.match(code, /await Bun.write/);
    assert.ok(code.includes("/isolated/state/permission-"));
    assert.ok(code.includes(JSON.stringify("/isolated/state/permission-" + scenario + ".effect")));
    assert.doesNotMatch(code, /control_request|control_response|task_started/);
  }
  assert.throws(() => reply(request("HUMAN_PERMISSION_unknown"), options), /Unknown permission/);
});

test("saved human question uses durable ask/block and explicit answer resolve", () => {
  const ask = JSON.parse(reply(request("HUMAN_QUESTION_ASK"), options).tool_calls[0].function.arguments).code;
  assert.match(ask, /questions.ask/);
  assert.match(ask, /questions.block/);
  assert.match(ask, /owner:\s*q.owner,\s*version:\s*q.version/);
  assert.doesNotMatch(ask, /questions.answer/);
  const use = JSON.parse(reply(request("Saved answer for question"), options).tool_calls[0].function.arguments).code;
  assert.match(use, /questions.list/);
  assert.match(use, /q.status\s*!==\s*"answered"/);
  assert.match(use, /questions.resolve/);
  assert.equal(
    reply(request("Saved answer for question", [{ role: "tool", content: "QUESTION_RESOLVED_ACTUAL" }]), options)
      .content,
    "HUMAN_ANSWER_DELIVERED_ONCE_REAL",
  );
});

test("human protocol acceptance rejects absent native consent evidence", async () => {
  const { checkHumanWire } = await import("../../scripts/claude-native-acceptance/human-driver.mjs");
  assert.throws(() => checkHumanWire([]), /actual execute consent/);
});

test("actual shortened cancellation notice must match the prior confirmed job ID", () => {
  const notice = "1 asynchronous task completed.\n\ntask_deadbeef killed\nCommand: /usr/bin/node ...[truncated]...";
  const body = request(notice);
  body.messages.unshift({ role: "tool", content: 'CANCEL_INSPECT_REAL {"id":"task_deadbeef","status":"killed"}' });
  assert.equal(reply(body, options).content, "CANCELLATION_COMPLETED_REAL");
  const other = request(notice);
  other.messages.unshift({ role: "tool", content: 'CANCEL_INSPECT_REAL {"id":"task_12345678","status":"killed"}' });
  assert.throws(() => reply(other, options), /Unrecognized acceptance request/);
});

test("truncated actual cancellation notice uses the ID written by its real execute launch", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "native-model-cancel-id-"));
  try {
    await fs.writeFile(path.join(state, "cancel.job-id"), "task_deadbeef");
    const notice = "1 asynchronous task completed.\n\ntask_deadbeef killed\nCommand: /usr/bin/node ...[shortened]...";
    assert.equal(reply(request(notice), { ...options, state }).content, "CANCELLATION_COMPLETED_REAL");
    assert.equal(
      reply(request([{ type: "text", text: notice }]), { ...options, state }).content,
      "CANCELLATION_COMPLETED_REAL",
    );
    const code = JSON.parse(
      reply(request("ACCEPT_CANCEL"), { ...options, state }).tool_calls[0].function.arguments,
    ).code;
    assert.ok(code.includes(JSON.stringify(path.join(state, "cancel.job-id"))));
    assert.match(code, /job.id\);\s*console.log\(JSON.stringify\(await jobs.stop/);
    await fs.writeFile(path.join(state, "cancel.job-id"), "task_12345678");
    assert.throws(() => reply(request(notice), { ...options, state }), /Unrecognized acceptance request/);
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("overlapping async replies retain their own SSE and success/error record sequence", async () => {
  let release, slowEntered, failedEntered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const slowStarted = new Promise((resolve) => {
    slowEntered = resolve;
  });
  const failedStarted = new Promise((resolve) => {
    failedEntered = resolve;
  });
  const model = await startModel({
    reply: async (body) => {
      const user = body.messages[0].content;
      if (user === "slow") {
        slowEntered();
        await gate;
      }
      if (user === "failed") {
        failedEntered();
        await gate;
        throw Error("delayed failure");
      }
      return { role: "assistant", content: user + ":" + body.__sequence };
    },
  });
  const post = (user) =>
    fetch("http://127.0.0.1:" + model.port + "/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(request(user)),
    }).then(async (response) => ({ status: response.status, text: await response.text() }));
  try {
    const slow = post("slow");
    await slowStarted;
    const failed = post("failed");
    await failedStarted;
    const fast = await post("fast");
    release();
    const [slowResponse, failedResponse] = await Promise.all([slow, failed]);
    for (const [response, sequence, content] of [
      [slowResponse, 1, "slow:1"],
      [fast, 3, "fast:3"],
    ]) {
      assert.equal(response.status, 200);
      const chunks = response.text.trim().split("\n\n");
      assert.equal(chunks.pop(), "data: [DONE]");
      const frames = chunks.map((chunk) => JSON.parse(chunk.slice(6)));
      assert.deepEqual(
        frames.map((frame) => frame.id),
        Array(2).fill("local-acceptance-" + sequence),
      );
      assert.equal(frames[0].choices[0].delta.content, content);
      assert.equal(model.records.find((record) => record.delta?.content === content).sequence, sequence);
    }
    assert.equal(failedResponse.status, 400);
    assert.equal(JSON.parse(failedResponse.text).error.message, "delayed failure");
    assert.deepEqual(
      model.records.find((record) => record.error),
      { sequence: 2, error: "delayed failure" },
    );
  } finally {
    release();
    await model.close();
  }
});

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
function exerciseCode(user, names) {
  const code = JSON.parse(reply(request(user), options).tool_calls[0].function.arguments).code;
  return new AsyncFunction(...names, code);
}

test("cancellation program saves its owned ID before stop and waits for terminal inspection", async () => {
  const events = [];
  let inspections = 0;
  await exerciseCode("ACCEPT_CANCEL", ["shell", "Bun", "jobs", "console"])(
    async (command, config) => {
      events.push(["shell", command, config]);
      return { id: "task_owned", background: true };
    },
    { write: async (path, id) => events.push(["write", path, id]) },
    {
      stop: async (id) => {
        events.push(["stop", id]);
        return { status: "pending" };
      },
      inspect: async (id) => {
        const status = ++inspections === 1 ? "running" : "killed";
        events.push(["inspect", id, status]);
        return { id, status };
      },
    },
    { log: (...args) => events.push(["log", ...args]) },
  );
  assert.deepEqual(events[0], [
    "shell",
    JSON.stringify(process.execPath) +
      " " +
      JSON.stringify(options.worker) +
      " " +
      JSON.stringify(options.state) +
      " cancel",
    { waitSeconds: 0 },
  ]);
  assert.deepEqual(events[1], ["write", options.state + "/cancel.job-id", "task_owned"]);
  assert.deepEqual(events[2], ["stop", "task_owned"]);
  assert.deepEqual(
    events.filter((event) => event[0] === "inspect"),
    [
      ["inspect", "task_owned", "running"],
      ["inspect", "task_owned", "killed"],
    ],
  );
  assert.deepEqual(events.at(-1), [
    "log",
    "CANCEL_INSPECT_REAL",
    JSON.stringify({ id: "task_owned", status: "killed" }),
  ]);
});

test("saved-question programs block the returned authority and resolve only an explicit answered choice", async () => {
  const q = { id: "q_actual", owner: "human", version: 7, dedupKey: "human-controls-acceptance" };
  const events = [];
  const questions = {
    ask: async (args) => {
      events.push(["ask", args]);
      return q;
    },
    block: async (args) => events.push(["block", args]),
    list: async () => [q],
    resolve: async (args) => {
      events.push(["resolve", args]);
      return { status: "resolved" };
    },
  };
  const console = { log: (...args) => events.push(["log", ...args]) };
  await exerciseCode("HUMAN_QUESTION_ASK", ["questions", "console"])(questions, console);
  assert.deepEqual(events[0], [
    "ask",
    {
      text: "Acceptance saved human question",
      dedupKey: "human-controls-acceptance",
      choices: ["Use local fixture", "Cancel"],
      allowFreeText: false,
    },
  ]);
  assert.deepEqual(events[1], [
    "block",
    { id: q.id, owner: q.owner, version: q.version, checkpoint: "Use the saved human answer", foreground: false },
  ]);
  const useAnswer = exerciseCode("Saved answer for question", ["questions", "console"]);
  await assert.rejects(useAnswer(questions, console), /No saved human answer/);
  assert.equal(
    events.some((event) => event[0] === "resolve"),
    false,
  );
  q.status = "answered";
  q.answer = "Use local fixture";
  await useAnswer(questions, console);
  assert.deepEqual(events.at(-2), [
    "resolve",
    { id: q.id, owner: q.owner, version: q.version, reason: "Acceptance used explicit saved human answer" },
  ]);
  assert.deepEqual(events.at(-1), ["log", "QUESTION_RESOLVED_ACTUAL", JSON.stringify({ status: "resolved" })]);
});
