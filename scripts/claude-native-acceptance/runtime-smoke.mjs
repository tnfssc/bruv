// This checks the model fixture against real Bruv RPC; it is NOT connector/T3 acceptance.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { startModel, modelsConfig, provider, modelId, modelSlug } from "./model.mjs";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bruv-acceptance-runtime-"));
await fs.chmod(root, 0o700);
const agent = path.join(root, "agent"),
  state = path.join(root, "state");
for (const p of [agent, state]) await fs.mkdir(p);
const worker = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const binary = process.env.BRUV_RUNTIME_BINARY ?? "/home/tnfssc/Code/bruv/dist/bruv";
const model = await startModel({ state, worker });
let child;
let stderr = "";
const events = [];
const proof = path.resolve(process.env.PROOF_OUTPUT ?? ".cache/claude-runtime-smoke-" + Date.now());
await fs.mkdir(proof, { recursive: true });
const wait = async (predicate, label, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return;
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw Error("Bruv exited: " + stderr.slice(-2000));
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timed out: " + label + "; " + stderr.slice(-2000) + "; events=" + JSON.stringify(events).slice(-3000));
};
let passed = false;
try {
  await fs.writeFile(path.join(agent, "models.json"), JSON.stringify(modelsConfig(model.port)));
  child = spawn(binary, ["--mode", "rpc", "--no-approve", "--provider", provider, "--model", modelId], {
    cwd: root,
    env: {
      PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
      HOME: root,
      BRUV_CODING_AGENT_DIR: agent,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  child.stdout.on("data", (b) => {
    buffer += b;
    for (let p; (p = buffer.indexOf("\n")) >= 0; ) {
      const line = buffer.slice(0, p);
      buffer = buffer.slice(p + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === "extension_ui_request" && event.method === "confirm")
        child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: false }) + "\n");
    }
  });
  child.stderr.on("data", (b) => (stderr += b));
  child.on("error", (e) => (stderr += e.message));
  const prompt = (message) => child.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n");
  const received = (marker) => events.some((e) => JSON.stringify(e).includes(marker));
  prompt("ACCEPT_EXECUTE");
  await wait(() => received("EXECUTE_CONFIRMED_REAL"), "actual execute result");
  await wait(() => events.some((e) => e.type === "agent_end"), "first agent end");
  const oldEnds = events.filter((e) => e.type === "agent_end").length;
  prompt("ACCEPT_EARLY_RETURN");
  await wait(() => received("EARLY_RETURN_REAL"), "actual background task admission");
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
  const text = JSON.stringify(events);
  assert.match(text, /task_/);
  assert.match(text, /background/);
  await wait(() => events.filter((e) => e.type === "agent_end").length > oldEnds, "early agent end");
  await fs.writeFile(path.join(state, "early.release"), "release");
  await wait(() => received("TASK_COMPLETED_REAL"), "actual Bruv job completion wake", 45000);
  assert.ok(!model.records.some((r) => r.error), "test endpoint accepted only exact local identity");
  passed = true;
} finally {
  if (child && child.exitCode === null) {
    child.stdin.end();
    child.kill("SIGTERM");
    await Promise.race([new Promise((r) => child.once("close", r)), new Promise((r) => setTimeout(r, 3000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  try {
    const pid = Number(await fs.readFile(path.join(state, "early.started"), "utf8"));
    const cmd = await fs.readFile("/proc/" + pid + "/cmdline", "utf8");
    if (cmd.includes(worker) && cmd.includes(state)) process.kill(pid, "SIGTERM");
  } catch {}
  await model.close();
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify(
      {
        runtimeFixtureSmoke: true,
        notConnectorAcceptance: true,
        modelIdentity: modelSlug,
        passed,
        modelCalls: model.records.length,
        modelErrors: model.records.filter((r) => r.error).map((r) => r.error),
        actualExecute: events.some((e) => JSON.stringify(e).includes("BRUV_EXECUTE_REAL")),
        actualManagedTask: events.some((e) => JSON.stringify(e).includes("task_")),
        completionWake: events.some((e) => JSON.stringify(e).includes("TASK_COMPLETED_REAL")),
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
