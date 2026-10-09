// Explicit local artifacts only; no SDK patch, global install, or real provider.
// Run with Bun: BRUV_CLAUDE_SDK_PATH=/absolute/sdk.mjs BRUV_CLAUDE_COMPAT_TEST_BINARY=/absolute/dist/bruv-claude-compat bun scripts/claude-native-acceptance/wrapper-sdk-smoke.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
const sdkPath = process.env.BRUV_CLAUDE_SDK_PATH;
const binary = process.env.BRUV_CLAUDE_COMPAT_TEST_BINARY;
assert.ok(sdkPath && isAbsolute(sdkPath), "Explicit absolute SDK path required");
assert.ok(binary && isAbsolute(binary), "Explicit absolute actual built wrapper required");
const metadata = JSON.parse(await readFile(join(dirname(sdkPath), "package.json"), "utf8"));
assert.equal(metadata.name, "@anthropic-ai/claude-agent-sdk");
assert.equal(metadata.version, "0.3.276");
const { query } = await import(pathToFileURL(sdkPath).href);
const root = await mkdtemp(join(tmpdir(), "bruv-wrapper-sdk-"));
const home = join(root, "home"),
  state = join(root, "state");
await mkdir(home);
await mkdir(state);
const requests = [],
  children = [],
  queries = [],
  proof = [];
const held = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    assert.equal(new URL(request.url).pathname, "/v1/chat/completions");
    const body = await request.json();
    requests.push(body);
    const text = JSON.stringify(body.messages);
    if (text.includes("SDK_STOP_HOLD") || text.includes("SDK_EOF_HOLD"))
      await new Promise((resolve) => held.push(resolve));
    const results = body.messages
      .filter((m) => m.role === "tool")
      .map((m) => JSON.stringify(m.content))
      .join("\n");
    let delta;
    if (text.includes("SDK_SHELL") && !results)
      delta = {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "actual-shell",
            type: "function",
            function: {
              name: "execute",
              arguments: JSON.stringify({
                label: "Actual local shell",
                code: 'const r=await shell("printf SDK_ACTUAL_SHELL",{waitSeconds:10}); console.log(JSON.stringify(r));',
              }),
            },
          },
        ],
      };
    else if (text.includes("SDK_SHELL")) {
      assert.ok(results.includes("SDK_ACTUAL_SHELL"), "Actual shell output reached provider");
      delta = { role: "assistant", content: "SDK_SHELL_CONFIRMED" };
    } else delta = { role: "assistant", content: "HELD_RESPONSE_MUST_NOT_COMPLETE" };
    const event = (d, finish_reason) => ({
      id: "loopback-sdk",
      object: "chat.completion.chunk",
      created: 1,
      model: body.model,
      choices: [{ index: 0, delta: d, finish_reason }],
    });
    return new Response(
      `${[event(delta, null), event({}, delta.tool_calls ? "tool_calls" : "stop")]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join("")}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
const timeout = async (promise, label, ms = 15000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const until = async (predicate) => {
  const end = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "Timed out waiting for provider");
    await Bun.sleep(10);
  }
};
await writeFile(
  join(state, "models.json"),
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        api: "openai-completions",
        apiKey: "local-fake-only",
        models: [{ id: "fixture-model", name: "Fixture", contextWindow: 32000, maxTokens: 1024 }],
      },
    },
  }),
);
await writeFile(join(state, "settings.json"), JSON.stringify({ cacheWarming: "off" }));
// The SDK iterator may stop before the wrapper exits. Observe the process separately
// so cancellation cases can prove real EOF, not just iterator completion.
function observeWrapperProcess() {
  let raw = "",
    stderr = "",
    close;
  return {
    // Public SDK spawn hook: pass command/args/env through unchanged.
    spawn(options) {
      assert.equal(options.command, binary);
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        stdio: ["pipe", "pipe", "pipe"],
      });
      children.push(child);
      child.stdout.on("data", (b) => (raw += b));
      child.stderr.on("data", (b) => (stderr += b));
      close = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
      return child;
    },
    get close() {
      return close;
    },
    raw: () => raw,
    stderr: () => stderr,
  };
}
function launch(prompt, spawnClaudeCodeProcess) {
  let stderr = "";
  const q = query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: binary,
      cwd: root,
      model: "fixture/fixture-model",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      stderr: (b) => (stderr += b),
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: home,
        SHELL: "/bin/bash",
        CLAUDE_CONFIG_DIR: join(root, "sdk-home"),
        BRUV_CLAUDE_COMPAT_HOME: state,
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      spawnClaudeCodeProcess,
    },
  });
  queries.push(q);
  const frames = [];
  const done = (async () => {
    for await (const frame of q) frames.push(frame);
  })();
  // q.close intentionally ends the iterator early in the EOF test; preserve error as evidence.
  const settled = done.then(
    () => ({}),
    (error) => ({ error: String(error) }),
  );
  return {
    q,
    frames,
    settled,
    stderr: () => stderr,
  };
}
try {
  const shell = launch("SDK_SHELL: execute the actual shell fixture");
  assert.deepEqual(await timeout(shell.settled, "shell result"), {});
  assert.ok(
    shell.frames.some(
      (f) => f.type === "result" && f.subtype === "success" && f.result.includes("SDK_SHELL_CONFIRMED"),
    ),
    shell.stderr(),
  );
  proof.push({ case: "unmodified SDK default spawn, actual execute/shell", requests: requests.length, exit: 0 });
  const stopProcess = observeWrapperProcess();
  const stop = launch("SDK_STOP_HOLD: hold for SDK interrupt", stopProcess.spawn);
  await until(() => requests.some((r) => JSON.stringify(r.messages).includes("SDK_STOP_HOLD")));
  const start = Date.now();
  await timeout(stop.q.interrupt(), "SDK Stop acknowledgement");
  assert.deepEqual(await timeout(stop.settled, "SDK Stop terminal"), {});
  assert.ok(
    stop.frames.some((f) => f.type === "result" && f.subtype !== "success"),
    stopProcess.raw() + stopProcess.stderr() + stop.stderr(),
  );
  assert.ok(
    !stop.frames.some((f) => f.type === "assistant" && JSON.stringify(f).includes("HELD_RESPONSE_MUST_NOT_COMPLETE")),
  );
  assert.deepEqual(await timeout(stopProcess.close, "Stop EOF", 1800), { code: 0, signal: null });
  proof.push({
    case: "SDK interrupt / Stop",
    durationMs: Date.now() - start,
    result: stop.frames.find((f) => f.type === "result")?.subtype,
    exit: 0,
  });
  const eofProcess = observeWrapperProcess();
  const eof = launch("SDK_EOF_HOLD: hold for SDK close / stdin EOF", eofProcess.spawn);
  await until(() => requests.some((r) => JSON.stringify(r.messages).includes("SDK_EOF_HOLD")));
  const eofStart = Date.now();
  eof.q.close();
  assert.deepEqual(await timeout(eofProcess.close, "actual wrapper EOF before SDK kill grace", 1800), {
    code: 0,
    signal: null,
  });
  await timeout(eof.settled, "EOF iterator");
  assert.ok(
    !eofProcess
      .raw()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .some((f) => f.type === "result" && f.subtype === "success"),
  );
  proof.push({
    case: "SDK close / EOF during active provider",
    durationMs: Date.now() - eofStart,
    exit: 0,
    signal: null,
  });
  console.log(JSON.stringify({ sdk: metadata.version, binary, proof }, null, 2));
} finally {
  for (const q of queries) q.close();
  for (const resolve of held) resolve();
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
