import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Offline join proof: the real replay, subagent driver and collector run.
// Only the external T3 binary/browser are owned stand-ins; this is not native acceptance.
test("configured subagent replay collects exit evidence before browser close and runtime deletion", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "native-replay-finalization-"));
  try {
    const root = path.join(fixture, "t3-runtime");
    const proof = path.join(fixture, "proof");
    const state = path.join(fixture, "state");
    const upstream = path.join(fixture, "upstream");
    const seed = path.join(fixture, "seed-base");
    const wire = path.join(fixture, "wire.ndjson");
    await fs.mkdir(proof);
    await fs.mkdir(state);
    await seedExitEvidence(seed, wire);

    const configFile = path.join(fixture, "config.json");
    await fs.writeFile(
      configFile,
      JSON.stringify({
        replayDriver: new URL("../scripts/claude-native-acceptance/subagent-driver.mjs", import.meta.url).href,
        root,
        proof,
        state,
        wire,
        tap: path.join(fixture, "unused-tap"),
        env: { CLAUDE_CONFIG_DIR: path.join(fixture, "claude"), BRUV_CODING_AGENT_DIR: path.join(fixture, "agent") },
      }),
    );

    const replay = fileURLToPath(
      new URL("../wisdom/claude-compat/proof/native-ui-fixture/replay.mjs", import.meta.url),
    );
    await installHealthServer(path.join(upstream, "platform/t3"), seed, path.join(fixture, "server.pid"));
    await installFailingBrowser(path.join(upstream, "runtime/node_modules/playwright/index.mjs"));

    // The health endpoint must succeed so the replay reaches the browser setup failure.
    const portLease = createServer();
    await new Promise((resolve) => portLease.listen(0, "127.0.0.1", resolve));
    const port = portLease.address().port;
    await new Promise((resolve) => portLease.close(resolve));
    const result = spawnSync(process.execPath, [replay], {
      env: {
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
        T3_UPSTREAM: upstream,
        BROWSER_PATH: "owned-browser",
        FIXTURE_PORT: String(port),
        BRUV_ACCEPTANCE_CONFIG: configFile,
        PROOF_OUTPUT: proof,
      },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.error, undefined, result.stderr);
    assert.notEqual(result.status, 0, "the owned browser failure must remain a failure");
    assert.match(result.stderr, /owned browser setup failure/);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(proof, "result.json"), "utf8")).error,
      "owned browser setup failure",
    );
    const evidence = JSON.parse(await fs.readFile(path.join(proof, "final-provider-evidence.json"), "utf8"));
    assert.equal(evidence.lifecycle[0].event, "exit");
    assert.deepEqual(evidence.provider[0].markers, ["ROOT_AFTER_CHILD_REAL"]);
    assert.deepEqual(evidence.persistence[0].rows, [{ id: "owned-child", status: "completed" }]);
    assert.ok(!JSON.stringify(evidence).includes("PRIVATE_PROMPT"));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(proof, "browser-close.json"), "utf8")), {
      evidencePresent: true,
      runtimePresent: true,
    });
    assert.equal(
      await fs.access(root).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    // Also clean our server if a deliberately broken finalizer prevented replay teardown.
    try {
      process.kill(Number(await fs.readFile(path.join(fixture, "server.pid"), "utf8")), "SIGTERM");
    } catch (error) {
      assert.ok(["ENOENT", "ESRCH"].includes(error.code), String(error));
    }
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

// Give the real collector one record from each exit-evidence source, including private text that must not be exported.
async function seedExitEvidence(seed, wire) {
  const userdata = path.join(seed, "userdata");
  const providerLogs = path.join(seed, "logs/provider");
  await fs.mkdir(userdata, { recursive: true });
  await fs.mkdir(providerLogs, { recursive: true });
  await fs.writeFile(wire, `${JSON.stringify({ kind: "lifecycle", value: { pid: 123, event: "exit" } })}\n`);
  await fs.writeFile(
    path.join(providerLogs, "owned.log"),
    `${JSON.stringify({
      event: { direction: "out", payload: { type: "assistant", text: "ROOT_AFTER_CHILD_REAL PRIVATE_PROMPT" } },
    })}\n`,
  );
  const database = new DatabaseSync(path.join(userdata, "statev2.sqlite"));
  try {
    database.exec("CREATE TABLE orchestration_v2_projection_subagents (id TEXT, status TEXT)");
    database.exec("INSERT INTO orchestration_v2_projection_subagents VALUES ('owned-child', 'completed')");
  } finally {
    database.close();
  }
}

// The substitute binary seeds the actual runtime base directory and serves the real health request.
async function installHealthServer(binary, seed, pidFile) {
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.writeFile(
    binary,
    `#!${process.execPath}
import { createServer } from "node:http";
import fs from "node:fs/promises";
if (process.argv.includes("--version")) console.log("owned-t3-fixture");
else {
  await fs.writeFile(${JSON.stringify(pidFile)}, String(process.pid));
  await fs.cp(${JSON.stringify(seed)}, process.argv[process.argv.indexOf("--base-dir") + 1], { recursive: true });
  const server = createServer((_, res) => res.end("ok"));
  server.listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
`,
    { mode: 0o755 },
  );
}

// Fail after browser launch, then observe ordering at the browser-close boundary.
async function installFailingBrowser(browserModule) {
  await fs.mkdir(path.dirname(browserModule), { recursive: true });
  await fs.writeFile(
    browserModule,
    `import fs from "node:fs/promises";
import path from "node:path";
export const chromium = {
  launch: async () => ({
    newContext: async () => { throw Error("owned browser setup failure"); },
    close: async () => {
      const config = JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
      const evidencePresent = await fs.access(path.join(config.proof, "final-provider-evidence.json")).then(() => true, () => false);
      await fs.access(config.root);
      await fs.writeFile(path.join(config.proof, "browser-close.json"), JSON.stringify({ evidencePresent, runtimePresent: true }));
    },
  }),
};
`,
  );
}
