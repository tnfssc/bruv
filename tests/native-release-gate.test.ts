import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Unit fixtures test orchestration only, never count as native acceptance evidence.
async function fixture(failSuite?: string, afterResult = "") {
  const root = await mkdtemp(path.join(tmpdir(), "bruv-release-gate-unit-"));
  await mkdir(path.join(root, "scripts/claude-native-acceptance"), { recursive: true });
  const proof = path.join(root, "wisdom/claude-compat/proof/official-2644");
  await mkdir(proof, { recursive: true });
  const sdk = path.join(root, "sdk");
  await mkdir(sdk);
  await writeFile(path.join(sdk, "sdk.mjs"), "// unit fixture, not SDK runtime proof");
  await writeFile(
    path.join(sdk, "package.json"),
    JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version: "0.3.276" }),
  );
  const upstream = path.join(root, "upstream");
  await mkdir(path.join(upstream, "platform"), { recursive: true });
  const bytes = "unit-test-only executable";
  const hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path.join(upstream, "platform/t3"), bytes);
  await writeFile(
    path.join(proof, "provenance.json"),
    JSON.stringify({
      officialRelease: "unit fixture",
      officialSource: "unit source",
      archiveSha256: "unit archive",
      t3BinarySha256AfterAllGates: hash,
    }),
  );
  await writeFile(
    path.join(root, "scripts/run-native-release-gate.mjs"),
    await Bun.file(new URL("../scripts/run-native-release-gate.mjs", import.meta.url)).text(),
  );
  const child = [
    "import fs from 'node:fs/promises'; import path from 'node:path';",
    "const proof = process.env.PROOF_OUTPUT, name = path.basename(proof);",
    "await fs.mkdir(proof);",
    "await fs.appendFile(path.join(path.dirname(proof), 'calls.ndjson'), JSON.stringify({",
    "name, trace: process.env.TRACE_SUITE, app: process.env.ACCEPT_APP_DELEGATION,",
    "human: process.env.ACCEPT_HUMAN_CONTROLS, permission: process.env.ACCEPT_PERMISSION,",
    "question: process.env.ACCEPT_SAVED_QUESTION, connector: process.env.BRUV_CONNECTOR_EXECUTABLE,",
    "worker: process.env.BRUV_RUNTIME_BINARY, }) + '\\n');",
    "await fs.writeFile(path.join(proof, 'result.json'), JSON.stringify({",
    "passed: name !== " +
      JSON.stringify(failSuite) +
      ", upstreamUnmodified: true, t3BinarySha256: " +
      JSON.stringify(hash) +
      "}));",
    afterResult,
  ].join("\n");
  await writeFile(path.join(proof, "run-trace.mjs"), child);
  await writeFile(path.join(root, "scripts/claude-native-acceptance/run.mjs"), child);
  const output = path.join(root, "output");
  return {
    root,
    sdk,
    upstream,
    output,
    run: async () => {
      const node = Bun.which("node");
      if (!node) throw Error("Node is required for release-gate orchestration tests");
      const proc = Bun.spawn([node, path.join(root, "scripts/run-native-release-gate.mjs")], {
        env: {
          PATH: "/usr/bin:/bin",
          T3_UPSTREAM: upstream,
          BRUV_CLAUDE_SDK_PATH: path.join(sdk, "sdk.mjs"),
          PROOF_OUTPUT: output,
          BRUV_CONNECTOR_EXECUTABLE: "/actual/paired/connector",
          BRUV_RUNTIME_BINARY: "/actual/paired/bruv",
          BROWSER_PATH: "/test/browser",
          TRACE_SUITE: "stale",
          ACCEPT_APP_DELEGATION: "1",
          ACCEPT_HUMAN_CONTROLS: "1",
          ACCEPT_PERMISSION: "1",
          ACCEPT_SAVED_QUESTION: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
        new Response(proc.stdout).text(),
      ]);
      return { exitCode, stderr };
    },
  };
}

test("release gate composes every strict suite with isolated flags and the actual pair", async () => {
  const f = await fixture();
  try {
    expect((await f.run()).exitCode).toBe(0);
    const calls = (await readFile(path.join(f.output, "calls.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.map((c) => c.name)).toEqual([
      "command",
      "local-child",
      "human",
      "app-delegation",
      "default-controls",
      "command-final",
    ]);
    expect(calls.map((c) => c.trace)).toEqual(["command", "subagent", "human", undefined, undefined, "command"]);
    expect(calls.map((c) => c.human)).toEqual([undefined, undefined, "1", undefined, undefined, undefined]);
    expect(calls.map((c) => c.app)).toEqual([undefined, undefined, undefined, "1", undefined, undefined]);
    for (const call of calls) {
      expect(call.permission).toBeUndefined();
      expect(call.question).toBeUndefined();
      expect(call.connector).toBe("/actual/paired/connector");
      expect(call.worker).toBe("/actual/paired/bruv");
    }
    expect(JSON.parse(await readFile(path.join(f.output, "gate.json"), "utf8"))).toMatchObject({
      passed: true,
      dependencyQueueRaceFixed: false,
    });
    expect((await f.run()).exitCode).not.toBe(0); // Existing proof is never overwritten.
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("a failing strict result prevents later suites and passing release evidence", async () => {
  const f = await fixture("human");
  try {
    const result = await f.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("human did not produce passing");
    const calls = (await readFile(path.join(f.output, "calls.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.map((c) => c.name)).toEqual(["command", "local-child", "human"]);
    expect(await Bun.file(path.join(f.output, "gate.json")).exists()).toBe(false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("an unpinned upstream executable is rejected before a server or proof starts", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.upstream, "platform/t3"), "older or modified binary");
    const result = await f.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Not unchanged official");
    expect(await Bun.file(path.join(f.output, "calls.ndjson")).exists()).toBe(false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}, 30_000);

test("wrong history SDK fails before any native suite starts", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.sdk, "package.json"),
      JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version: "0.0.0" }),
    );
    const result = await f.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Native history gate requires SDK 0.3.276");
    expect(await Bun.file(path.join(f.output, "calls.ndjson")).exists()).toBe(false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}, 30_000);

for (const [label, stop] of [
  ["nonzero exit", "process.exit(7)"],
  ["signal termination", "process.kill(process.pid, 'SIGTERM')"],
]) {
  test(`valid suite evidence cannot override ${label}`, async () => {
    const f = await fixture(undefined, stop);
    try {
      const result = await f.run();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("command native gate failed");
      const calls = (await readFile(path.join(f.output, "calls.ndjson"), "utf8")).trim().split("\n");
      expect(calls).toHaveLength(1);
      expect(await Bun.file(path.join(f.output, "command/result.json")).exists()).toBe(true);
      expect(await Bun.file(path.join(f.output, "gate.json")).exists()).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30_000);
}

test("a suite cannot hide upstream mutation behind passing pinned evidence", async () => {
  const f = await fixture(
    undefined,
    "await fs.writeFile(path.join(process.env.T3_UPSTREAM, 'platform/t3'), 'modified during suite');",
  );
  try {
    const result = await f.run();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Not unchanged official");
    const calls = (await readFile(path.join(f.output, "calls.ndjson"), "utf8")).trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(f.output, "command/result.json"), "utf8")).passed).toBe(true);
    expect(await Bun.file(path.join(f.output, "gate.json")).exists()).toBe(false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}, 30_000);
