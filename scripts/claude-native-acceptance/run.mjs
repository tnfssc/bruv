import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startModel, modelsConfig, modelSlug } from "./model.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const connector = process.env.BRUV_CONNECTOR_EXECUTABLE;
if (!connector)
  throw Error("Set BRUV_CONNECTOR_EXECUTABLE to the actual built connector. Synthetic fixture is prohibited.");
await fs.access(connector, fs.constants.X_OK);
const normalBinary = path.resolve(process.env.BRUV_RUNTIME_BINARY ?? "/home/tnfssc/Code/bruv/dist/bruv");
await fs.access(normalBinary, fs.constants.X_OK);
const proof = path.resolve(process.env.PROOF_OUTPUT ?? ".cache/claude-integrated-proof-" + Date.now());
await fs.mkdir(path.dirname(proof), { recursive: true });
await fs.mkdir(proof);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bruv-native-acceptance-"));
const state = path.join(root, "state"),
  agent = path.join(root, "agent"),
  home = path.join(root, "home");
const worker = path.join(root, "worker.mjs"),
  pinnedConnector = path.join(root, "actual-connector");
let model,
  child,
  passed = false;
try {
  await fs.chmod(root, 0o700);
  // Pin the real gated worker at a short scoped path; worktree paths can otherwise
  // exceed Bruv's bounded notification command preview before the scenario arg.
  await fs.copyFile(path.join(here, "worker.mjs"), worker);
  for (const dir of [state, agent, home]) await fs.mkdir(dir);
  // Pin the actual artifact, not a synthetic executable, while sibling builds continue.
  await fs.copyFile(connector, pinnedConnector);
  await fs.chmod(pinnedConnector, 0o755);
  await fs.writeFile(
    path.join(proof, "invocation.json"),
    JSON.stringify(
      {
        connector: path.basename(connector),
        connectorSha256: createHash("sha256")
          .update(await fs.readFile(pinnedConnector))
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
    ) + "\n",
  );
  model = await startModel({ worker, state });
  await fs.writeFile(path.join(agent, "models.json"), JSON.stringify(modelsConfig(model.port)));
  // No real auth file and no parent credentials/environment are inherited by T3.
  const config = {
    connector: pinnedConnector,
    connectorArgs: JSON.parse(process.env.BRUV_CONNECTOR_ARGS_JSON ?? "[]"),
    wire: path.join(root, "wire.ndjson"),
    state,
    proof,
    modelSlug,
    questionCases: process.env.ACCEPT_SAVED_QUESTION === "1",
    permissionCases: process.env.ACCEPT_PERMISSION === "1",
    env: {
      HOME: home,
      BRUV_CODING_AGENT_DIR: agent,
      BRUV_CLAUDE_COMPAT_HOME: agent,
      CLAUDE_CONFIG_DIR: path.join(agent, "native-history"),
      BRUV_CLAUDE_COMPAT_BRUV_PATH: normalBinary,
      BRUV_ACCEPTANCE_CONFIG: path.join(root, "config.json"),
    },
  };
  await fs.writeFile(config.env.BRUV_ACCEPTANCE_CONFIG, JSON.stringify(config), { mode: 0o600 });
  const tap = path.join(root, "connector-tap");
  await fs.copyFile(path.join(here, "tap.mjs"), tap);
  await fs.chmod(tap, 0o755);
  config.tap = tap;
  await fs.writeFile(config.env.BRUV_ACCEPTANCE_CONFIG, JSON.stringify(config), { mode: 0o600 });
  const replay = path.resolve(here, "../../wisdom/claude-compat/proof/native-ui-fixture/replay.mjs");
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: home,
    BRUV_ACCEPTANCE_CONFIG: config.env.BRUV_ACCEPTANCE_CONFIG,
    PROOF_OUTPUT: proof,
  };
  for (const key of ["T3_UPSTREAM", "BROWSER_PATH", "FIXTURE_PORT"]) if (process.env[key]) env[key] = process.env[key];
  child = spawn("/usr/bin/node", [replay], { env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw Error("Integrated native replay failed with exit " + code);
  if (model.records.some((r) => r.error)) throw Error("Local model endpoint rejected a request");
  if (model.records.filter((r) => r.delta?.content === "TASK_COMPLETED_REAL").length !== 1)
    throw Error("Expected exactly one actual model completion wake, not duplicate continuations");
  if (model.records.filter((r) => r.delta?.content === "CANCELLATION_COMPLETED_REAL").length !== 1)
    throw Error("Expected exactly one actual cancellation completion wake");
  passed = true;
} finally {
  let result = { integratedAcceptance: true };
  try {
    result = JSON.parse(await fs.readFile(path.join(proof, "result.json"), "utf8"));
  } catch {}
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify(
      {
        ...result,
        passed,
        cancellationCompletionWakeCount:
          model?.records.filter((r) => r.delta?.content === "CANCELLATION_COMPLETED_REAL").length ?? 0,
        modelCompletionWakeCount: model?.records.filter((r) => r.delta?.content === "TASK_COMPLETED_REAL").length ?? 0,
      },
      null,
      2,
    ) + "\n",
  );
  if (child && child.exitCode === null) child.kill("SIGTERM");
  // Scoped worker cleanup; verify command line and state before touching any PID.
  for (const scenario of ["steer", "early", "stop", "cancel"]) {
    try {
      const pid = Number(await fs.readFile(path.join(state, scenario + ".started"), "utf8"));
      const cmd = await fs.readFile("/proc/" + pid + "/cmdline", "utf8");
      if (cmd.includes(worker) && cmd.includes(state)) process.kill(pid, "SIGTERM");
    } catch {}
  }
  try {
    const { projectWire } = await import("./driver.mjs");
    const wire = (await fs.readFile(path.join(root, "wire.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    await fs.writeFile(
      path.join(proof, "wire-projection.ndjson"),
      projectWire(wire)
        .map((x) => JSON.stringify(x))
        .join("\n") + "\n",
    );
  } catch {}
  if (model) {
    await fs.writeFile(
      path.join(proof, "model-projection.json"),
      JSON.stringify(
        model.records.map((r) => ({
          sequence: r.sequence,
          model: r.model,
          error: r.error,
          tool: r.delta?.tool_calls?.[0]?.function?.name,
          response: r.delta?.content,
        })),
        null,
        2,
      ) + "\n",
    );
    await model.close();
  }
  await fs.rm(root, { recursive: true, force: true });
  await fs.writeFile(
    path.join(proof, "cleanup.json"),
    JSON.stringify({ temporaryScopedStateRemoved: true, realCredentialsUsed: false, integratedReplayPassed: passed }) +
      "\n",
  );
}
console.log("Integrated native acceptance proof: " + proof);
