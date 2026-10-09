import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const serverSource = String.raw`#!${process.execPath}
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
const proof = process.env.PROOF_OUTPUT;
if (process.env.PRIVATE_PARENT_CREDENTIAL) throw Error("inherited parent credential");
const event = (name) => fs.appendFile(path.join(proof, "events.ndjson"), JSON.stringify(name) + "\n");
if (process.argv.includes("--version")) console.log("owned-history-t3");
else if (process.argv.includes("pair")) console.log("token=PRIVATE_PAIRING_TOKEN");
else {
  await fs.writeFile(path.join(proof, "server.pid"), String(process.pid));
  const server = createServer((_, res) => res.end("ok"));
  server.listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");
  process.on("SIGTERM", async () => {
    await event("server-stop");
    if (process.env.HISTORY_TEST_MODE !== "term-ignored") server.close(() => process.exit(0));
  });
}
`;

const browserSource = String.raw`import fs from "node:fs/promises";
import path from "node:path";
const proof = process.env.PROOF_OUTPUT;
const mode = process.env.HISTORY_TEST_MODE;
const event = (name) => fs.appendFile(path.join(proof, "events.ndjson"), JSON.stringify(name) + "\n");
const locator = { waitFor: async () => {}, click: async () => {}, fill: async () => {}, blur: async () => {}, press: async () => {}, first() { return this; }, isVisible: async () => true, innerText: async () => {
  const config = JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
  return path.join(path.dirname(config.state), "t3-runtime") + " body";
} };
const page = { setDefaultTimeout() {}, goto: async () => {}, waitForTimeout: async () => {}, getByText: () => locator, getByRole: () => locator, locator: () => locator, screenshot: async ({ path: file }) => {
  await fs.access(path.join(path.dirname(proof), "t3-runtime"));
  if (file.endsWith("failure.png")) await event("failure-screenshot");
  await fs.writeFile(file, "owned image");
} };
export const chromium = { launch: async () => {
  if (mode === "launch-failure") throw Error("launch failed");
  return { newContext: async () => ({ newPage: async () => page }), close: async () => {
    await event("browser-close");
    if (mode === "close-failure") throw Error("close failed");
  } };
} };
`;

const driverSource = String.raw`import fs from "node:fs/promises";
import path from "node:path";
const proof = process.env.PROOF_OUTPUT;
const mode = process.env.HISTORY_TEST_MODE;
const event = (name) => fs.appendFile(path.join(proof, "events.ndjson"), JSON.stringify(name) + "\n");
export async function prepare({ config }) {
  await event("prepare");
  if (mode === "setup-failure") throw Error("setup failed");
  if (mode === "spawn-failure") await fs.writeFile(config.tap, "#!/missing-history-test-interpreter\n");
}
export async function captureIdentity() { await event("identity"); }
export async function exercise({ config }) {
  await event("exercise");
  await fs.writeFile(config.wire, JSON.stringify({ kind: "lifecycle", value: { event: "exit" } }) + "\n");
  if (mode === "exercise-failure") throw Error("exercise failed");
  if (mode === "binary-change") await fs.appendFile(config.tap, "\n// changed");
}
export async function verify({ proof, config }) {
  await fs.access(path.join(path.dirname(config.state), "t3-runtime"));
  await event("verify");
  await fs.writeFile(path.join(proof, "result.json"), JSON.stringify({ passed: true }));
}
`;

// Only the external T3/browser and history driver boundaries are substituted.
// The shipped replay owns acquisition, pairing, evidence, and teardown.
async function prepareReplayFixture(fixture, mode) {
  const proof = path.join(fixture, "proof");
  const upstream = path.join(fixture, "upstream");
  const binary = path.join(upstream, "platform/t3");
  const browser = path.join(upstream, "runtime/node_modules/playwright/index.mjs");
  await fs.mkdir(proof);
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.mkdir(path.dirname(browser), { recursive: true });
  await fs.writeFile(binary, serverSource, { mode: 0o755 });
  await fs.writeFile(browser, browserSource);
  await fs.writeFile(path.join(fixture, "history-driver.mjs"), driverSource);
  await fs.copyFile(
    new URL("../../scripts/claude-native-acceptance/history-replay.mjs", import.meta.url),
    path.join(fixture, "replay.mjs"),
  );

  // Keep process configuration outside the runtime whose release is under test.
  // These fresh directories, the fixture and its proof are retained for inspection.
  const isolatedEnv = {
    HOME: await fs.mkdtemp(path.join(fixture, "home-")),
    XDG_CONFIG_HOME: await fs.mkdtemp(path.join(fixture, "config-")),
    CLAUDE_CONFIG_DIR: await fs.mkdtemp(path.join(fixture, "sdk-")),
    TMPDIR: await fs.mkdtemp(path.join(fixture, "tmp-")),
  };
  const configPath = path.join(fixture, "config.json");
  const config = {
    state: path.join(fixture, "state"),
    wire: path.join(fixture, "wire.ndjson"),
    tap: binary,
    env: { ...isolatedEnv, HISTORY_TEST_MODE: mode, PROOF_OUTPUT: proof },
  };
  await fs.writeFile(configPath, JSON.stringify(config));
  if (mode === "preexisting") {
    const runtime = path.join(fixture, "t3-runtime");
    await fs.mkdir(runtime);
    await fs.writeFile(path.join(runtime, "unrelated-state"), "must remain");
  }
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  return {
    PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    ...isolatedEnv,
    T3_UPSTREAM: upstream,
    BROWSER_PATH: "owned-browser",
    FIXTURE_PORT: String(port),
    BRUV_ACCEPTANCE_CONFIG: configPath,
    PROOF_OUTPUT: proof,
    HISTORY_TEST_MODE: mode,
    PRIVATE_PARENT_CREDENTIAL: "must not reach server",
    T3_EXPECTED_SHA256: createHash("sha256")
      .update(await fs.readFile(binary))
      .digest("hex"),
  };
}

