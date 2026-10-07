import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

// Offline orchestrator proof only: these owned stand-ins never prove native acceptance.
const runner =
  process.env.BRUV_ACCEPTANCE_RUNNER_UNDER_TEST ??
  new URL("../scripts/claude-native-acceptance/run.mjs", import.meta.url);
const responses = [
  "TASK_COMPLETED_REAL",
  "CANCELLATION_COMPLETED_REAL",
  "APP_COMPLETION_ACK_REAL",
  "HUMAN_ANSWER_DELIVERED_ONCE_REAL",
];
const records = responses.map((content, sequence) => ({
  sequence,
  model: "offline-fixture",
  delta: { content },
  messages: [{ role: "user", content: "PRIVATE_PROMPT" }],
  authorization: "PRIVATE_CREDENTIAL",
}));

async function runFixture({
  failure,
  app = false,
  human = false,
  modelRecords = records,
  connectorArgs = "[]",
  workers = false,
} = {}) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "bruv-runner-test-"));
  const scripts = path.join(fixture, "scripts/claude-native-acceptance");
  const replayDir = path.join(fixture, "wisdom/claude-compat/proof/native-ui-fixture");
  const proof = path.join(fixture, "proof");
  const observations = path.join(fixture, "observations");
  let child, scopedRoot, unrelated, workerPid;
  try {
    await fs.mkdir(scripts, { recursive: true });
    await fs.mkdir(replayDir, { recursive: true });
    await fs.mkdir(observations);
    await fs.copyFile(runner, path.join(scripts, "run.mjs"));
    for (const file of ["worker.mjs", "tap.mjs"])
      await fs.copyFile(
        new URL("../scripts/claude-native-acceptance/" + file, import.meta.url),
        path.join(scripts, file),
      );
    const artifact = path.join(fixture, "owned-artifact");
    await fs.writeFile(artifact, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await fs.writeFile(
      path.join(scripts, "model.mjs"),
      [
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'import { createServer } from "node:http";',
        'export const modelSlug = "offline-fixture/local", provider = "offline-fixture", modelId = "local";',
        "export const modelsConfig = (port) => ({ port });",
        "export async function openModel(state, name) {",
        "  const out = process.env.TEST_OBSERVATIONS;",
        '  await fs.writeFile(path.join(out, "root"), path.dirname(state));',
        "  const server = createServer();",
        '  await new Promise(r => server.listen(0, "127.0.0.1", r));',
        "  return { port: server.address().port, records: JSON.parse(process.env.TEST_RECORDS),",
        "    close: async () => {",
        "      await new Promise(r => server.close(r));",
        '      await fs.appendFile(path.join(out, "closed"), name + "\\n");',
        "    }",
        "  };",
        "}",
        'export const startModel = ({state}) => openModel(state, "root-model");',
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(scripts, "app-delegation-model.mjs"),
      [
        'import { openModel } from "./model.mjs";',
        "export const reply = () => {};",
        'export const startWorkerModel = ({state}) => openModel(state, "worker-model");',
      ].join("\n"),
    );
    for (const file of ["driver.mjs", "app-delegation-driver.mjs"])
      await fs.writeFile(path.join(scripts, file), "export const projectWire = () => [{ safeWire: true }];");
    await fs.writeFile(
      path.join(scripts, "human-driver.mjs"),
      [
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'export const capture = ({proof}) => fs.writeFile(path.join(proof, "human-capture.json"), "{}");',
      ].join("\n"),
    );
    if (workers) unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await fs.writeFile(
      path.join(replayDir, "replay.mjs"),
      [
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        'const config = JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));',
        ...(workers
          ? [
              'const { spawn } = await import("node:child_process");',
              'const worker = spawn(process.execPath, [path.join(path.dirname(config.state), "worker.mjs"), config.state, "stop"], { stdio: "ignore" });',
              "worker.unref();",
              'await fs.writeFile(path.join(config.proof, "worker-pid.json"), String(worker.pid));',
              'while (true) { try { await fs.access(path.join(config.state, "stop.started")); break; } catch {} await new Promise(r => setTimeout(r, 10)); }',
              'await fs.writeFile(path.join(config.state, "early.started"), ' +
                JSON.stringify(String(unrelated.pid)) +
                ");",
            ]
          : []),
        'await fs.writeFile(path.join(config.proof, "replay-observation.json"), JSON.stringify({env: process.env, config}));',
        'await fs.writeFile(config.wire, JSON.stringify({ private: "PRIVATE_WIRE" }) + "\\n");',
        'if (config.delegationCases) await fs.writeFile(path.join(config.state, "capabilities.json"), "{}");',
        failure === "result"
          ? 'await fs.mkdir(path.join(config.proof, "result.json"));'
          : 'await fs.writeFile(path.join(config.proof, "result.json"), JSON.stringify({ fixtureHarness: true, preserved: "driver-result" }));',
        failure === "projection" ? 'await fs.mkdir(path.join(config.proof, "model-projection.json"));' : "",
      ].join("\n"),
    );
    child = spawn(process.execPath, [path.join(scripts, "run.mjs")], {
      cwd: fixture,
      env: {
        PATH: process.env.PATH,
        BRUV_CONNECTOR_EXECUTABLE: artifact,
        BRUV_RUNTIME_BINARY: artifact,
        BRUV_CONNECTOR_ARGS_JSON: connectorArgs,
        PROOF_OUTPUT: proof,
        ACCEPT_APP_DELEGATION: app ? "1" : "0",
        ACCEPT_HUMAN_CONTROLS: human ? "1" : "0",
        ACCEPT_SAVED_QUESTION: human ? "1" : "0",
        ACCEPT_PERMISSION: human ? "1" : "0",
        TEST_OBSERVATIONS: observations,
        TEST_RECORDS: JSON.stringify(modelRecords),
        ANTHROPIC_API_KEY: "PARENT_SECRET",
        T3_UPSTREAM: "owned-upstream",
        BROWSER_PATH: "owned-browser",
        FIXTURE_PORT: "12345",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      timedOut = false;
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 5000);
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    scopedRoot = await fs.readFile(path.join(observations, "root"), "utf8").catch(() => {
      throw Error(output);
    });
    const exists = (file) =>
      fs.access(file).then(
        () => true,
        () => false,
      );
    const readJSON = (file) =>
      fs
        .readFile(path.join(proof, file), "utf8")
        .then(JSON.parse)
        .catch(() => undefined);
    workerPid = await readJSON("worker-pid.json");
    let workerRunning;
    if (workers) {
      const running = () =>
        fs.readFile("/proc/" + workerPid + "/stat", "utf8").then(
          (stat) => !/\) Z /.test(stat),
          () => false,
        );
      for (let i = 0; i < 100 && (await running()); i++) await new Promise((r) => setTimeout(r, 10));
      workerRunning = await running();
    }
    return {
      workerRunning,
      unrelatedRunning: unrelated ? unrelated.exitCode === null : undefined,
      code,
      output,
      timedOut,
      rootRemoved: !(await exists(scopedRoot)),
      closed: await fs.readFile(path.join(observations, "closed"), "utf8").catch(() => ""),
      result: await readJSON("result.json"),
      cleanup: await readJSON("cleanup.json"),
      replay: await readJSON("replay-observation.json"),
      invocation: await readJSON("invocation.json"),
      projection: await readJSON("model-projection.json"),
      humanCapture: await exists(path.join(proof, "human-capture.json")),
      appEvidence: await exists(path.join(proof, "capabilities.json")),
      artifactHash: createHash("sha256")
        .update(await fs.readFile(artifact))
        .digest("hex"),
    };
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    if (unrelated && unrelated.exitCode === null) {
      const closed = new Promise((resolve) => unrelated.once("close", resolve));
      unrelated.kill("SIGKILL");
      await closed;
    }
    if (workerPid) {
      try {
        process.kill(workerPid, "SIGKILL");
      } catch {}
    }
    // Baseline-regression runs leave owned state behind even when the runner exits.
    if (!scopedRoot) scopedRoot = await fs.readFile(path.join(observations, "root"), "utf8").catch(() => undefined);
    if (scopedRoot) await fs.rm(scopedRoot, { recursive: true, force: true });
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

test("runner isolates replay environment, pins artifacts, merges proof and removes its runtime", async () => {
  const r = await runFixture();
  assert.equal(r.code, 0, r.output);
  assert.equal(r.timedOut, false);
  assert.equal(r.rootRemoved, true);
  assert.equal(r.closed, "root-model\n");
  assert.equal(r.result.preserved, "driver-result");
  assert.equal(r.result.passed, true);
  assert.equal(r.result.modelCompletionWakeCount, 1);
  assert.equal(r.result.cancellationCompletionWakeCount, 1);
  assert.equal(r.cleanup.integratedReplayPassed, true);
  assert.equal(r.invocation.connectorSha256, r.artifactHash);
  assert.equal(r.invocation.normalRuntimeSha256, r.artifactHash);
  assert.equal(r.replay.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(r.replay.env.TEST_RECORDS, undefined);
  assert.equal(r.replay.env.T3_UPSTREAM, "owned-upstream");
  assert.equal(r.replay.env.BROWSER_PATH, "owned-browser");
  assert.equal(r.replay.env.FIXTURE_PORT, "12345");
  assert.equal(r.replay.env.HOME, r.replay.config.env.HOME);
  assert.equal(r.replay.env.TMPDIR, r.replay.config.env.TMPDIR);
  assert.equal(r.replay.config.tap.endsWith("/connector-tap"), true);
  assert.doesNotMatch(JSON.stringify(r.projection), /PRIVATE_PROMPT|PRIVATE_CREDENTIAL/);
});

test("app and human evidence retain independent counts and both model lifetimes", async () => {
  const r = await runFixture({ app: true, human: true });
  assert.equal(r.code, 0, r.output);
  assert.equal(r.rootRemoved, true);
  assert.equal(r.closed, "root-model\nworker-model\n");
  assert.equal(r.result.appCompletionWakeCount, 1);
  assert.equal(r.result.savedAnswerContinuationCount, 1);
  assert.equal(r.humanCapture, true);
  assert.equal(r.appEvidence, true);
  assert.equal(r.projection.length, records.length * 2);
  assert.equal(r.replay.config.questionCases, true);
  assert.equal(r.replay.config.permissionCases, true);
});

for (const failure of ["result", "projection"]) {
  test(failure + " write failure still closes both local models and removes scoped state", async () => {
    const r = await runFixture({ failure, app: true });
    assert.equal(r.timedOut, false, r.output);
    assert.notEqual(r.code, 0);
    assert.match(r.output, /EISDIR/);
    assert.equal(r.closed, "root-model\nworker-model\n");
    assert.equal(r.rootRemoved, true);
    assert.equal(r.cleanup, undefined, "failed proof publication must not claim success");
  });
}

test("duplicate model continuation fails acceptance but still publishes failure and cleans up", async () => {
  const r = await runFixture({ modelRecords: [...records, records[0]] });
  assert.notEqual(r.code, 0);
  assert.match(r.output, /Expected exactly one actual model completion wake/);
  assert.equal(r.result.passed, false);
  assert.equal(r.result.modelCompletionWakeCount, 2);
  assert.equal(r.cleanup.integratedReplayPassed, false);
  assert.equal(r.closed, "root-model\n");
  assert.equal(r.rootRemoved, true);
});

test("partial startup closes already-open models even without a replay config", async () => {
  const r = await runFixture({ app: true, connectorArgs: "not-json" });
  assert.notEqual(r.code, 0);
  assert.equal(r.replay, undefined);
  assert.equal(r.result.passed, false);
  assert.equal(r.result.appCompletionWakeCount, 1);
  assert.equal(r.closed, "root-model\nworker-model\n");
  assert.equal(r.projection.length, records.length * 2);
  assert.equal(r.rootRemoved, true);
});

test("result write failure stops only the scope-owned worker", { skip: process.platform !== "linux" }, async () => {
  const r = await runFixture({ failure: "result", app: true, workers: true });
  assert.equal(r.workerRunning, false);
  assert.equal(r.unrelatedRunning, true);
  assert.equal(r.rootRemoved, true);
});
