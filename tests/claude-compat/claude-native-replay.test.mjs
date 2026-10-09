import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const template = new URL("../../wisdom/claude-compat/proof/native-ui-fixture/replay.mjs", import.meta.url);

const mockHooks = String.raw`
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const proof = process.env.PROOF_OUTPUT;
const mode = process.env.REPLAY_TEST_MODE;
const event = async (name) => fs.appendFile(path.join(proof, "events.ndjson"), JSON.stringify(name) + "\n");
`;

// The executable and Playwright are the mocked boundary; the replay remains production source.
async function installMockUpstream(upstream, proof) {
  const binary = path.join(upstream, "platform/t3");
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.mkdir(path.join(upstream, "runtime/node_modules/playwright"), { recursive: true });
  await fs.writeFile(
    binary,
    `#!${process.execPath}\n` +
      mockHooks.replace("process.env.PROOF_OUTPUT", JSON.stringify(proof)) +
      `
if (process.argv.includes("--version")) {
  console.log("test-version");
} else if (process.argv.includes("pair")) {
  console.log("token=PRIVATE_PAIRING_TOKEN");
} else {
  const { createServer } = await import("node:http");
  await event("server-start");
  await fs.writeFile(path.join(proof, "server.pid"), String(process.pid));
  const server = createServer((_, response) => response.end("ready"));
  server.listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");
  process.on("SIGTERM", async () => {
    await event("server-stop");
    server.close(() => process.exit());
  });
}
`,
  );
  await fs.chmod(binary, 0o755);
  await fs.writeFile(
    path.join(upstream, "runtime/node_modules/playwright/index.mjs"),
    mockHooks +
      `
const locator = () => ({
  or() {
    return this;
  },
  and() {
    return this;
  },
  first() {
    return this;
  },
  waitFor: async () => {},
  isVisible: async () => true,
  click: async () => {},
  fill: async () => {},
  blur: async () => {},
});
const page = {
  setDefaultTimeout() {},
  getByText: locator,
  getByRole: locator,
  getByPlaceholder: locator,
  locator: () => ({ ...locator(), innerText: async () => "native test body" }),
  goto: async () => {},
  waitForTimeout: async () => {},
  screenshot: async ({ path: p }) => fs.writeFile(p, "test image"),
};
export const chromium = {
  launch: async () => {
    if (mode === "launch-failure") throw Error("launch failed");
    await event("browser-open");
    await fs.writeFile(path.join(proof, "browser-alive"), "");
    return {
      newContext: async () => ({ newPage: async () => page }),
      close: async () => {
        await event("browser-close");
        await fs.rm(path.join(proof, "browser-alive"));
        if (mode === "close-failure") throw Error("close failed");
      },
    };
  },
};
`,
  );
  return binary;
}

// The subagent variant deliberately has no capture export. Its real driver owns final collection.
async function writeMockDriver(driver, mode) {
  await fs.writeFile(
    driver,
    mockHooks +
      (mode === "subagent"
        ? ""
        : `
export async function capture() {
  await event("capture");
  return {
    id: "owned",
    flush: () => {
      throw Error("driver bypassed");
    },
  };
}
`) +
      String.raw`
export async function prepare({ base }) {
  await event("prepare");
  if (mode === "setup-failure") throw Error("setup failed");
  if (mode === "subagent") {
    const logs = path.join(base, "logs/provider");
    await fs.mkdir(logs, { recursive: true });
    await fs.writeFile(
      path.join(logs, "proof.log"),
      JSON.stringify({
        event: {
          direction: "out",
          payload: { type: "result", result: "ROOT_AFTER_CHILD_REAL private body", user_message_uuid: "secret-uuid" },
        },
      }),
    );
  }
}
export async function captureIdentity() {
  await event("identity");
}
export async function exercise({ config, observation }) {
  assert.equal(observation?.id, mode === "subagent" ? undefined : "owned");
  await event("exercise");
  await fs.writeFile(config.wire, JSON.stringify({ kind: "stdin", value: { type: "user", priority: "now" } }) + "\n");
  if (mode === "exercise-failure") throw Error("exercise failed");
  if (mode === "binary-change") await fs.appendFile(config.tap, "\n// changed");
}
export async function verify({ proof }) {
  await event("verify");
  await fs.writeFile(path.join(proof, "result.json"), JSON.stringify({ passed: true }));
}
export async function captureFailure() {
  await event("failure-capture");
}
export async function flushCapture({ root, observation }) {
  assert.ok((await fs.stat(root)).isDirectory());
  assert.equal(observation?.id, ["subagent", "launch-failure"].includes(mode) ? undefined : "owned");
  if (mode !== "launch-failure") await fs.stat(path.join(proof, "browser-alive"));
  await event("driver-flush");
  if (mode === "subagent") {
    const driver = await import(${JSON.stringify(new URL("../../scripts/claude-native-acceptance/subagent-driver.mjs", import.meta.url).href)});
    await driver.flushCapture();
  } else await fs.writeFile(path.join(proof, "final-provider-evidence.json"), "final evidence");
  if (mode === "flush-failure") throw Error("flush failed");
}
`,
  );
}

