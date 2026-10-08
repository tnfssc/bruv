import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const runner = new URL("../../scripts/claude-native-acceptance/history-run.mjs", import.meta.url);

// Offline replay child: real process/config boundary, fabricated replay evidence.
const successfulReplay = String.raw`
import fs from "node:fs/promises";
import path from "node:path";
const config = JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
await fs.writeFile(path.join(config.proof, "replay-observation.json"), JSON.stringify({env: process.env, config,
  connectorBytes: await fs.readFile(config.connector, "utf8"),
  mode: (await fs.stat(process.env.BRUV_ACCEPTANCE_CONFIG)).mode & 0o777}));
await fs.writeFile(config.wire, JSON.stringify({kind: "stdout", value: {private: "PRIVATE_WIRE"}}) + "\n");
await fs.writeFile(path.join(config.state, "root-tool-count"), "one\n");
await fs.writeFile(path.join(config.proof, "result.json"), JSON.stringify({replayField: "retained"}));
`;

// Execute the shipped runner with stub replay, model and collection; the shipped tap is only copied.
// Real processes, sockets and files prove runner ownership, not native history acceptance.
async function runFixture({ replay = successfulReplay, connectorArgs = '["--owned-arg"]' } = {}) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "history-runner-test-"));
  const scripts = path.join(fixture, "scripts");
  const observations = path.join(fixture, "observations");
  const proof = path.join(fixture, "proof");
  let scopedRoot, child;
  try {
    await fs.mkdir(scripts);
    await fs.mkdir(observations);
    await fs.copyFile(runner, path.join(scripts, "history-run.mjs"));
    await fs.copyFile(
      new URL("../../scripts/claude-native-acceptance/tap.mjs", import.meta.url),
      path.join(scripts, "tap.mjs"),
    );
    const artifact = path.join(fixture, "owned-artifact");
    const binaryBytes = "#!/bin/sh\nexit 0\n";
    await fs.writeFile(artifact, binaryBytes, { mode: 0o755 });
    await fs.writeFile(
      path.join(scripts, "model.mjs"),
      String.raw`
export const modelSlug = "offline-fixture/local";
export const modelsConfig = port => ({ fixturePort: port });
`,
    );
    await fs.writeFile(
      path.join(scripts, "history-model.mjs"),
      String.raw`
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
const out = process.env.TEST_OBSERVATIONS;
export async function startHistoryModel({counter}) {
  const root = path.dirname(path.dirname(counter));
  await fs.writeFile(path.join(out, "root"), root);
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    records: [{ sequence: 1, model: "offline-fixture", delta: {content: "HISTORY_CHECKPOINT: orchid-73"},
      messages: [{role: "tool", tool_call_id: "owned-tool", content: "HISTORY_ROOT_AUTHORITY orchid-73 " + root + "/owned"},
        {role: "user", content: "PRIVATE_PROMPT"}]}],
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      await fs.access(path.dirname(counter));
      await fs.writeFile(path.join(out, "closed.json"), JSON.stringify({scopedStateExists: true}));
      await fs.appendFile(path.join(out, "events"), "close\n");
    }
  };
}
export function verifyHistoryModelRecords(records) {
  return { fixtureRequestCount: records.length };
}
`,
    );
    await fs.writeFile(
      path.join(scripts, "history-driver.mjs"),
      String.raw`
import fs from "node:fs/promises";
import path from "node:path";
export async function collect(config, proof) {
  await fs.access(config.state);
  await fs.appendFile(path.join(process.env.TEST_OBSERVATIONS, "events"), "collect\n");
  await fs.writeFile(path.join(proof, "collected.json"), JSON.stringify({scopedStateExists: true}));
}
`,
    );
    await fs.writeFile(
      path.join(scripts, "driver.mjs"),
      "export const projectWire = wire => wire.map(e => ({ kind: e.kind }));",
    );
    await fs.writeFile(path.join(scripts, "history-replay.mjs"), replay);
    let output = "",
      timedOut = false;
    child = spawn(process.execPath, [path.join(scripts, "history-run.mjs")], {
      cwd: fixture,
      env: {
        PATH: process.env.PATH,
        BRUV_CONNECTOR_EXECUTABLE: artifact,
        BRUV_RUNTIME_BINARY: artifact,
        BRUV_CONNECTOR_ARGS_JSON: connectorArgs,
        PROOF_OUTPUT: proof,
        TEST_OBSERVATIONS: observations,
        ANTHROPIC_API_KEY: "PARENT_SECRET",
        OPENAI_API_KEY: "PARENT_SECRET",
        BRUV_CODING_AGENT_DIR: "/parent/private-agent",
        CLAUDE_CONFIG_DIR: "/parent/private-claude",
        T3_UPSTREAM: "owned-upstream",
        T3_EXPECTED_SHA256: "owned-hash",
        BROWSER_PATH: "owned-browser",
        FIXTURE_PORT: "12345",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 2000);
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    scopedRoot = await fs.readFile(path.join(observations, "root"), "utf8");
    const readJSON = (file) =>
      fs
        .readFile(path.join(proof, file), "utf8")
        .then(JSON.parse)
        .catch(() => undefined);
    // Capture before fixture disposal; harness cleanup must never count as runner cleanup.
    return {
      code,
      output,
      timedOut,
      rootExists: await fs.access(scopedRoot).then(
        () => true,
        () => false,
      ),
      events: (await fs.readFile(path.join(observations, "events"), "utf8")).trim().split("\n"),
      closed: await fs
        .readFile(path.join(observations, "closed.json"), "utf8")
        .then(JSON.parse)
        .catch((error) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        }),
      observation: await readJSON("replay-observation.json"),
      result: await readJSON("result.json"),
      cleanup: await readJSON("cleanup.json"),
      invocation: await readJSON("invocation.json"),
      modelChecks: await readJSON("model-checks.json"),
      projection: await readJSON("model-projection.json"),
      collected: await readJSON("collected.json"),
      wire: await fs.readFile(path.join(proof, "wire-projection.ndjson"), "utf8").catch(() => undefined),
      artifactUnchanged: (await fs.readFile(artifact, "utf8")) === binaryBytes,
      expectedHash: createHash("sha256").update(binaryBytes).digest("hex"),
    };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (scopedRoot) await fs.rm(scopedRoot, { recursive: true, force: true });
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

test("history runner pins inputs, isolates replay credentials and retains history projections before deletion", async () => {
  const r = await runFixture();
  assert.equal(r.code, 0, r.output);
  assert.equal(r.timedOut, false);
  assert.equal(r.rootExists, false);
  assert.deepEqual(r.events, ["collect", "close"]);
  assert.deepEqual(r.closed, { scopedStateExists: true });
  assert.deepEqual(r.cleanup, {
    temporaryScopedStateRemoved: true,
    realCredentialsUsed: false,
    integratedReplayPassed: true,
  });
  assert.equal(r.result.passed, true);
  assert.equal(r.result.historyAcceptance, true);
  assert.equal(r.result.modelRequestCount, 1);
  assert.deepEqual(r.modelChecks, { fixtureRequestCount: 1 });
  assert.equal(r.result.replayField, "retained");
  assert.equal(r.artifactUnchanged, true);
  assert.equal(r.invocation.connectorSha256, r.expectedHash);
  assert.equal(r.invocation.normalRuntimeSha256, r.expectedHash);
  assert.equal(r.collected.scopedStateExists, true);
  assert.equal(r.wire, '{"kind":"stdout"}\n');
  assert.deepEqual(r.projection[0].messages[0], {
    role: "tool",
    toolCallId: "owned-tool",
    contentMarkers: ["HISTORY_ROOT_AUTHORITY", "orchid-73"],
    output: '"HISTORY_ROOT_AUTHORITY orchid-73 <SCOPED>/owned"',
  });
  assert.equal(JSON.stringify(r.projection).includes("PRIVATE_PROMPT"), false);
  const { env, config, connectorBytes, mode } = r.observation;
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.TEST_OBSERVATIONS, undefined);
  assert.equal(env.BRUV_CODING_AGENT_DIR, undefined);
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.T3_UPSTREAM, "owned-upstream");
  assert.equal(env.T3_EXPECTED_SHA256, "owned-hash");
  assert.equal(env.BROWSER_PATH, "owned-browser");
  assert.equal(env.FIXTURE_PORT, "12345");
  assert.equal(env.TMPDIR, path.dirname(config.state));
  assert.equal(env.HOME, config.env.HOME);
  assert.equal(config.env.BRUV_CLAUDE_COMPAT_HOME, config.env.BRUV_CODING_AGENT_DIR);
  assert.equal(config.env.CLAUDE_CONFIG_DIR, path.join(config.env.BRUV_CODING_AGENT_DIR, "native-history"));
  assert.deepEqual(config.connectorArgs, ["--owned-arg"]);
  assert.equal(connectorBytes, "#!/bin/sh\nexit 0\n");
  assert.equal(mode, 0o600);
});

