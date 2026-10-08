import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { launchPolicy, nativeStorage, permissionBinding, mcpFactory } from "../../src/claude-compat/binding";
import { parseConnectorArguments } from "../../src/claude-compat/arguments";
import { InjectedMcpSession } from "../../src/claude-compat/mcp";
import { NativeHistory, readNativeHistory } from "../../src/claude-compat/history";
import { createClaudeCompatRuntime } from "../../src/claude-compat/runtime";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai/compat";

// Connector startup installs disk history before shake accounting. SDK prototypes
// are process-global; do not inherit (or leak) another test suite's wrappers.
if (process.env.BRUV_TEST_COMPAT_RUNTIME_CHILD !== import.meta.path) {
  test("connector regressions in an isolated SDK process", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BRUV_TEST_COMPAT_RUNTIME_CHILD: import.meta.path, HERDR_ENV: "0" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stdout + stderr).toBe(0);
  }, 120000);
} else {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  const flags = ["--input-format", "stream-json", "--output-format", "stream-json"];
  const parse = (args: string[]) => parseConnectorArguments([...flags, ...args]);
  async function home() {
    const dir = await mkdtemp(join(tmpdir(), "bruv-composition-"));
    dirs.push(dir);
    return { cwd: dir, agentDir: join(dir, "agent"), configDir: join(dir, "sdk-home") };
  }
  function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop") {
    const message: AssistantMessage = {
      role: "assistant",
      provider: "bruv-composition",
      model: "exact-model",
      api: "openai-completions",
      timestamp: Date.now(),
      content,
      stopReason,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: stopReason === "toolUse" ? "toolUse" : "stop", message });
    return stream;
  }

  async function createOfflineModelRuntime(agentDir: string) {
    await Bun.write(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "bruv-composition": {
            api: "openai-completions",
            baseUrl: "http://127.0.0.1:1",
            apiKey: "local-test-only",
            models: [
              {
                id: "exact-model",
                name: "Exact local fixture",
                reasoning: false,
                input: ["text"],
                contextWindow: 16000,
                maxTokens: 512,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      }),
    );
    return ModelRuntime.create({
      modelsPath: join(agentDir, "models.json"),
      authPath: join(agentDir, "auth.json"),
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
  }

  test("observed native settings map to the selected tool policy", () => {
    const policy = launchPolicy(
      parse([
        "--settings",
        '{"disableAllHooks":true,"permissions":{"allow":["Bash(*)"],"deny":["Write"]},"env":{"ENABLE_CLAUDEAI_MCP_SERVERS":"false","CLAUDE_CODE_AUTO_CONNECT_IDE":"0","CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL":"1"}}',
        "--setting-sources",
        "user,project,local",
      ]),
    );
    expect(policy.allowedTools).toEqual(["bash"]);
    expect(policy.disallowedTools).toEqual(["write"]);
    expect(policy.tools).toBeUndefined();
  });

  test("Bash preapproval does not authorize arbitrary Bruv execute code", async () => {
    let asks = 0;
    const gate = permissionBinding(parse(["--allowedTools", "Bash(*)"]), async () => {
      asks++;
      return { behavior: "deny" };
    });
    expect(
      await gate.authorize({
        toolName: "execute",
        input: { code: "return 1" },
        toolUseId: "actual",
        effect: "arbitrary-typescript",
        owner: "bruv",
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ behavior: "deny" });
    expect(asks).toBe(1);
  });

  test("thinking flags and settings resolve together and reject conflicting display choices", () => {
    expect(
      launchPolicy(
        parse([
          "--thinking",
          "adaptive",
          "--thinking-display",
          "summarized",
          "--thinking-display",
          "summarized",
          "--settings",
          '{"showThinkingSummaries":true}',
        ]),
      ),
    ).toMatchObject({ thinking: "high", thinkingDisplay: "summarized" });
    expect(launchPolicy(parse(["--settings", '{"alwaysThinkingEnabled":true}']))).toMatchObject({ thinking: "high" });
    expect(launchPolicy(parse(["--thinking", "adaptive", "--effort", "low"]))).toMatchObject({ thinking: "low" });
    expect(() => parse(["--thinking-display", "summarized", "--thinking-display", "omitted"])).toThrow("Conflicting");
  });

  test("unsupported launch settings are rejected rather than inherited", () => {
    expect(launchPolicy(parse(["--settings", '{"fastMode":true}']))).toMatchObject({ fastMode: true });
    for (const settings of ['{"hooks":{}}', '{"env":{"OPENAI_API_KEY":"not-a-real-key"}}'])
      expect(() => launchPolicy(parse(["--settings", settings]))).toThrow("Unsupported");
  });

  test("durable native UUID resumes the exact canonical Pi session, checkpoints branch by real source IDs", async () => {
    const options = await home(),
      sessionId = randomUUID();
    const storage = await nativeStorage(parse(["--session-id", sessionId]), options);
    const first = storage.manager.appendMessage({ role: "user", content: "repeat", timestamp: 1 });
    const second = storage.manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "repeat" }],
      timestamp: 2,
      model: "fixture",
      provider: "fixture",
      api: "openai-completions",
      stopReason: "stop",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const firstUuid = await storage.history!.append({
      sourceMessageId: first,
      type: "user",
      message: { role: "user", content: "repeat" },
      timestamp: new Date(1).toISOString(),
    });
    const checkpoint = await storage.history!.append({
      sourceMessageId: second,
      type: "assistant",
      message: { role: "assistant", model: "fixture/fixture", content: [{ type: "text", text: "repeat" }] },
      timestamp: new Date(2).toISOString(),
    });
    storage.manager.appendMessage({ role: "user", content: "later", timestamp: 3 });
    const resume = await nativeStorage(parse(["--resume", sessionId]), options);
    expect(resume.manager.getSessionId()).toBe(storage.manager.getSessionId());
    const at = await nativeStorage(parse(["--resume", sessionId, "--resume-session-at", checkpoint]), options);
    expect(at.manager.getLeafId()).toBe(second);
    expect(at.parentUuid).toBe(checkpoint);
    expect(firstUuid).not.toBe(checkpoint);
    await expect(nativeStorage(parse(["--session-id", sessionId]), options)).rejects.toThrow("already exists");
    await expect(
      nativeStorage(parse(["--resume", sessionId]), { ...options, configDir: join(options.cwd, "wrong-sdk-home") }),
    ).rejects.toThrow("home/cwd");
  });

  test("native SDK-shaped fork imports fresh Pi history and never task/question/agent ownership", async () => {
    const options = await home(),
      sessionId = randomUUID();
    const old = SessionManager.create(options.cwd, join(options.agentDir, "old"));
    old.appendCustomEntry("bruv-agent", { type: "orchestrator", depth: 2 });
    old.appendCustomEntry("bruv-question", { id: "old-question" });
    old.appendCustomEntry("bruv-task", { id: "old-job" });
    const native = await NativeHistory.open({ ...options, sessionId, sourceSessionId: old.getSessionId() });
    await native.append({
      sourceMessageId: "old-user-entry",
      type: "user",
      message: { role: "user", content: "fork context" },
      timestamp: new Date().toISOString(),
    });
    await native.append({
      sourceMessageId: "old-answer-entry",
      type: "assistant",
      message: { role: "assistant", model: "fixture/model", content: [{ type: "text", text: "fork answer" }] },
      timestamp: new Date().toISOString(),
    });
    const fork = await nativeStorage(parse(["--resume", sessionId]), options);
    expect(fork.manager.getSessionId()).not.toBe(old.getSessionId());
    const custom = fork.manager.getEntries().filter((e) => e.type === "custom");
    expect(custom.map((e) => e.customType)).toEqual(["bruv-native-import", "bruv-native-entry-map"]);
    expect(JSON.stringify(fork.manager.getEntries())).not.toContain("old-job");
    const reopened = await nativeStorage(parse(["--resume", sessionId]), options);
    expect(reopened.manager.getSessionId()).toBe(fork.manager.getSessionId());
    expect((await readNativeHistory(native.options)).map((e) => e.bruv!.sourceMessageId)).toEqual([
      "old-user-entry",
      "old-answer-entry",
    ]);
  });

  test("injected stdio MCP is selected separately, gated in real Pi tool execution and closed with the runtime", async () => {
    const options = await home();
    const modelRuntime = await createOfflineModelRuntime(options.agentDir);
    const mcp = await InjectedMcpSession.open(
      {
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [resolve("tests/claude-compat/fixtures/stdio-mcp.ts")],
            env: { FIXTURE_AUTH: "scoped-fixture-auth" },
          },
        },
      },
      {
        cwd: options.cwd,
        appOwnedServers: [],
        policy: { authorizeServer: async () => true, authorizeTool: async () => ({ behavior: "allow" }) },
      },
    );
    const frames: Record<string, any>[] = [];
    const runtime = await createClaudeCompatRuntime({
      ...options,
      modelRuntime,
      model: "bruv-composition/exact-model",
      settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }),
      sessionManager: SessionManager.inMemory(options.cwd),
      permissionMode: "default",
      mcp,
      extensionFactories: [{ name: "injected-mcp", factory: mcpFactory(mcp), hidden: true }],
      tools: ["mcp__fixture__environment"],
      emit: (f) => {
        frames.push(f);
      },
    });
    try {
      const initialized = await runtime.controls.initialize!(
        { type: "control_request", request_id: "init", request: { subtype: "initialize" } },
        new AbortController().signal,
      );
      expect(initialized.models).toContainEqual({
        value: "bruv-composition/exact-model",
        displayName: "Exact local fixture (bruv-composition)",
        description: "Bruv configured model; provider access unverified",
      });
      let calls = 0;
      runtime.session.agent.streamFunction = () =>
        calls++ === 0
          ? reply(
              [{ type: "toolCall", id: "actual-mcp-call", name: "mcp__fixture__environment", arguments: {} }],
              "toolUse",
            )
          : reply([{ type: "text", text: "MCP observed" }]);
      await runtime.onUser(
        { type: "user", parent_tool_use_id: null, message: { role: "user", content: "Call selected MCP" } },
        new AbortController().signal,
      );
      const result = frames.find((f) => f.type === "user");
      const value = JSON.parse(result!.message.content[0].content[0].text);
      expect(value.configured).toBe("scoped-fixture-auth");
      expect(value.inheritedProvider).toBeUndefined();
      expect(value.controls).toEqual([]);
      expect(result!.message.content[0].tool_use_id).toBe("actual-mcp-call");
      expect(JSON.stringify(frames.filter((f) => f.type === "system"))).not.toContain("scoped-fixture-auth");
      await runtime.close();
      expect(mcp.status().every((s) => s.status === "closed")).toBe(true);
      expect(() => process.kill(value.pid, 0)).toThrow();
    } finally {
      await runtime.close();
    }
  });

  test("empty native session has durable canonical identity before the first provider response", async () => {
    const options = await home(),
      sessionId = randomUUID();
    const created = await nativeStorage(parse(["--session-id", sessionId]), options);
    expect(JSON.parse((await readFile(created.manager.getSessionFile()!, "utf8")).trim()).id).toBe(
      created.manager.getSessionId(),
    );
    const resumed = await nativeStorage(parse(["--resume", sessionId]), options);
    expect(resumed.manager.getSessionId()).toBe(created.manager.getSessionId());
    expect(resumed.manager.getEntries()).toEqual([]);
  });
}