async function generateReplay(fixture, mode, runtime, driver) {
  let actions = new URL("../../wisdom/claude-compat/proof/native-ui-fixture/native-actions.mjs", import.meta.url).href;
  if (mode === "synthetic") {
    await fs.copyFile(
      new URL("../../wisdom/claude-compat/proof/native-ui-fixture/fixture.mjs", import.meta.url),
      path.join(fixture, "fixture.mjs"),
    );
    const syntheticActions = path.join(fixture, "synthetic-actions.mjs");
    await fs.writeFile(
      syntheticActions,
      mockHooks +
        'export async function exercise(){await event("exercise");await fs.writeFile(' +
        JSON.stringify(path.join(runtime, "wire.ndjson")) +
        ',[{kind:"stdin",value:{type:"user",priority:"now",message:"private prompt",uuid:"secret-uuid"}},' +
        '{kind:"stdin",value:{type:"control_request",request:{subtype:"interrupt",secret:"private token"}}},' +
        '{kind:"stdout",value:{type:"system",subtype:"init",status:"running",auth:"private auth"}}]' +
        '.map(JSON.stringify).join("\\n"));}',
    );
    actions = pathToFileURL(syntheticActions).href;
  }

  // These are the exact two bindings used by run-subagent.mjs (also used by trace launchers).
  // A relocated replay must not acquire another relative helper dependency.
  const source = await fs.readFile(template, "utf8");
  assert.ok(source.includes("'./native-actions.mjs'"));
  assert.ok(source.includes("'../../../../scripts/claude-native-acceptance/driver.mjs'"));
  const replay = path.join(fixture, "generated-replay.mjs");
  await fs.writeFile(
    replay,
    source
      .replace("'./native-actions.mjs'", JSON.stringify(actions))
      .replace("'../../../../scripts/claude-native-acceptance/driver.mjs'", JSON.stringify(pathToFileURL(driver).href)),
  );
  return replay;
}

