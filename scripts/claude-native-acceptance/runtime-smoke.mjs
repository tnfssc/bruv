// This checks the model fixture against real Bruv RPC; it is NOT connector/T3 acceptance.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { startModel, modelsConfig, provider, modelId, modelSlug } from "./model.mjs";

function startRpcRuntime(binary, root, agent) {
  const child = spawn(binary, ["--mode", "rpc", "--no-approve", "--provider", provider, "--model", modelId], {
    cwd: root,
    env: {
      PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
      HOME: root,
      BRUV_CODING_AGENT_DIR: agent,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  let stderr = "";
  let buffer = "";
  const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
  child.stdout.on("data", (b) => {
    buffer += b;
    for (let p = buffer.indexOf("\n"); p >= 0; p = buffer.indexOf("\n")) {
      const line = buffer.slice(0, p);
      buffer = buffer.slice(p + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === "extension_ui_request" && event.method === "confirm")
        send({ type: "extension_ui_response", id: event.id, confirmed: false });
    }
  });
  child.stderr.on("data", (b) => (stderr += b));
  child.on("error", (e) => (stderr += e.message));

  const wait = async (predicate, label, ms = 30000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (predicate()) return;
      if (child.exitCode !== null && child.exitCode !== undefined) throw Error("Bruv exited: " + stderr.slice(-2000));
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("Timed out: " + label + "; " + stderr.slice(-2000) + "; events=" + JSON.stringify(events).slice(-3000));
  };
  const stop = async () => {
    if (child.exitCode === null) {
      child.stdin.end();
      child.kill("SIGTERM");
      await Promise.race([new Promise((r) => child.once("close", r)), new Promise((r) => setTimeout(r, 3000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  };
  return {
    events,
    prompt: (message) => send({ type: "prompt", message }),
    received: (marker) => events.some((e) => JSON.stringify(e).includes(marker)),
    wait,
    stop,
  };
}

async function stopManagedWorker(state, worker) {
  try {
    const pid = Number(await fs.readFile(path.join(state, "early.started"), "utf8"));
    const cmd = await fs.readFile("/proc/" + pid + "/cmdline", "utf8");
    if (cmd.includes(worker) && cmd.includes(state)) process.kill(pid, "SIGTERM");
  } catch {}
}

const worker = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const binary = process.env.BRUV_RUNTIME_BINARY ?? fileURLToPath(new URL("../../dist/bruv", import.meta.url));
const proof = path.resolve(process.env.PROOF_OUTPUT ?? ".cache/claude-runtime-smoke-" + Date.now());
await fs.mkdir(proof, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bruv-acceptance-runtime-"));
const agent = path.join(root, "agent"),
  state = path.join(root, "state");
let model;
let runtime;
let passed = false;
try {
  await fs.chmod(root, 0o700);
  for (const p of [agent, state]) await fs.mkdir(p);
  model = await startModel({ state, worker });
  await fs.writeFile(path.join(agent, "models.json"), JSON.stringify(modelsConfig(model.port)));
  runtime = startRpcRuntime(binary, root, agent);

  runtime.prompt("ACCEPT_EXECUTE");
  await runtime.wait(() => runtime.received("EXECUTE_CONFIRMED_REAL"), "actual execute result");
  await runtime.wait(() => runtime.events.some((e) => e.type === "agent_end"), "first agent end");
  const oldEnds = runtime.events.filter((e) => e.type === "agent_end").length;
  runtime.prompt("ACCEPT_EARLY_RETURN");
  await runtime.wait(() => runtime.received("EARLY_RETURN_REAL"), "actual background task admission");
  let started = false;
  for (let i = 0; i < 150; i++) {
    try {
      await fs.access(path.join(state, "early.started"));
      started = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(started, "actual shell worker started");
  const text = JSON.stringify(runtime.events);
  assert.match(text, /task_/);
  assert.match(text, /background/);
  await runtime.wait(() => runtime.events.filter((e) => e.type === "agent_end").length > oldEnds, "early agent end");
  await fs.writeFile(path.join(state, "early.release"), "release");
  await runtime.wait(() => runtime.received("TASK_COMPLETED_REAL"), "actual Bruv job completion wake", 45000);
  assert.ok(!model.records.some((r) => r.error), "test endpoint accepted only exact local identity");
  passed = true;
} finally {
  await runtime?.stop();
  await stopManagedWorker(state, worker);
  await model?.close();
  const records = model?.records ?? [];
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify(
      {
        runtimeFixtureSmoke: true,
        notConnectorAcceptance: true,
        modelIdentity: modelSlug,
        passed,
        modelCalls: records.length,
        modelErrors: records.filter((r) => r.error).map((r) => r.error),
        actualExecute: runtime?.received("BRUV_EXECUTE_REAL") ?? false,
        actualManagedTask: runtime?.received("task_") ?? false,
        completionWake: runtime?.received("TASK_COMPLETED_REAL") ?? false,
        realCredentialsUsed: false,
        temporaryScopedStateRemoved: true,
      },
      null,
      2,
    ) + "\n",
  );
  await fs.rm(root, { recursive: true, force: true });
}
console.log("Real Bruv runtime fixture smoke: " + proof);
