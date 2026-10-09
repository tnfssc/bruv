import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect } from "./history-driver.mjs";
import { startHistoryModel, verifyHistoryModelRecords } from "./history-model.mjs";
import { modelSlug, modelsConfig } from "./model.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const connector = process.env.BRUV_CONNECTOR_EXECUTABLE;
if (!connector)
  throw Error("Set BRUV_CONNECTOR_EXECUTABLE to the actual built connector. Synthetic fixture is prohibited.");
await fs.access(connector, fs.constants.X_OK);
const normalBinary = path.resolve(
  process.env.BRUV_RUNTIME_BINARY ?? fileURLToPath(new URL("../../dist/bruv", import.meta.url)),
);
await fs.access(normalBinary, fs.constants.X_OK);
const proof = path.resolve(process.env.PROOF_OUTPUT ?? `.cache/claude-history-proof-${Date.now()}`);
await fs.mkdir(path.dirname(proof), { recursive: true });
await fs.mkdir(proof);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bruv-native-acceptance-"));
const state = path.join(root, "state"),
  agent = path.join(root, "agent"),
  home = path.join(root, "home");
// One config serves the tap, replay and final disk collection, including setup failures.
const config = {
  connector: path.join(root, "actual-connector"),
  tap: path.join(root, "connector-tap"),
  wire: path.join(root, "wire.ndjson"),
  state,
  proof,
  modelSlug,
  env: {
    HOME: home,
    BRUV_CODING_AGENT_DIR: agent,
    BRUV_CLAUDE_COMPAT_HOME: agent,
    CLAUDE_CONFIG_DIR: path.join(agent, "native-history"),
    BRUV_CLAUDE_COMPAT_BRUV_PATH: normalBinary,
    BRUV_ACCEPTANCE_CONFIG: path.join(root, "config.json"),
  },
};
let model,
  passed = false;
try {
  await prepareScopedReplay(config, connector);
  model = await startHistoryModel({ counter: path.join(state, "root-tool-count") });
  await fs.writeFile(path.join(agent, "models.json"), JSON.stringify(modelsConfig(model.port)));
  config.connectorArgs = JSON.parse(process.env.BRUV_CONNECTOR_ARGS_JSON ?? "[]");
  await fs.writeFile(config.env.BRUV_ACCEPTANCE_CONFIG, JSON.stringify(config), { mode: 0o600 });
  await runReplay(config);
  const modelChecks = verifyHistoryModelRecords(model.records);
  await fs.writeFile(path.join(proof, "model-checks.json"), `${JSON.stringify(modelChecks, null, 2)}\n`);
  if ((await fs.readFile(path.join(state, "root-tool-count"), "utf8")).trim().split("\n").length !== 1)
    throw Error("Stored root tool reexecuted");
  passed = true;
} finally {
  // Proof reads the scoped state before deletion. A proof failure must still release it.
  try {
    await retainHistoryProof(config, model?.records, passed);
  } finally {
    try {
      await model?.close();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
    await fs.writeFile(
      path.join(proof, "cleanup.json"),
      `${JSON.stringify({
        temporaryScopedStateRemoved: true,
        realCredentialsUsed: false,
        integratedReplayPassed: passed,
      })}\n`,
    );
  }
}
console.log(`Integrated native acceptance proof: ${proof}`);

async function prepareScopedReplay(config, connector) {
  const root = path.dirname(config.state);
  await fs.chmod(root, 0o700);
  for (const dir of [config.state, config.env.BRUV_CODING_AGENT_DIR, config.env.HOME]) await fs.mkdir(dir);
  // Pin the actual artifact, not a synthetic executable, while sibling builds continue.
  await fs.copyFile(connector, config.connector);
  await fs.chmod(config.connector, 0o755);
  await fs.copyFile(path.join(here, "tap.mjs"), config.tap);
  await fs.chmod(config.tap, 0o755);
  const normalBinary = config.env.BRUV_CLAUDE_COMPAT_BRUV_PATH;
  await fs.writeFile(
    path.join(config.proof, "invocation.json"),
    `${JSON.stringify(
      {
        connector: path.basename(connector),
        connectorSha256: createHash("sha256")
          .update(await fs.readFile(config.connector))
          .digest("hex"),
        normalRuntime: path.basename(normalBinary),
        normalRuntimeSha256: createHash("sha256")
          .update(await fs.readFile(normalBinary))
          .digest("hex"),
        testModel: modelSlug,
        credentialEnvironment: "explicit allowlist; no parent environment",
      },
      null,
      2,
    )}\n`,
  );
}

async function runReplay(config) {
  // No real auth file and no parent credentials/environment are inherited by T3.
  const env = {
    PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    HOME: config.env.HOME,
    TMPDIR: path.dirname(config.state),
    BRUV_ACCEPTANCE_CONFIG: config.env.BRUV_ACCEPTANCE_CONFIG,
    PROOF_OUTPUT: config.proof,
  };
  for (const key of ["T3_UPSTREAM", "T3_EXPECTED_SHA256", "BROWSER_PATH", "FIXTURE_PORT"])
    if (process.env[key]) env[key] = process.env[key];
  const child = spawn(process.execPath, [path.join(here, "history-replay.mjs")], { env, stdio: "inherit" });
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0) throw Error(`Integrated native replay failed with exit ${code}`);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await closed;
  }
}

async function retainHistoryProof(config, records, passed) {
  const proof = config.proof;
  await collect(config, proof).catch((e) => console.error("Evidence collection:", e.message));
  let result = { integratedAcceptance: true, historyAcceptance: true };
  try {
    result = JSON.parse(await fs.readFile(path.join(proof, "result.json"), "utf8"));
  } catch {}
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify({ ...result, passed, historyAcceptance: true, modelRequestCount: records?.length ?? 0 }, null, 2) +
      "\n",
  );
  try {
    const { projectWire } = await import("./driver.mjs");
    const wire = (await fs.readFile(config.wire, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    await fs.writeFile(
      path.join(proof, "wire-projection.ndjson"),
      `${projectWire(wire)
        .map((x) => JSON.stringify(x))
        .join("\n")}\n`,
    );
  } catch {}
  if (records) {
    await fs.writeFile(
      path.join(proof, "model-projection.json"),
      `${JSON.stringify(
        records.map((r) => ({
          sequence: r.sequence,
          model: r.model,
          error: r.error,
          tool: r.delta?.tool_calls?.[0]?.function?.name,
          messages: r.messages?.map((m) => ({
            role: m.role,
            toolCallId: m.tool_call_id,
            contentMarkers: JSON.stringify(m.content).match(/HISTORY_[A-Z_]+|orchid-73/g),
            toolCalls: m.tool_calls?.map((c) => ({ id: c.id, name: c.function?.name })),
            ...(m.role === "tool"
              ? { output: JSON.stringify(m.content).replaceAll(path.dirname(config.state), "<SCOPED>") }
              : {}),
          })),
          contextMarkers: JSON.stringify(r.messages).match(/HISTORY_[A-Z_]+|orchid-73/g),
          response: r.delta?.content,
        })),
        null,
        2,
      )}\n`,
    );
  }
}
