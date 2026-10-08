// Compose existing validated gates; no synthetic runtime or product downloads here.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite"; // The strict gates require this Node API.
void DatabaseSync;
const root = fileURLToPath(new URL("../../", import.meta.url));
const proofRoot = path.join(root, "wisdom/claude-compat/proof/official-2644");
const pin = JSON.parse(await fs.readFile(path.join(proofRoot, "provenance.json"), "utf8"));
for (const key of [
  "T3_UPSTREAM",
  "BRUV_CONNECTOR_EXECUTABLE",
  "BRUV_RUNTIME_BINARY",
  "BROWSER_PATH",
  "PROOF_OUTPUT",
  "BRUV_CLAUDE_SDK_PATH",
])
  if (!process.env[key]) throw Error(`Set ${key} for the final paired-binary native gate`);
await fs.access(process.env.BRUV_CLAUDE_SDK_PATH);
const sdkPackage = JSON.parse(
  await fs.readFile(path.join(path.dirname(process.env.BRUV_CLAUDE_SDK_PATH), "package.json"), "utf8"),
);
if (sdkPackage.name !== "@anthropic-ai/claude-agent-sdk" || sdkPackage.version !== "0.3.276")
  throw Error("Native history gate requires SDK 0.3.276");
const binary = path.resolve(process.env.T3_UPSTREAM, "platform/t3");
async function checkBinary() {
  const hash = createHash("sha256")
    .update(await fs.readFile(binary))
    .digest("hex");
  if (hash !== pin.t3BinarySha256AfterAllGates) throw Error(`Not unchanged official ${pin.officialRelease}`);
}
const output = path.resolve(process.env.PROOF_OUTPUT);
const trace = path.join(proofRoot, "run-trace.mjs");
const native = path.join(root, "scripts/claude-native-acceptance/run.mjs");
const suites = [
  { name: "command", script: trace, flags: { TRACE_SUITE: "command" } },
  { name: "local-child", script: trace, flags: { TRACE_SUITE: "subagent" } },
  { name: "human", script: trace, flags: { TRACE_SUITE: "human", ACCEPT_HUMAN_CONTROLS: "1" } },
  { name: "app-delegation", script: native, flags: { ACCEPT_APP_DELEGATION: "1" } },
  { name: "default-controls", script: native, flags: {} },
  { name: "command-final", script: trace, flags: { TRACE_SUITE: "command" } },
];
const env = { ...process.env };
// Each branch must actually run, regardless of caller's last manual invocation.
for (const key of [
  "TRACE_SUITE",
  "ACCEPT_APP_DELEGATION",
  "ACCEPT_HUMAN_CONTROLS",
  "ACCEPT_SAVED_QUESTION",
  "ACCEPT_PERMISSION",
])
  delete env[key];
// A suite counts only after its process closes, the binary is rechecked, and its evidence agrees.
async function runVerifiedSuite({ name, script, flags }) {
  await checkBinary();
  const proof = path.join(output, name);
  console.log(`Native release gate: ${name}`);
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...env, ...flags, PROOF_OUTPUT: proof },
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  await checkBinary();
  if (code !== 0) throw Error(`${name} native gate failed (exit ${code})`);
  const result = JSON.parse(await fs.readFile(path.join(proof, "result.json"), "utf8"));
  if (!result.passed || !result.upstreamUnmodified || result.t3BinarySha256 !== pin.t3BinarySha256AfterAllGates)
    throw Error(`${name} did not produce passing unchanged-official evidence`);
}

await checkBinary(); // Reject older/patched artifacts before any server launch or proof directory.
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output); // Never replace previous proof.
for (const suite of suites) await runVerifiedSuite(suite);
await fs.writeFile(
  path.join(output, "gate.json"),
  `${JSON.stringify(
    {
      passed: true,
      officialRelease: pin.officialRelease,
      officialSource: pin.officialSource,
      archiveSha256: pin.archiveSha256,
      executableSha256: pin.t3BinarySha256AfterAllGates,
      suites: suites.map(({ name }) => name),
      dependencyQueueRaceFixed: false,
    },
    null,
    2,
  )}\n`,
);