// Exercise the executable template with an owned HTTP process and a small Playwright double.
// No T3, provider events, native authority, or browser acceptance is claimed by this harness.
async function replayFixture(mode, check) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "native-replay-"));
  let pid;
  try {
    const proof = path.join(fixture, "proof");
    const state = path.join(fixture, "state");
    const upstream = path.join(fixture, "upstream");
    const runtime =
      mode === "synthetic" ? path.join(fixture, ".cache/claude-native-ui-replay") : path.join(fixture, "t3-runtime");
    if (mode === "synthetic") await fs.mkdir(path.join(fixture, ".cache"));
    else await fs.mkdir(proof);
    await fs.mkdir(state);
    const binary = await installMockUpstream(upstream, proof);
    const config = {
      state,
      proof,
      wire: path.join(fixture, "wire.ndjson"),
      tap: binary,
      env: { PROOF_OUTPUT: proof, REPLAY_TEST_MODE: mode, BRUV_CODING_AGENT_DIR: path.join(fixture, "agent") },
    };
    if (mode === "preexisting") {
      await fs.mkdir(runtime);
      await fs.writeFile(path.join(runtime, "unrelated-state"), "must remain");
      await fs.writeFile(path.join(proof, "events.ndjson"), `${JSON.stringify("existing-state")}\n`);
    }
    const configPath = path.join(fixture, "config.json");
    await fs.writeFile(configPath, JSON.stringify(config));
    const driver = path.join(fixture, "driver.mjs");
    await writeMockDriver(driver, mode);
    const replay = await generateReplay(fixture, mode, runtime, driver);
    const reservation = net.createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(process.execPath, [replay], {
      env: {
        PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
        HOME: fixture,
        T3_UPSTREAM: upstream,
        BROWSER_PATH: "test-browser",
        FIXTURE_PORT: String(port),
        ...(mode === "synthetic" ? {} : { BRUV_ACCEPTANCE_CONFIG: configPath }),
        PROOF_OUTPUT: proof,
        REPLAY_TEST_MODE: mode,
      },
      cwd: fixture,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (data) => (stderr += data));
    child.stdout.resume();
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    try {
      pid = Number(await fs.readFile(path.join(proof, "server.pid"), "utf8"));
    } catch {}
    const events = (await fs.readFile(path.join(proof, "events.ndjson"), "utf8")).trim().split("\n").map(JSON.parse);
    await check({ code, stderr, events, proof, runtime, pid });
  } finally {
    // This harness owns the PID written by its own fake binary; clean up even against the old leaking source.
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

async function assertReleased({ runtime, pid, events }) {
  await assert.rejects(fs.stat(runtime), { code: "ENOENT" });
  if (pid) {
    assert.ok(events.includes("server-stop"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
}

for (const mode of ["integrated", "subagent"]) {
  test(`${mode} replay finalizes through the driver before owned teardown`, async () => {
    await replayFixture(mode, async (result) => {
      assert.equal(result.code, 0, result.stderr);
      assert.ok(result.events.indexOf("verify") < result.events.indexOf("driver-flush"));
      assert.ok(result.events.indexOf("driver-flush") < result.events.indexOf("browser-close"));
      assert.ok(result.events.indexOf("browser-close") < result.events.indexOf("server-stop"));
      const evidence = await fs.readFile(path.join(result.proof, "final-provider-evidence.json"), "utf8");
      if (mode === "subagent") {
        const final = JSON.parse(evidence);
        assert.deepEqual(final.provider[0].markers, ["ROOT_AFTER_CHILD_REAL"]);
        assert.doesNotMatch(evidence, /private body|secret-uuid/);
      } else assert.equal(evidence, "final evidence");
      await assertReleased(result);
    });
  });
}

for (const [mode, message] of [
  ["launch-failure", "launch failed"],
  ["exercise-failure", "exercise failed"],
  ["binary-change", "AssertionError"],
]) {
  test(`${mode} preserves failure evidence and final capture`, async () => {
    await replayFixture(mode, async (result) => {
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, new RegExp(message));
      assert.ok(!result.events.includes("verify"));
      assert.ok(result.events.indexOf("failure-capture") < result.events.indexOf("driver-flush"));
      const failure = JSON.parse(await fs.readFile(path.join(result.proof, "result.json"), "utf8"));
      assert.equal(failure.passed, false);
      assert.equal(failure.upstreamUnmodified, mode !== "binary-change");
      await assertReleased(result);
    });
  });
}

for (const mode of ["flush-failure", "close-failure", "setup-failure"]) {
  test(`${mode} does not strand owned private state or the server`, async () => {
    await replayFixture(mode, async (result) => {
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, new RegExp(`${mode.split("-")[0]} failed`));
      if (mode !== "setup-failure") assert.ok(result.events.includes("driver-flush"));
      else assert.deepEqual(result.events, ["prepare"]);
      await assertReleased(result);
    });
  });
}

test("standalone synthetic replay retains only its declared safe seam fields", async () => {
  await replayFixture("synthetic", async (result) => {
    assert.equal(result.code, 0, result.stderr);
    const projection = await fs.readFile(path.join(result.proof, "wire-projection.ndjson"), "utf8");
    assert.doesNotMatch(projection, /private|secret-uuid|PRIVATE_PAIRING_TOKEN/);
    assert.deepEqual(projection.trim().split("\n").map(JSON.parse), [
      { direction: "stdin", type: "user", priority: "now" },
      { direction: "stdin", type: "control_request", control: "interrupt" },
      { direction: "stdout", type: "system", subtype: "init", status: "running" },
    ]);
    const proof = JSON.parse(await fs.readFile(path.join(result.proof, "result.json"), "utf8"));
    assert.equal(proof.syntheticEventsNotBruvExecution, true);
    assert.equal(proof.anthropicAccount, false);
    assert.equal(proof.upstreamUnmodified, true);
    assert.ok(!result.events.includes("driver-flush"));
    await assertReleased(result);
  });
});

test("an existing runtime is neither reused nor deleted", async () => {
  await replayFixture("preexisting", async (result) => {
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /EEXIST/);
    assert.deepEqual(result.events, ["existing-state"]);
    assert.equal(await fs.readFile(path.join(result.runtime, "unrelated-state"), "utf8"), "must remain");
    assert.equal(result.pid, undefined);
  });
});
