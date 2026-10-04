import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startModel, modelsConfig, modelSlug, provider, modelId } from "./subagent-model.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const connector = process.env.BRUV_CONNECTOR_EXECUTABLE;
if (!connector)
  throw Error("Set BRUV_CONNECTOR_EXECUTABLE to the actual built connector. Synthetic fixture is prohibited.");
await fs.access(connector, fs.constants.X_OK);
const normalBinary = path.resolve(
  process.env.BRUV_RUNTIME_BINARY ?? fileURLToPath(new URL("../../dist/bruv", import.meta.url)),
);
await fs.access(normalBinary, fs.constants.X_OK);
const proof = path.resolve(process.env.PROOF_OUTPUT ?? ".cache/claude-local-subagent-proof-" + Date.now());
await fs.mkdir(path.dirname(proof), { recursive: true });
await fs.mkdir(proof);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bruv-native-acceptance-"));
const state = path.join(root, "state"),
  agent = path.join(root, "agent"),
  home = path.join(root, "home");
const pinnedConnector = path.join(root, "actual-connector");
let model,
  child,
  passed = false;
try {
  await fs.chmod(root, 0o700);
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
  model = await startModel({ state });
  await fs.writeFile(path.join(agent, "models.json"), JSON.stringify(modelsConfig(model.port)));
  // Health probes have no --model; configure the fixture default explicitly.
  await fs.writeFile(
    path.join(agent, "settings.json"),
    JSON.stringify({ defaultProvider: provider, defaultModel: modelId }),
  );
  // No real auth file and no parent credentials/environment are inherited by T3.
  await fs.mkdir(path.join(home, ".bruv"));
  await fs.writeFile(
    path.join(home, ".bruv", "subagents.json"),
    JSON.stringify({
      fast: { model: modelSlug, thinking: "off" },
      normal: { model: modelSlug, thinking: "off" },
      orchestrator: { model: modelSlug, thinking: "off" },
    }),
  );
  await fs.copyFile(path.join(home, ".bruv", "subagents.json"), path.join(proof, "profiles.json"));
  const config = {
    connector: pinnedConnector,
    connectorArgs: JSON.parse(process.env.BRUV_CONNECTOR_ARGS_JSON ?? "[]"),
    wire: path.join(root, "wire.ndjson"),
    state,
    proof,
    modelSlug,
    env: {
      HOME: home,
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
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
  const template = path.resolve(here, "../../wisdom/claude-compat/proof/native-ui-fixture/replay.mjs");
  const replay = path.join(root, "replay.mjs");
  const { pathToFileURL } = await import("node:url");
  const replaySource = (await fs.readFile(template, "utf8"))
    .replace(
      "\'./native-actions.mjs\'",
      JSON.stringify(pathToFileURL(path.join(path.dirname(template), "native-actions.mjs")).href),
    )
    .replace(
      "\'../../../../scripts/claude-native-acceptance/driver.mjs\'",
      JSON.stringify(pathToFileURL(path.join(here, "subagent-driver.mjs")).href),
    );
  await fs.writeFile(replay, replaySource);
  const env = {
    PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    HOME: home,
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    BRUV_ACCEPTANCE_CONFIG: config.env.BRUV_ACCEPTANCE_CONFIG,
    PROOF_OUTPUT: proof,
  };
  if (!process.env.FIXTURE_PORT) {
    const reservation = net.createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    env.FIXTURE_PORT = String(reservation.address().port);
    await new Promise((resolve) => reservation.close(resolve));
  }
  for (const key of ["T3_UPSTREAM", "BROWSER_PATH", "FIXTURE_PORT"]) if (process.env[key]) env[key] = process.env[key];
  child = spawn(process.execPath, [replay], { env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw Error("Integrated native replay failed with exit " + code);
  if (model.records.some((r) => r.error)) throw Error("Local model endpoint rejected a request");
  if (model.records.filter((r) => r.delta?.content === "ROOT_COMPLETION_ONCE_REAL").length !== 1)
    throw Error("Expected exactly one actual worker completion wake");
  const launch = model.records.filter((r) => r.delta?.tool_calls?.[0]?.function.arguments.includes("subagent({"));
  if (launch.length !== 3) throw Error("Duplicate root subagent tool launch");
  if (model.records.filter((r) => r.delta?.content === "ROOT_KILLED_COMPLETION_REAL").length !== 1)
    throw Error("Expected exactly one real killed-job completion wake");
  if (model.records.filter((r) => r.delta?.content === "ROOT_AFTER_CHILD_REAL").length !== 1)
    throw Error("Expected exactly one actual same-root reply after child view return");
  await verifyChildHistory(agent, proof);
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
        killedJobCompletionWakeCount:
          model?.records.filter((r) => r.delta?.content === "ROOT_KILLED_COMPLETION_REAL").length ?? 0,
        modelCompletionWakeCount:
          model?.records.filter((r) => r.delta?.content === "ROOT_COMPLETION_ONCE_REAL").length ?? 0,
      },
      null,
      2,
    ) + "\n",
  );
  if (child && child.exitCode === null) child.kill("SIGTERM");
  // Scoped worker cleanup; verify command line and state before touching any PID.
  for (const scenario of ["child", "cancel", "stop"]) {
    try {
      const pid = Number(await fs.readFile(path.join(state, scenario + ".ready"), "utf8"));
      const cmd = await fs.readFile("/proc/" + pid + "/cmdline", "utf8");
      if (cmd.includes(normalBinary) && cmd.includes("--execute-worker")) process.kill(pid, "SIGTERM");
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
  for (const file of await fs.readdir(proof)) {
    if (file.endsWith(".txt")) {
      const text = await fs.readFile(path.join(proof, file), "utf8");
      await fs.writeFile(path.join(proof, file), text.replaceAll(root, "<FIXTURE>"));
    }
  }
  await fs.rm(root, { recursive: true, force: true });
  await fs.writeFile(
    path.join(proof, "cleanup.json"),
    JSON.stringify({ temporaryScopedStateRemoved: true, realCredentialsUsed: false, integratedReplayPassed: passed }) +
      "\n",
  );
}
console.log("Integrated native acceptance proof: " + proof);

async function verifyChildHistory(agent, proof) {
  const { pathToFileURL } = await import("node:url");
  const files = await fs.readdir(path.join(agent, "native-history"), { recursive: true });
  const children = files.filter((f) => f.includes("subagents") && f.endsWith(".jsonl"));
  if (children.length !== 3) throw Error("Expected three actual native child histories, got " + children.length);
  const exported = [];
  let totalMessages = 0;
  for (const childFile of children) {
    const file = path.join(agent, "native-history", childFile);
    const rows = (await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
    const meta = JSON.parse(await fs.readFile(file.slice(0, -6) + ".meta.json", "utf8"));
    if (
      !rows.length ||
      !rows.every((r) => r.bruv?.sourceSessionId === meta.bruvSourceSessionId && r.bruv?.sourceMessageId)
    )
      throw Error("Missing real child source identities");
    const source = (await fs.readFile(meta.bruvSourceSessionId, "utf8")).trim().split("\n").map(JSON.parse);
    const originals = rows.map((r) => source.find((e) => e.id === r.bruv.sourceMessageId));
    if (originals.some((e) => !e || e.type !== "message"))
      throw Error("Child source IDs do not resolve to real committed messages");
    if (new Set(rows.map((r) => r.uuid)).size !== rows.length) throw Error("Duplicate child native history");
    const serialized = JSON.stringify(rows);
    if (!serialized.includes('"tool_use"')) throw Error("Native child history missing actual child tool");
    if (!process.env.BRUV_CLAUDE_SDK_PATH) throw Error("Set BRUV_CLAUDE_SDK_PATH to pinned SDK 0.3.276 sdk.mjs");
    const sdkPath = path.resolve(process.env.BRUV_CLAUDE_SDK_PATH);
    if (JSON.parse(await fs.readFile(path.join(path.dirname(sdkPath), "package.json"), "utf8")).version !== "0.3.276")
      throw Error("Wrong pinned SDK");
    const taskId = path.basename(file).slice(6, -6);
    const script =
      "const sdk=await import(" +
      JSON.stringify(pathToFileURL(sdkPath).href) +
      ");console.log(JSON.stringify(await sdk.getSubagentMessages(" +
      JSON.stringify(rows[0].sessionId) +
      "," +
      JSON.stringify(taskId) +
      ",{dir:" +
      JSON.stringify(rows[0].cwd) +
      "})));";
    const sdkRows = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        env: {
          PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
          HOME: path.join(path.dirname(agent), "home"),
          CLAUDE_CONFIG_DIR: path.join(agent, "native-history"),
        },
        encoding: "utf8",
      }),
    );
    if (JSON.stringify(sdkRows.map((r) => r.uuid)) !== JSON.stringify(rows.map((r) => r.uuid)))
      throw Error("SDK did not read actual child messages");
    if (!sdkRows.every((r) => r.parent_tool_use_id === meta.toolUseId))
      throw Error("SDK child parent binding mismatch");
    exported.push({ native: rows, sdk: sdkRows, source: originals, metadata: meta });
    totalMessages += rows.length;
  }
  const completed = exported.filter((child) => JSON.stringify(child.native).includes("CHILD_ANSWER_REAL"));
  if (
    completed.length !== 1 ||
    !JSON.stringify(completed[0]).includes("CHILD_TOOL_RESULT_REAL") ||
    !JSON.stringify(completed[0].native).includes('"tool_result"')
  )
    throw Error("Native completed child history missing actual tool/result/answer");
  const redact = (value) => JSON.stringify(value, null, 2).replaceAll(path.dirname(agent), "<FIXTURE>") + "\n";
  await fs.writeFile(path.join(proof, "child-history.json"), redact(exported));
  const result = JSON.parse(await fs.readFile(path.join(proof, "result.json"), "utf8"));
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify(
      { ...result, childSdkVersion: "0.3.276", childSourceIdsResolved: totalMessages, childSdkMessages: totalMessages },
      null,
      2,
    ) + "\n",
  );
}
