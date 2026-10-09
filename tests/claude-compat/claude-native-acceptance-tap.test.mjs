import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Owned connector fixtures exercise the executable tap, not native protocol acceptance.
async function launch(t, source, config = {}, args = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-tap-"));
  const tap = path.join(root, "connector-tap");
  const connector = path.join(root, "connector.mjs");
  const configFile = path.join(root, "config.json");
  const wire = path.join(root, "wire.ndjson");
  let proc;
  let closed;
  t.after(async () => {
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      // The fixture owns both processes, including failed assertions before close.
      const records = await fs.readFile(wire, "utf8").catch(() => "");
      const pid = records
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
        .find((x) => x.kind === "lifecycle")?.owner;
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      proc.kill("SIGKILL");
      await closed;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.copyFile(new URL("../../scripts/claude-native-acceptance/tap.mjs", import.meta.url), tap);
  await fs.chmod(tap, 0o755);
  await fs.writeFile(connector, source);
  await fs.writeFile(
    configFile,
    JSON.stringify({
      connector: "node",
      connectorArgs: [connector],
      wire,
      state: path.join(root, "state"),
      ...config,
      ...(config.delegationCases ? { workerTap: tap } : {}),
    }),
  );
  proc = spawn(tap, args, {
    env: { ...process.env, BRUV_ACCEPTANCE_CONFIG: configFile },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [],
    stderr = [];
  proc.stdout.on("data", (chunk) => stdout.push(chunk));
  proc.stderr.on("data", (chunk) => stderr.push(chunk));
  closed = new Promise((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (code, signal) => resolve({ code, signal }));
  });
  return {
    root,
    proc,
    closed,
    stdout: () => Buffer.concat(stdout),
    stderr: () => Buffer.concat(stderr),
    records: async () => (await fs.readFile(wire, "utf8")).split("\n").filter(Boolean).map(JSON.parse),
  };
}

test("tap forwards exact bytes and records complete UTF-8 lines across chunk boundaries", {
  timeout: 5000,
}, async (t) => {
  const fixture = await launch(
    t,
    `
      process.stdin.on("data", chunk => {
        process.stdout.write(chunk);
        process.stderr.write(chunk);
      });
      process.stdin.on("end", () => { process.exitCode = 7; });
    `,
    // Delegation capture observes all diagnostics, not just the root allowlist.
    { delegationCases: true },
  );
  const packet = { text: "\u03B2\u{1f989}", path: fixture.root };
  const line = JSON.stringify(packet);
  const bytes = Buffer.from(`${line}\n\nnot-json\n{"unfinished"`);
  const split = Buffer.byteLength(line.slice(0, line.indexOf("\u{1f989}"))) + 2;
  // Do not send the rest until both forwarded streams expose the incomplete codepoint.
  const firstOutput = Promise.all([once(fixture.proc.stdout, "data"), once(fixture.proc.stderr, "data")]);
  fixture.proc.stdin.write(bytes.subarray(0, split));
  await firstOutput;
  assert.deepEqual(fixture.stdout(), bytes.subarray(0, split));
  assert.deepEqual(fixture.stderr(), bytes.subarray(0, split));
  fixture.proc.stdin.end(bytes.subarray(split));
  assert.deepEqual(await fixture.closed, { code: 7, signal: null });
  assert.deepEqual(fixture.stdout(), bytes);
  assert.deepEqual(fixture.stderr(), bytes);
  const records = await fixture.records();
  for (const kind of ["stdin", "stdout"]) {
    assert.deepEqual(
      records.filter((x) => x.kind === kind).map((x) => x.value),
      [packet, { unparsed: true }],
    );
  }
  assert.deepEqual(
    records.filter((x) => x.kind === "diagnostic").map((x) => x.value.error),
    [line.replaceAll(fixture.root, "<FIXTURE>"), "", "not-json"],
  );
  const lifecycle = records.filter((x) => x.kind === "lifecycle");
  const pid = lifecycle[0].value.pid;
  assert.ok(Number.isInteger(pid));
  assert.ok(records.every((x) => x.owner === pid && x.instance === "normal"));
  assert.deepEqual(
    lifecycle.map((x) => x.value),
    [
      { event: "spawn", pid, flags: [] },
      { event: "exit", code: 7, signal: null },
    ],
  );
});

test("worker scope records credential digest and launch options without exposing the credential", {
  timeout: 5000,
}, async (t) => {
  const token = "fixture-token-not-for-evidence";
  const fixture = await launch(
    t,
    "",
    { delegationCases: true, workerEnv: { BRUV_SUBAGENT_TYPE: "normal", BRUV_SUBAGENT_DEPTH: "1" } },
    [
      "--mcp-config",
      JSON.stringify({ mcpServers: { "t3-code": { headers: { Authorization: token } } } }),
      "--model=fixture-model",
      "--effort",
      "high",
      "--thinking=enabled",
    ],
  );
  fixture.proc.stdin.end();
  assert.deepEqual(await fixture.closed, { code: 0, signal: null });
  const records = await fixture.records();
  const scope = records.find((x) => x.kind === "scope").value;
  assert.deepEqual(scope, {
    instance: "normal",
    hasCredential: true,
    credentialDigest: createHash("sha256").update(token).digest("hex"),
    effort: "high",
    thinking: "enabled",
    model: "fixture-model",
    role: "normal",
    depth: "1",
  });
  assert.ok(!JSON.stringify(records).includes(token));
  const lifecycle = records.filter((x) => x.kind === "lifecycle");
  const pid = lifecycle[0].value.pid;
  assert.ok(Number.isInteger(pid));
  assert.ok(records.every((x) => x.owner === pid && x.instance === "normal"));
  assert.deepEqual(
    lifecycle.map((x) => x.value),
    [
      { event: "spawn", pid, flags: ["--mcp-config", "--model", "--effort", "--thinking"] },
      { event: "exit", code: 0, signal: null },
    ],
  );
});

test("root diagnostics retain the compatibility allowlist and redact only recorded fixture paths", {
  timeout: 5000,
}, async (t) => {
  const fixture = await launch(
    t,
    String.raw`
      import path from "node:path";
      const root = path.dirname(process.argv[1]);
      process.stderr.write([
        "noise " + root,
        "[bruv-claude-compat] No configured authentication " + root + " " + root,
        "[bruv-claude-compat] Unknown connector option: --example",
        "[bruv-claude-compat] trailing partial",
      ].join("\n"));
    `,
  );
  fixture.proc.stdin.end();
  assert.deepEqual(await fixture.closed, { code: 0, signal: null });
  assert.equal(
    fixture.stderr().toString(),
    [
      `noise ${fixture.root}`,
      `[bruv-claude-compat] No configured authentication ${fixture.root} ${fixture.root}`,
      "[bruv-claude-compat] Unknown connector option: --example",
      "[bruv-claude-compat] trailing partial",
    ].join("\n"),
  );
  const records = await fixture.records();
  assert.deepEqual(
    records.filter((x) => x.kind === "diagnostic").map((x) => x.value.error),
    [
      "[bruv-claude-compat] No configured authentication <FIXTURE> <FIXTURE>",
      "[bruv-claude-compat] Unknown connector option: --example",
    ],
  );
  assert.ok(records.every((x) => x.instance === "root"));
  assert.ok(!records.some((x) => x.kind === "scope"));
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`tap forwards ${signal} to its connector and records actual signal exit`, { timeout: 5000 }, async (t) => {
    const fixture = await launch(
      t,
      String.raw`
      process.stderr.write("ready\n");
      setInterval(() => {}, 1000);
    `,
    );
    await once(fixture.proc.stderr, "data");
    fixture.proc.kill(signal);
    assert.deepEqual(await fixture.closed, { code: 1, signal: null });
    const records = await fixture.records();
    assert.deepEqual(records.at(-1).value, { event: "exit", code: null, signal });
    const pid = records[0].owner;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  });
}

test("connector spawn failure records error and close without claiming a successful exit", {
  timeout: 5000,
}, async (t) => {
  const fixture = await launch(t, "", { connector: "/nonexistent-owned-tap-connector" });
  fixture.proc.stdin.end();
  assert.deepEqual(await fixture.closed, { code: 254, signal: null });
  const records = await fixture.records();
  assert.equal(records[0].value.event, "spawn");
  assert.equal(records[1].value.event, "error");
  assert.match(records[1].value.message, /ENOENT/);
  assert.deepEqual(records[2].value, { event: "exit", code: -2, signal: null });
});
