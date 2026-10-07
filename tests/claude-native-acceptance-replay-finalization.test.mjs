import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Offline join proof: the real generator, replay, subagent driver and collector run.
// Only the external T3 binary/browser are owned stand-ins; this is not native acceptance.
test("generated subagent replay collects exit evidence before browser close and runtime deletion", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "native-replay-finalization-"));
  try {
    const root = path.join(fixture, "t3-runtime");
    const proof = path.join(fixture, "proof");
    const state = path.join(fixture, "state");
    const upstream = path.join(fixture, "upstream");
    const here = fileURLToPath(new URL("../scripts/claude-native-acceptance/", import.meta.url));
    const seed = path.join(fixture, "seed-base");
    const userdata = path.join(seed, "userdata");
    const providerLogs = path.join(seed, "logs/provider");
    const browserModule = path.join(upstream, "runtime/node_modules/playwright/index.mjs");
    for (const dir of [
      proof,
      state,
      userdata,
      providerLogs,
      path.dirname(browserModule),
      path.join(upstream, "platform"),
    ])
      await fs.mkdir(dir, { recursive: true });

    const wire = path.join(fixture, "wire.ndjson");
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
    const configFile = path.join(fixture, "config.json");
    await fs.writeFile(
      configFile,
      JSON.stringify({
        root,
        proof,
        state,
        wire,
        tap: path.join(fixture, "unused-tap"),
        env: { CLAUDE_CONFIG_DIR: path.join(fixture, "claude"), BRUV_CODING_AGENT_DIR: path.join(fixture, "agent") },
      }),
    );

    // Execute the generation block from the shipped runner, including its real import substitutions.
    const runner = await fs.readFile(path.join(here, "run-subagent.mjs"), "utf8");
    const start = runner.indexOf("  const template =");
    const end = runner.indexOf("  const env =", start);
    assert.ok(start >= 0 && end > start, "shipped replay generation block");
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction("fs", "path", "here", "root", runner.slice(start, end))(fs, path, here, fixture);
    const replay = path.join(fixture, "replay.mjs");
    assert.ok((await fs.readFile(replay, "utf8")).includes("subagent-driver.mjs"));

    // A real loopback health endpoint lets the generated replay reach browser startup.
    const portLease = createServer();
    await new Promise((resolve) => portLease.listen(0, "127.0.0.1", resolve));
    const port = portLease.address().port;
    await new Promise((resolve) => portLease.close(resolve));
    const binary = path.join(upstream, "platform/t3");
    await fs.writeFile(
      binary,
      `#!${process.execPath}
import { createServer } from "node:http";
import fs from "node:fs/promises";
if (process.argv.includes("--version")) console.log("owned-t3-fixture");
else {
  await fs.writeFile(${JSON.stringify(path.join(fixture, "server.pid"))}, String(process.pid));
  await fs.cp(${JSON.stringify(seed)}, process.argv[process.argv.indexOf("--base-dir") + 1], { recursive: true });
  const server = createServer((_, res) => res.end("ok"));
  server.listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
`,
      { mode: 0o755 },
    );
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