test("failed replay keeps child failure proof but cannot pass model checks", async () => {
  const r = await runFixture({
    replay:
      successfulReplay +
      `
await fs.writeFile(path.join(config.proof, "result.json"), JSON.stringify({replayField: "retained", error: "owned replay failure"}));
process.exitCode = 7;
`,
  });
  assert.notEqual(r.code, 0);
  assert.match(r.output, /Integrated native replay failed with exit 7/);
  assert.equal(r.timedOut, false);
  assert.equal(r.rootExists, false);
  assert.deepEqual(r.events, ["collect", "close"]);
  assert.deepEqual(r.closed, { scopedStateExists: true });
  assert.equal(r.result.error, "owned replay failure");
  assert.equal(r.result.replayField, "retained");
  assert.equal(r.modelChecks, undefined);
  assert.equal(r.result.passed, false);
  assert.equal(r.collected.scopedStateExists, true);
  assert.equal(r.cleanup.integratedReplayPassed, false);
});

test("stored root tool reexecution still fails after model verification and retains proof", async () => {
  const r = await runFixture({
    replay:
      successfulReplay +
      String.raw`
await fs.writeFile(path.join(config.state, "root-tool-count"), "one\ntwo\n");
`,
  });
  assert.notEqual(r.code, 0);
  assert.match(r.output, /Stored root tool reexecuted/);
  assert.equal(r.timedOut, false, r.output);
  assert.deepEqual(r.modelChecks, { fixtureRequestCount: 1 });
  assert.equal(r.collected.scopedStateExists, true);
  assert.deepEqual(r.events, ["collect", "close"]);
  assert.deepEqual(r.closed, { scopedStateExists: true });
  assert.equal(r.result.passed, false);
  assert.equal(r.rootExists, false);
  assert.equal(r.cleanup.integratedReplayPassed, false);
});

