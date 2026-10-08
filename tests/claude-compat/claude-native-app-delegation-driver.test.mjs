import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { prepare, projectWire, verify } from "../../scripts/claude-native-acceptance/app-delegation-driver.mjs";
import { workerInstance, workerModels, workerSlug } from "../../scripts/claude-native-acceptance/app-delegation-model.mjs";

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "app-driver-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function verificationFixture(t) {
  const root = await temporaryRoot(t);
  const state = path.join(root, "state");
  const proof = path.join(root, "proof");
  const userdata = path.join(root, "t3-runtime/t3-base/userdata");
  await Promise.all([state, proof, userdata].map((dir) => fs.mkdir(dir, { recursive: true })));
  const native = ["done", "cancel"].map((scenario) => ({
    id: `${scenario}-task`,
    threadId: "parent",
    childThreadId: `${scenario}-child`,
    origin: "app_owned",
    status: scenario === "done" ? "completed" : "interrupted",
    completionDelivery: { state: scenario === "done" ? "acknowledged" : "disposed" },
    modelSelection: { instanceId: workerInstance, model: workerSlug, options: [{ id: "effort", value: "high" }] },
    lineage: { relationshipToParent: "subagent" },
  }));
  const writeNative = () => {
    const db = new DatabaseSync(path.join(userdata, "statev2.sqlite"));
    try {
      db.exec("CREATE TABLE IF NOT EXISTS orchestration_v2_projection_subagents (subagent_id TEXT, payload_json TEXT)");
      db.exec("CREATE TABLE IF NOT EXISTS orchestration_v2_projection_threads (thread_id TEXT, payload_json TEXT)");
      db.exec("DELETE FROM orchestration_v2_projection_subagents; DELETE FROM orchestration_v2_projection_threads");
      for (const { modelSelection, lineage, ...task } of native) {
        db.prepare("INSERT INTO orchestration_v2_projection_subagents VALUES (?, ?)").run(
          task.id,
          JSON.stringify(task),
        );
        db.prepare("INSERT INTO orchestration_v2_projection_threads VALUES (?, ?)").run(
          task.childThreadId,
          JSON.stringify({ modelSelection, lineage }),
        );
      }
    } finally {
      db.close();
    }
  };
  writeNative();
  for (const [index, scenario] of ["done", "cancel"].entries()) {
    // These are lookup references and model transcripts, not completion authority.
    await fs.writeFile(
      path.join(state, `${scenario}.task.json`),
      JSON.stringify({
        taskId: native[index].id,
        childThreadId: native[index].childThreadId,
        status: native[index].status,
      }),
    );
    await fs.writeFile(path.join(state, `${scenario}.status.json`), `accepted transcript ${scenario}`);
  }
  const scope = (instance, credentialDigest) => ({
    kind: "scope",
    instance,
    value: {
      hasCredential: true,
      credentialDigest,
      model: workerSlug,
      thinking: "adaptive",
      role: "normal",
      depth: "1",
    },
  });
  const wire = [
    scope("root", "parent-secret-digest"),
    scope("normal", "done-secret-digest"),
    scope("normal", "cancel-secret-digest"),
  ];
  const run = () =>
    verify({ wire, config: { state }, proof, t3Version: "test-version", t3BinarySha256: "test-binary-hash" });
  const artifact = async (name) => JSON.parse(await fs.readFile(path.join(proof, `${name}.json`), "utf8"));
  const noSuccess = () => assert.rejects(fs.access(path.join(proof, "result.json")), { code: "ENOENT" });
  return { root, state, native, wire, writeNative, run, artifact, noSuccess };
}

test("verification publishes native rows, process scopes, transcripts and success metadata", async (t) => {
  const f = await verificationFixture(t);
  await f.run();
  assert.deepEqual(await f.artifact("native-task-state"), f.native);
  assert.deepEqual(await f.artifact("native-scopes"), f.wire);
  assert.deepEqual(await f.artifact("task-status"), {
    done: "accepted transcript done",
    cancel: "accepted transcript cancel",
  });
  assert.deepEqual(await f.artifact("result"), {
    passed: true,
    appOwnedDelegation: true,
    t3Version: "test-version",
    t3BinarySha256: "test-binary-hash",
    upstreamUnmodified: true,
    syntheticConnectorEvents: false,
    realCredentialsUsed: false,
    namedWorkerInstance: workerInstance,
    workerModel: workerSlug,
    workerThinking: "high",
    normalRoleDepth: 1,
    childScopesDistinct: true,
    noDuplicateBruvNotifications: true,
    actualNativeChildCount: 2,
    nativeTerminalAck: true,
    cancellationTerminal: "interrupted",
  });
});

test("requested cancellation cannot be promoted by completed lookup files or model transcripts", async (t) => {
  const f = await verificationFixture(t);
  f.native[1].status = "cancel_requested";
  f.writeNative();
  await assert.rejects(f.run(), /interrupted/);
  assert.deepEqual(await f.artifact("native-task-state"), f.native, "failure retains authoritative native evidence");
  await f.noSuccess();
});

test("completed native status still requires terminal result acknowledgement", async (t) => {
  const f = await verificationFixture(t);
  f.native[0].completionDelivery.state = "pending";
  f.writeNative();
  await assert.rejects(f.run(), /terminal result ACK/);
  await f.noSuccess();
});

test("interrupted native status still requires cancellation-wake disposal", async (t) => {
  const f = await verificationFixture(t);
  f.native[1].completionDelivery.state = "pending";
  f.writeNative();
  await assert.rejects(f.run(), /disposes its completion wake/);
  await f.noSuccess();
});

test("native rows must establish app-owned origin", async (t) => {
  const f = await verificationFixture(t);
  f.native[0].origin = "external";
  f.writeNative();
  await assert.rejects(f.run(), /app-owned origin/);
  await f.noSuccess();
});

