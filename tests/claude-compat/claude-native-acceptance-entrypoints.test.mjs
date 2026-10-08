import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runAcceptance } from "../../scripts/claude-native-acceptance/run.mjs";
import { runSubagentAcceptance } from "../../scripts/claude-native-acceptance/run-subagent.mjs";

// Importing the actual entrypoints must not launch a proof or require artifact env.
test("acceptance entrypoints are callable without import-time execution", () => {
  assert.equal(typeof runAcceptance, "function");
  assert.equal(typeof runSubagentAcceptance, "function");
});

const completedRecords = [
  ...Array.from({ length: 3 }, () => ({ delta: { tool_calls: [{ function: { arguments: "subagent({" } }] } })),
  ...["ROOT_COMPLETION_ONCE_REAL", "ROOT_KILLED_COMPLETION_REAL", "ROOT_AFTER_CHILD_REAL"].map((content) => ({
    delta: { content },
  })),
];

// Owned offline stand-ins exercise the shared runner's verification and cleanup, not native acceptance.
async function runOwnedScenario(scenario, records) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "native-entrypoint-test-"));
  try {
    const here = path.join(fixture, "scripts/claude-native-acceptance");
    const replayDir = path.join(fixture, "wisdom/claude-compat/proof/native-ui-fixture");
    await fs.mkdir(here, { recursive: true });
    await fs.mkdir(replayDir, { recursive: true });
    for (const file of ["run-subagent.mjs", "tap.mjs"]) {
      await fs.copyFile(
        new URL("../../scripts/claude-native-acceptance/" + file, import.meta.url),
        path.join(here, file),
      );
    }
    await fs.writeFile(
      path.join(here, "subagent-model.mjs"),
      `
export const modelSlug="owned/local", provider="owned", modelId="local";
export const modelsConfig=()=>({});
export const startModel=async()=>({port:12345,records:JSON.parse(process.env.TEST_RECORDS),close:async()=>{}});
`,
    );
    await fs.writeFile(
      path.join(replayDir, "replay.mjs"),
      `
import fs from "node:fs/promises"; import path from "node:path";
const config=JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG,"utf8"));
await fs.mkdir(path.join(config.env.BRUV_CODING_AGENT_DIR,"native-history"));
await fs.writeFile(path.join(config.proof,"result.json"),JSON.stringify({passed:true}));
await fs.writeFile(path.join(config.proof,"replay-observation.json"),JSON.stringify(config));
`,
    );
    const executable = path.join(fixture, "owned-executable");
    await fs.writeFile(executable, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const proof = path.join(fixture, "proof");
    const driverPath = path.join(fixture, "selected-real-driver.mjs");
    const invocation =
      "const {runSubagentAcceptance}=await import(" +
      JSON.stringify(pathToFileURL(path.join(here, "run-subagent.mjs")).href) +
      "); await runSubagentAcceptance(" +
      JSON.stringify({ scenario, driverPath }) +
      ");";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", invocation], {
      env: {
        PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
        HOME: fixture,
        TMPDIR: fixture,
        BRUV_CONNECTOR_EXECUTABLE: executable,
        BRUV_RUNTIME_BINARY: executable,
        PROOF_OUTPUT: proof,
        TEST_RECORDS: JSON.stringify(records),
      },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.error, undefined);
    const retained = JSON.parse(await fs.readFile(path.join(proof, "result.json"), "utf8"));
    const cleanup = JSON.parse(await fs.readFile(path.join(proof, "cleanup.json"), "utf8"));
    const config = JSON.parse(await fs.readFile(path.join(proof, "replay-observation.json"), "utf8"));
    assert.equal(config.replayDriver, pathToFileURL(driverPath).href);
    assert.equal(
      await fs.access(path.dirname(config.state)).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.equal(cleanup.integratedReplayPassed, retained.passed);
    return { result, retained };
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

test("command scenario requires no model calls", async () => {
  const { result, retained } = await runOwnedScenario("command", []);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(retained.passed, true);
});

test("command scenario rejects even one model call and preserves failed proof", async () => {
  const { result, retained } = await runOwnedScenario("command", [{ delta: { content: "unexpected" } }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected model call in command-only proof/);
  assert.equal(retained.passed, false);
});

test("subagent scenario retains exact model-delivery checks", async () => {
  const { result, retained } = await runOwnedScenario("subagent", []);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected exactly one actual worker completion wake/);
  assert.equal(retained.passed, false);
});

test("subagent scenario still requires actual native child histories", async () => {
  const { result, retained } = await runOwnedScenario("subagent", completedRecords);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected three actual native child histories, got 0/);
  assert.equal(retained.passed, false);
});

test("subagent scenario rejects duplicate completion wakes", async () => {
  const { result, retained } = await runOwnedScenario("subagent", [...completedRecords, completedRecords[3]]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected exactly one actual worker completion wake/);
  assert.equal(retained.passed, false);
});