test("model projection write failure still closes the model and deletes scoped state", async () => {
  const r = await runFixture({
    replay:
      successfulReplay +
      `
await fs.mkdir(path.join(config.proof, "model-projection.json"));
`,
  });
  assert.notEqual(r.code, 0);
  assert.equal(r.timedOut, false, r.output);
  assert.equal(r.rootExists, false);
  assert.deepEqual(r.events, ["collect", "close"]);
  assert.deepEqual(r.closed, { scopedStateExists: true });
  assert.equal(r.collected.scopedStateExists, true);
  assert.equal(r.cleanup.temporaryScopedStateRemoved, true);
  assert.match(r.output, /EISDIR/);
  assert.deepEqual(r.modelChecks, { fixtureRequestCount: 1 });
  // Replay/model checks passed; only proof publication failed.
  assert.equal(r.result.passed, true);
  assert.equal(r.cleanup.integratedReplayPassed, true);
});

test("configuration parse failure releases an already-open model without launching replay", async () => {
  const r = await runFixture({ connectorArgs: "{" });
  assert.notEqual(r.code, 0);
  assert.equal(r.timedOut, false);
  assert.equal(r.observation, undefined);
  assert.match(r.output, /JSON|SyntaxError/);
  assert.equal(r.collected.scopedStateExists, true);
  assert.equal(r.rootExists, false);
  assert.deepEqual(r.events, ["collect", "close"]);
  assert.deepEqual(r.closed, { scopedStateExists: true });
  assert.equal(r.result.passed, false);
  assert.equal(r.modelChecks, undefined);
  assert.equal(r.cleanup.integratedReplayPassed, false);
});