test("native child threads must establish subagent lineage", async (t) => {
  const f = await verificationFixture(t);
  f.native[0].lineage.relationshipToParent = "fork";
  f.writeNative();
  await assert.rejects(f.run(), /child lineage/);
  await f.noSuccess();
});

test("native child threads must store the configured high reasoning selection", async (t) => {
  const f = await verificationFixture(t);
  f.native[0].modelSelection.options[0].value = "low";
  f.writeNative();
  await assert.rejects(f.run(), /pins instance/);
  await f.noSuccess();
});

test("terminal native rows cannot compensate for reused child credentials", async (t) => {
  const f = await verificationFixture(t);
  f.wire[1].value.credentialDigest = f.wire[0].value.credentialDigest;
  await assert.rejects(f.run(), /credentials differ from root/);
  assert.deepEqual(await f.artifact("native-scopes"), f.wire);
  await f.noSuccess();
});

test("terminal native rows cannot compensate for wrong process launch selection", async (t) => {
  const f = await verificationFixture(t);
  f.wire[1].value.model = "parent-model";
  await assert.rejects(f.run(), /Exact normal model/);
  await f.noSuccess();
});

test("duplicated connector task notifications prevent success publication", async (t) => {
  const f = await verificationFixture(t);
  f.wire.push({ kind: "stdout", instance: "root", value: { type: "system", subtype: "task_notification" } });
  await assert.rejects(f.run(), /No duplicated connector/);
  await f.noSuccess();
});

test("late cancelled child results prevent success publication", async (t) => {
  const f = await verificationFixture(t);
  f.wire.push({
    kind: "stdout",
    instance: "normal",
    value: { type: "assistant", message: { content: [{ type: "text", text: "APP_CHILD_RESULT_REAL_cancel" }] } },
  });
  await assert.rejects(f.run(), /cannot publish late provider result/);
  await f.noSuccess();
});

test("projection augments the shared safe projection without exporting message bodies", () => {
  const wire = [
    { kind: "scope", instance: "normal", value: { hasCredential: true, credentialDigest: "digest" } },
    {
      kind: "stdout",
      instance: "root",
      value: { type: "assistant", message: { content: [{ type: "text", text: "PRIVATE_PROMPT" }] } },
    },
  ];
  const projection = projectWire(wire);
  assert.equal(projection.length, 2);
  assert.deepEqual(projection[0].scope, wire[0].value);
  assert.equal(projection[1].instance, "root");
  assert.equal(projection[1].type, "assistant");
  assert.doesNotMatch(JSON.stringify(projection), /PRIVATE_PROMPT/);
});

test("preparation pins isolated worker homes and matching native-policy and provider selections", async (t) => {
  const root = await temporaryRoot(t);
  const agent = path.join(root, "root-agent");
  const home = path.join(root, "home");
  await fs.mkdir(agent);
  const tap = path.join(root, "connector-tap");
  await fs.writeFile(tap, "#!/bin/sh\nexit 0\n");
  const config = {
    state: path.join(root, "state"),
    workerModelPort: 12345,
    env: {
      HOME: home,
      BRUV_CLAUDE_COMPAT_HOME: agent,
      CLAUDE_CONFIG_DIR: path.join(agent, "history"),
      BRUV_ACCEPTANCE_CONFIG: path.join(root, "config.json"),
    },
  };
  const base = path.join(root, "t3-runtime/t3-base");
  await prepare({ base, fixture: tap, config });
  const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
  const normal = path.join(root, "normal-agent");
  assert.deepEqual(await read(path.join(normal, "models.json")), workerModels(12345));
  assert.deepEqual(await read(path.join(home, ".bruv/subagents.json")), {
    normal: { model: workerSlug, thinking: "high" },
  });
  const policy = await read(path.join(agent, "native-app-worker.json"));
  assert.deepEqual(policy, {
    role: "orchestrator",
    depth: 0,
    worker: {
      type: "normal",
      thinking: "high",
      target: { providerInstanceId: workerInstance, model: workerSlug, options: [{ id: "effort", value: "high" }] },
      runtimeMode: "full-access",
      interactionMode: "default",
    },
  });
  assert.deepEqual(await read(path.join(normal, "native-app-worker.json")), { role: "normal", depth: 1 });
  assert.deepEqual(config.workerEnv, {
    BRUV_CLAUDE_COMPAT_HOME: normal,
    BRUV_CODING_AGENT_DIR: normal,
    CLAUDE_CONFIG_DIR: path.join(normal, "native-history"),
    BRUV_SUBAGENT_TYPE: "normal",
    BRUV_SUBAGENT_DEPTH: "1",
  });
  assert.deepEqual(await read(config.env.BRUV_ACCEPTANCE_CONFIG), config);
  assert.equal((await fs.stat(config.env.BRUV_ACCEPTANCE_CONFIG)).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(config.workerTap, "utf8"), await fs.readFile(tap, "utf8"));
  assert.equal((await fs.stat(config.workerTap)).mode & 0o777, 0o755);
  const providers = (await read(path.join(base, "userdata/settings.json"))).providerInstances;
  assert.equal(providers.claudeAgent.config.binaryPath, tap);
  assert.equal(providers.claudeAgent.config.homePath, config.env.CLAUDE_CONFIG_DIR);
  assert.equal(providers[workerInstance].config.binaryPath, config.workerTap);
  assert.equal(providers[workerInstance].config.homePath, config.workerEnv.CLAUDE_CONFIG_DIR);
  assert.equal(providers[workerInstance].config.customModels[0].slug, workerSlug);
  assert.equal(providers[workerInstance].config.customModels[0].capabilities.optionDescriptors[0].currentValue, "high");
});
