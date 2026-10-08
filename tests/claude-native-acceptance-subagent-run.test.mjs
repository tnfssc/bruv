import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../scripts/claude-native-acceptance/run-subagent.mjs", import.meta.url));

// Run the entire shipped runner/generator/driver/collector. The browser and executables
// are owned stand-ins: these checks prove offline scope/finalization, not native acceptance.
for (const corruptResult of [false, true]) {
  test(
    corruptResult
      ? "proof-write failure still closes the model and removes private state"
      : "failed replay retains final provider proof before releasing the runner scope",
    async () => {
      const { result, proof } = await runFailedReplay(corruptResult);
      assert.equal(result.error, undefined, result.stderr);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, corruptResult ? /EISDIR/ : /owned browser setup failure/);
      await assertRunnerFinalization(proof);
      if (!corruptResult) await assertRetainedReplayProof(proof);
    },
  );
}

async function runFailedReplay(corruptResult) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-runner-test-"));
  const proof = path.join(fixture, "proof");
  try {
    const home = await fs.mkdtemp(path.join(fixture, "home-"));
    const config = await fs.mkdtemp(path.join(fixture, "config-"));
    const temporary = await fs.mkdtemp(path.join(fixture, "tmp-"));
    const connector = path.join(fixture, "owned-connector");
    const runtime = path.join(fixture, "owned-runtime");
    const upstream = path.join(fixture, "upstream");
    await fs.writeFile(connector, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await fs.writeFile(runtime, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await installHealthServer(path.join(upstream, "platform/t3"), fixture);
    await installFailingBrowser(path.join(upstream, "runtime/node_modules/playwright/index.mjs"), corruptResult);
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const result = spawnSync(process.execPath, [runner], {
      env: {
        PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
        HOME: home,
        TMPDIR: temporary,
        BRUV_CONNECTOR_EXECUTABLE: connector,
        BRUV_RUNTIME_BINARY: runtime,
        T3_UPSTREAM: upstream,
        BROWSER_PATH: "owned-browser",
        FIXTURE_PORT: String(port),
        PROOF_OUTPUT: proof,
        ANTHROPIC_API_KEY: "must-not-be-inherited",
        OPENAI_API_KEY: "must-not-be-inherited",
        CLAUDE_CONFIG_DIR: config,
      },
      encoding: "utf8",
      timeout: 10000,
    });
    return { result, proof };
  } finally {
    // Stop only our stand-in server, including when the runner fails to stop it.
    // Retain fixture files/HOME/config for inspection; never delete a child-reported path.
    try {
      process.kill(Number(await fs.readFile(path.join(fixture, "server.pid"), "utf8")), "SIGTERM");
    } catch (error) {
      assert.ok(["ENOENT", "ESRCH"].includes(error.code), String(error));
    }
  }
}

async function assertRunnerFinalization(proof) {
  const observation = JSON.parse(await fs.readFile(path.join(proof, "browser-close.json"), "utf8"));
  assert.equal(observation.finalEvidencePresent, true);
  assert.equal(observation.privateStatePresent, true);
  assert.equal(observation.credentialsInherited, false);
  const evidence = JSON.parse(await fs.readFile(path.join(proof, "final-provider-evidence.json"), "utf8"));
  assert.deepEqual(evidence.provider[0].markers, ["ROOT_AFTER_CHILD_REAL"]);
  assert.ok(!JSON.stringify(evidence).includes("PRIVATE_PROMPT"));
  assert.equal(
    await fs.access(observation.scope).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(proof, "cleanup.json"), "utf8")), {
    temporaryScopedStateRemoved: true,
    realCredentialsUsed: false,
    integratedReplayPassed: false,
  });
  // Bun and Node expose the same refusal through different structured error fields.
  await assert.rejects(
    fetch(observation.modelUrl),
    (error) => error.code === "ConnectionRefused" || error.cause?.code === "ECONNREFUSED",
  );
}