async function replayFixture(mode, check) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "bruv-history-replay-test-"));
  const proof = path.join(fixture, "proof");
  const runtime = path.join(fixture, "t3-runtime");
  const env = await prepareReplayFixture(fixture, mode);
  let pid;
  try {
    const child = spawn(process.execPath, [path.join(fixture, "replay.mjs")], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    try {
      pid = Number(await fs.readFile(path.join(proof, "server.pid"), "utf8"));
    } catch {}
    const events = (await fs.readFile(path.join(proof, "events.ndjson"), "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    await check({ code, stderr, events, proof, runtime, pid });
  } finally {
    // Release the harness-owned process even when testing the leaking baseline.
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}

async function assertReleased({ runtime, pid, events }) {
  await assert.rejects(fs.stat(runtime), { code: "ENOENT" });
  if (pid) {
    assert.ok(events.includes("server-stop"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
}

for (const mode of ["setup-failure", "close-failure"]) {
  test(`history replay releases owned resources after ${mode}`, async () => {
    await replayFixture(mode, async (result) => {
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, new RegExp(`${mode.split("-")[0]} failed`));
      await assertReleased(result);
    });
  });
}

async function assertFailureProof(result, upstreamUnmodified) {
  assert.equal(result.code === 0, false, result.stderr);
  const proof = JSON.parse(await fs.readFile(path.join(result.proof, "result.json"), "utf8"));
  assert.equal(proof.passed, false);
  assert.equal(proof.upstreamUnmodified, upstreamUnmodified);
  assert.equal(proof.syntheticConnectorEvents, false);
  assert.equal(proof.realCredentialsUsed, false);
  assert.ok(!result.events.includes("verify"));
}

test("history replay verifies before closing the browser and releasing the server", async () => {
  await replayFixture("success", async (result) => {
    assert.equal(result.code, 0, result.stderr);
    const proof = JSON.parse(await fs.readFile(path.join(result.proof, "result.json"), "utf8"));
    assert.equal(proof.passed, true);
    assert.ok(result.events.indexOf("verify") < result.events.indexOf("browser-close"));
    assert.ok(result.events.indexOf("browser-close") < result.events.indexOf("server-stop"));
    await assertReleased(result);
  });
});

for (const mode of ["exercise-failure", "binary-change"]) {
  test(`history replay captures failure proof before browser and runtime teardown after ${mode}`, async () => {
    await replayFixture(mode, async (result) => {
      await assertFailureProof(result, mode !== "binary-change");
      assert.ok(result.events.indexOf("failure-screenshot") < result.events.indexOf("browser-close"));
      const text = await fs.readFile(path.join(result.proof, "failure.txt"), "utf8");
      assert.ok(!text.includes(result.runtime));
      assert.ok(result.events.indexOf("browser-close") < result.events.indexOf("server-stop"));
      await assertReleased(result);
    });
  });
}

test("history replay releases the server when browser launch fails", async () => {
  await replayFixture("launch-failure", async (result) => {
    await assertFailureProof(result, true);
    await assertReleased(result);
  });
});

test("history replay never reuses or removes an existing runtime", async () => {
  await replayFixture("preexisting", async (result) => {
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /EEXIST/);
    assert.equal(await fs.readFile(path.join(result.runtime, "unrelated-state"), "utf8"), "must remain");
    assert.deepEqual(result.events, []);
    assert.equal(result.pid, undefined);
  });
});

test("history replay releases the runtime when server startup fails", async () => {
  await replayFixture("spawn-failure", async (result) => {
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /ENOENT/);
    assert.equal(result.pid, undefined);
    const proof = JSON.parse(await fs.readFile(path.join(result.proof, "result.json"), "utf8"));
    assert.equal(proof.passed, false);
    await assertReleased(result);
  });
});

test("history replay escalates server shutdown after verification", async () => {
  await replayFixture("term-ignored", async (result) => {
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.events.indexOf("verify") < result.events.indexOf("server-stop"));
    await assertReleased(result);
  });
});