async function assertRetainedReplayProof(proof) {
  const retained = JSON.parse(await fs.readFile(path.join(proof, "result.json"), "utf8"));
  assert.equal(retained.passed, false);
  assert.equal(retained.error, "owned browser setup failure");
  assert.equal(retained.modelCompletionWakeCount, 0);
  assert.equal(retained.killedJobCompletionWakeCount, 0);
  const model = JSON.parse(await fs.readFile(path.join(proof, "model-projection.json"), "utf8"));
  assert.equal(model[0].response, "ROOT_AFTER_CHILD_REAL");
  assert.ok(!JSON.stringify(model).includes("PRIVATE_PROMPT"));
  const profiles = JSON.parse(await fs.readFile(path.join(proof, "profiles.json"), "utf8"));
  assert.deepEqual(Object.keys(profiles), ["fast", "normal", "orchestrator"]);
  assert.equal(new Set(Object.values(profiles).map((profile) => profile.model)).size, 1);
  assert.ok(Object.values(profiles).every((profile) => profile.thinking === "off"));
}

async function installHealthServer(binary, fixture) {
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.writeFile(
    binary,
    `#!${process.execPath}
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
if (process.argv.includes("--version")) console.log("owned-t3-fixture");
else {
  const config = JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
  await fs.writeFile(${JSON.stringify(path.join(fixture, "server.pid"))}, String(process.pid));
  await fs.writeFile(config.wire, JSON.stringify({ kind: "lifecycle", value: { event: "exit", pid: 123 } }) + "\\n");
  const base = process.argv[process.argv.indexOf("--base-dir") + 1];
  const logs = path.join(base, "logs/provider");
  await fs.mkdir(logs, { recursive: true });
  await fs.writeFile(path.join(logs, "owned.log"), JSON.stringify({ event: { direction: "out", payload: { type: "assistant", text: "ROOT_AFTER_CHILD_REAL PRIVATE_PROMPT" } } }) + "\\n");
  const models = JSON.parse(await fs.readFile(path.join(config.env.BRUV_CODING_AGENT_DIR, "models.json"), "utf8"));
  const provider = Object.values(models.providers)[0];
  const response = await fetch(provider.baseUrl + "/chat/completions", { method: "POST", body: JSON.stringify({ model: provider.models[0].id, messages: [{ role: "user", content: "ACCEPT_LOCAL_AFTER_CHILD PRIVATE_PROMPT" }] }) });
  await response.text();
  const server = createServer((_, res) => res.end("ok"));
  server.listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
`,
    { mode: 0o755 },
  );
}

async function installFailingBrowser(browserModule, corruptResult) {
  await fs.mkdir(path.dirname(browserModule), { recursive: true });
  await fs.writeFile(
    browserModule,
    `import fs from "node:fs/promises";
import path from "node:path";
export const chromium = { launch: async () => ({
  newContext: async () => { throw Error("owned browser setup failure"); },
  close: async () => {
    const config = JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
    const models = JSON.parse(await fs.readFile(path.join(config.env.BRUV_CODING_AGENT_DIR, "models.json"), "utf8"));
    const finalEvidencePresent = await fs.access(path.join(config.proof, "final-provider-evidence.json")).then(() => true, () => false);
    const privateStatePresent = await fs.access(path.join(path.dirname(config.state), "t3-runtime")).then(() => true, () => false);
    const credentialsInherited = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.CLAUDE_CONFIG_DIR);
    await fs.writeFile(path.join(config.proof, "browser-close.json"), JSON.stringify({ finalEvidencePresent, privateStatePresent, credentialsInherited, scope: path.dirname(config.state), modelUrl: Object.values(models.providers)[0].baseUrl }));
    if (${corruptResult}) {
      await fs.rm(path.join(config.proof, "result.json"));
      await fs.mkdir(path.join(config.proof, "result.json"));
    }
  },
}) };
`,
  );
}
