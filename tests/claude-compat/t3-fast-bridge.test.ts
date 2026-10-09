import { AuthStorage } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import { expect, spyOn, test } from "bun:test";
import { Type } from "typebox";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runConnector } from "../../src/claude-compat/cli";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { NATIVE_FAST_CHILD_ENV, NATIVE_FAST_ENTRY, nativeFastEnabled } from "../../src/agent/native-fast-mode";
import { createClaudeCompatRuntime, type ClaudeCompatRuntime } from "../../src/claude-compat/runtime";
import { InjectedMcpSession } from "../../src/claude-compat/mcp";
import { JobService } from "../../src/tasks/job-service";
import { TaskManager, type TaskLaunch } from "../../src/tasks/task-manager";
import { httpMcpLifecycleFixture } from "./fixtures/http-mcp-lifecycle";

if (process.env.BRUV_TEST_COMPAT_RUNTIME_CHILD !== import.meta.path) {
  test("automatic T3 Fast bridge in an isolated SDK process", async () => {
    const base = join(process.cwd(), ".tmp");
    await mkdir(base, { recursive: true });
    const home = await mkdtemp(join(base, "t3-fast-home-"));
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          BRUV_TEST_COMPAT_RUNTIME_CHILD: import.meta.path,
          HERDR_ENV: "0",
          HOME: home,
          XDG_CONFIG_HOME: home,
          TMPDIR: home,
        },
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code, stdout + stderr).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 60000);
} else {
  const astra = "openai/gpt-6.1-astra",
    sol = "openai/gpt-6.1-sol";
  const signal = new AbortController().signal;
  const control = (settings: object) => ({
    type: "control_request" as const,
    request_id: randomUUID(),
    request: { subtype: "apply_flag_settings", settings },
  });
  const user = (runtime: ClaudeCompatRuntime, text: string, priority?: "now") => ({
    type: "user" as const,
    uuid: randomUUID(),
    session_id: runtime.session.sessionId,
    parent_tool_use_id: null,
    message: { role: "user" as const, content: text },
    priority,
  });
  function response(
    output: unknown[] = [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] },
    ],
  ) {
    const events = output.flatMap((item, output_index) => [
      { type: "response.output_item.added", output_index, item },
      { type: "response.output_item.done", output_index, item },
    ]);
    events.push({
      type: "response.completed",
      response: {
        status: "completed",
        output,
        usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
      },
    } as any);
    return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  }
  async function until(check: () => boolean) {
    for (let i = 0; i < 500; i++) {
      if (check()) return;
      await Bun.sleep(10);
    }
    throw new Error("Timing checkpoint not reached");
  }
  async function fixture(authenticated = true, fastMode?: boolean, probe?: () => void) {
    const dir = await mkdtemp(join(process.env.TMPDIR!, "bridge-"));
    let fast: boolean | undefined = true,
      selectedModel = astra,
      unavailable = false;
    let releaseRead: (() => void) | undefined;
    let readGate: Promise<void> | undefined;
    const peer = await httpMcpLifecycleFixture({
      threadConfiguration: async () => {
        await readGate;
        if (unavailable) throw new Error("offline config failure");
        return {
          threadId: "current-thread",
          modelSelection: {
            instanceId: "bruv-provider-instance",
            model: selectedModel,
            ...(fast === undefined
              ? {}
              : {
                  options: [
                    { id: "effort", value: "high" },
                    { id: "fastMode", value: fast },
                  ],
                }),
          },
        };
      },
    });
    const config = peer.config;
    if (authenticated)
      Object.assign(config.mcpServers["t3-code"], { headers: { Authorization: "Bearer offline-native-injection" } });
    const authorizeTool = spyOn(
      { authorize: async () => ({ behavior: "deny" as const, message: "model tool denied" }) },
      "authorize",
    );
    const beforeAppOwnedCall = spyOn(
      {
        before: async () => {
          throw new Error("idle model calls denied");
        },
      },
      "before",
    );
    const mcp = await InjectedMcpSession.open(config, {
      cwd: dir,
      appOwnedServers: ["t3-code"],
      selectedTools: [],
      policy: { authorizeServer: async () => true, authorizeTool, beforeAppOwnedCall },
    });
    const models = await ModelRuntime.create({
      credentials: AuthStorage.inMemory({ openai: { type: "api_key", key: "sk-offline" } }),
      modelsPath: null,
      allowModelNetwork: false,
    });
    models.registerProvider("openai", {
      baseUrl: "https://api.openai.com/v1",
      api: "openai-responses",
      models: ["gpt-6.1-astra", "gpt-6.1-sol"].map((id) => ({
        id,
        name: id,
        reasoning: true,
        input: ["text" as const],
        cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 10000,
      })),
    });
    const frames: any[] = [],
      bodies: any[] = [];
    const originalFetch = globalThis.fetch;
    let dispatch: () => Promise<Response> = async () => response();
    globalThis.fetch = (async (url: any, init: any) => {
      if (String(url) !== "https://api.openai.com/v1/responses") return originalFetch(url, init);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-offline");
      bodies.push(JSON.parse(init.body));
      return dispatch();
    }) as typeof fetch;
    const runtime = await createClaudeCompatRuntime({
      cwd: dir,
      agentDir: dir,
      modelRuntime: models,
      model: astra,
      thinkingLevel: "high",
      fastMode,
      mcp,
      authorizeTool: async () => ({ behavior: "allow" }),
      tools: probe ? ["execute", "probe"] : ["execute"],
      extensionFactories: probe
        ? [
            {
              name: "offline-probe",
              factory: (pi) => {
                pi.registerTool({
                  name: "probe",
                  label: "probe",
                  description: "offline probe",
                  parameters: Type.Object({}),
                  execute: async () => {
                    probe();
                    return { content: [{ type: "text", text: "done" }], details: {} };
                  },
                });
              },
            },
          ]
        : [],
      sessionManager: SessionManager.inMemory(dir),
      settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }),
      emit: (frame) => {
        frames.push(frame);
      },
    });
    await runtime.controls.initialize!(
      { type: "control_request", request_id: "init", request: { subtype: "initialize" } },
      signal,
    );
    return {
      dir,
      peer,
      mcp,
      models,
      runtime,
      bodies,
      frames,
      authorizeTool,
      beforeAppOwnedCall,
      select: (value: boolean | undefined, model = astra) => {
        fast = value;
        selectedModel = model;
      },
      fail: () => {
        unavailable = true;
      },
      gateRead: () => {
        readGate = new Promise<void>((done) => {
          releaseRead = done;
        });
      },
      releaseRead: () => {
        releaseRead!();
      },
      dispatch: (fn: () => Promise<Response>) => {
        dispatch = fn;
      },
      close: async () => {
        await runtime.close();
        globalThis.fetch = originalFetch;
        await peer.stopHost();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  test("production connector discovers authenticated T3 Fast without settings or a command", async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR!, "bridge-cli-"));
    const agentDir = join(dir, "bruv-home");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "sk-offline" } }));
    let fast = true;
    const peer = await httpMcpLifecycleFixture({
      threadConfiguration: () => ({
        threadId: "current-thread",
        modelSelection: {
          instanceId: "bruv-provider-instance",
          model: "openai/gpt-5.3-codex",
          options: [{ id: "fastMode", value: fast }],
        },
      }),
    });
    Object.assign(peer.config.mcpServers["t3-code"], { headers: { Authorization: "Bearer offline-native-injection" } });
    const input = new PassThrough(),
      output = new PassThrough(),
      stderr = new PassThrough();
    const frames: any[] = [],
      bodies: any[] = [];
    let pending = "",
      errors = "";
    output.on("data", (data) => {
      pending += data;
      for (let index = pending.indexOf("\n"); index >= 0; index = pending.indexOf("\n")) {
        frames.push(JSON.parse(pending.slice(0, index)));
        pending = pending.slice(index + 1);
      }
    });
    stderr.on("data", (data) => {
      errors += data;
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      if (String(url) !== "https://api.openai.com/v1/responses") return originalFetch(url, init);
      bodies.push(JSON.parse(init.body));
      return response();
    }) as typeof fetch;
    const nativeId = randomUUID();
    const running = runConnector(
      [
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--model",
        "openai/gpt-5.3-codex",
        "--session-id",
        nativeId,
        "--mcp-config",
        JSON.stringify(peer.config),
      ],
      undefined,
      {
        cwd: dir,
        home: dir,
        input,
        output,
        stderr,
        signals: new EventEmitter(),
        env: {
          ...process.env,
          BRUV_CLAUDE_COMPAT_HOME: agentDir,
          BRUV_CLAUDE_COMPAT_BRUV_PATH: process.execPath,
          CLAUDE_CONFIG_DIR: join(dir, "native-history"),
        },
      },
    );
    const send = (frame: object) => input.write(JSON.stringify(frame) + "\n");
    try {
      send({ type: "control_request", request_id: "init", request: { subtype: "initialize" } });
      await until(() => frames.some((frame) => frame.type === "control_response"));
      expect(frames.find((frame) => frame.type === "control_response").response.subtype, errors).toBe("success");
      for (const value of [true, false]) {
        fast = value;
        const prior = frames.filter((frame) => frame.type === "result").length;
        send({
          type: "user",
          uuid: randomUUID(),
          session_id: nativeId,
          parent_tool_use_id: null,
          message: { role: "user", content: "current Fast choice" },
        });
        await until(() => frames.filter((frame) => frame.type === "result").length > prior);
        expect(bodies.at(-1).service_tier).toBe(value ? "priority" : "default");
      }
      expect(peer.configurationCalls).toEqual([{}, {}]);
      input.end();
      expect(await running, errors).toBe(0);
    } finally {
      input.end();
      await running;
      globalThis.fetch = originalFetch;
      await peer.stopHost();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("current saved consent overrides host settings; off and absent clear persisted consent and fresh normal children", async () => {
    const h = await fixture(true, false);
    const manager = new TaskManager(() => {}),
      launches: TaskLaunch[] = [];
    const spawn = spyOn(manager, "spawn").mockImplementation((launch) => {
      launches.push(launch);
      return {
        id: "offline-child",
        kind: "agent",
        command: "test",
        cwd: h.dir,
        status: "running",
        startedAt: new Date().toISOString(),
        baseOffset: 0,
        outputEnd: 0,
        timedOut: false,
      };
    });
    const foreground = spyOn(manager, "foreground").mockResolvedValue({
      id: "offline-child",
      kind: "agent",
      command: "test",
      cwd: h.dir,
      status: "running",
      startedAt: new Date().toISOString(),
      baseOffset: 0,
      outputEnd: 0,
      timedOut: false,
      output: "",
      requestedOffset: 0,
      nextOffset: 0,
      outputLost: false,
      hasMore: false,
      background: true,
    });
    const profiles = join(h.dir, "profiles.json");
    await writeFile(profiles, JSON.stringify({ normal: { model: sol, thinking: "high" } }));
    const service = new JobService(
      manager,
      () => ({ depth: 0 }),
      () => {},
      profiles,
    );
    const ctx = h.runtime.session.extensionRunner.createContext();
    const children: ClaudeCompatRuntime[] = [];
    const launchChild = async (enabled: boolean) => {
      await service.handle("subagent", { type: "normal", prompt: "fresh child", waitSeconds: 0 }, ctx, signal);
      const launch = launches.at(-1)!;
      expect(launch.env?.[NATIVE_FAST_CHILD_ENV]).toBe(enabled ? "1" : "0");
      expect(launch.args).toContain(sol);
      expect(launch.args).toContain("high");
      const oldFast = process.env[NATIVE_FAST_CHILD_ENV],
        oldDepth = process.env.BRUV_SUBAGENT_DEPTH;
      let child: ClaudeCompatRuntime;
      try {
        process.env[NATIVE_FAST_CHILD_ENV] = launch.env![NATIVE_FAST_CHILD_ENV];
        process.env.BRUV_SUBAGENT_DEPTH = launch.env!.BRUV_SUBAGENT_DEPTH;
        child = await createClaudeCompatRuntime({
          cwd: h.dir,
          agentDir: h.dir,
          modelRuntime: h.models,
          model: sol,
          thinkingLevel: "high",
          sessionManager: SessionManager.inMemory(h.dir),
          settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }),
          emit() {},
        });
      } finally {
        if (oldFast === undefined) delete process.env[NATIVE_FAST_CHILD_ENV];
        else process.env[NATIVE_FAST_CHILD_ENV] = oldFast;
        if (oldDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
        else process.env.BRUV_SUBAGENT_DEPTH = oldDepth;
      }
      children.push(child!);
      await child!.controls.initialize!(
        { type: "control_request", request_id: "child-init", request: { subtype: "initialize" } },
        signal,
      );
      await child!.onUser(user(child!, "child request"), signal);
      expect(h.bodies.at(-1).model).toBe("gpt-6.1-sol");
      expect(h.bodies.at(-1).reasoning.effort).toBe("high");
      if (enabled) expect(h.bodies.at(-1).service_tier).toBe("priority");
      else expect(h.bodies.at(-1).service_tier).not.toBe("priority");
      return child!;
    };
    try {
      await h.runtime.onUser(user(h.runtime, "automatic on"), signal);
      expect(h.bodies.at(-1)).toMatchObject({
        model: "gpt-6.1-astra",
        service_tier: "priority",
        reasoning: { effort: "high" },
      });
      expect(nativeFastEnabled(ctx)).toBe(true);
      const enabledChild = await launchChild(true);
      for (const value of [false, undefined]) {
        await h.runtime.controls.apply_flag_settings!(control({ fastMode: true }), signal);
        h.select(value);
        await h.runtime.onUser(user(h.runtime, "current off"), signal);
        expect(h.bodies.at(-1).service_tier).toBe("default");
        expect(nativeFastEnabled(ctx)).toBe(false);
        const saved = h.runtime.session.sessionManager
          .getBranch()
          .filter((entry) => entry.type === "custom" && entry.customType === NATIVE_FAST_ENTRY);
        expect((saved.at(-1) as any).data.enabled).toBe(false);
        await launchChild(false);
      }
      expect(nativeFastEnabled(enabledChild.session.extensionRunner.createContext())).toBe(true);
      await expect(
        h.mcp.callTool("mcp__t3-code__t3_thread_configuration", {}, { toolUseId: "model-call", signal }),
      ).rejects.toThrow("MCP tool is not selected or discovered");
      expect(h.peer.configurationCalls).toEqual([{}, {}, {}]);
      expect(h.authorizeTool).not.toHaveBeenCalled();
      expect(h.beforeAppOwnedCall).not.toHaveBeenCalled();
    } finally {
      spawn.mockRestore();
      foreground.mockRestore();
      await manager.shutdown();
      await Promise.all(children.map((child) => child.close()));
      await h.close();
    }
  });

  test("awaited read precedes dispatch; queued turns sample at consumption, not enqueue; steer and wake do not sample", async () => {
    const h = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let calls = 0;
    h.dispatch(async () => {
      if (++calls === 1) await gate;
      return response();
    });
    h.gateRead();
    try {
      const first = h.runtime.onUser(user(h.runtime, "first"), signal);
      await until(() => h.peer.configurationCalls.length === 1);
      expect(h.bodies).toHaveLength(0);
      h.releaseRead();
      await until(() => h.bodies.length === 1);
      const queued = h.runtime.onUser(user(h.runtime, "queued"), signal);
      await until(() => h.runtime.session.getFollowUpMessages().length === 1);
      expect(h.peer.configurationCalls).toHaveLength(1);
      h.select(false);
      await h.runtime.onUser(user(h.runtime, "steer", "now"), signal);
      expect(h.peer.configurationCalls).toHaveLength(1);
      expect(nativeFastEnabled(h.runtime.session.extensionRunner.createContext())).toBe(true);
      release();
      await Promise.all([first, queued]);
      expect(h.bodies.map((body) => body.service_tier)).toEqual(["priority", "priority", "default"]);
      expect(h.peer.configurationCalls).toEqual([{}, {}]);
      await h.runtime.session.sendCustomMessage(
        { customType: "offline-task-wake", content: "wake", display: false },
        { triggerTurn: true },
      );
      expect(h.peer.configurationCalls).toHaveLength(2);
      expect(h.bodies.at(-1).service_tier).toBe("default");
    } finally {
      h.releaseRead();
      release();
      await h.close();
    }
  });

  test("tool rounds keep the consumed turn's Fast choice", async () => {
    let calls = 0,
      toolCalls = 0;
    const h = await fixture(true, undefined, () => {
      toolCalls++;
      h.select(false);
    });
    h.dispatch(async () =>
      ++calls === 1
        ? response([{ type: "function_call", name: "probe", arguments: "{}", call_id: "probe-call", id: "probe-id" }])
        : response(),
    );
    try {
      await h.runtime.onUser(user(h.runtime, "tool round"), signal);
      expect(toolCalls).toBe(1);
      expect(h.bodies.map((body) => body.service_tier)).toEqual(["priority", "priority"]);
      expect(h.peer.configurationCalls).toEqual([{}]);
      await h.runtime.onUser(user(h.runtime, "fresh turn"), signal);
      expect(h.bodies.at(-1).service_tier).toBe("default");
      expect(h.peer.configurationCalls).toEqual([{}, {}]);
    } finally {
      await h.close();
    }
  });

  test.each(["model", "provider", "unavailable"])(
    "%s config fails visibly and clears stale authorization",
    async (kind) => {
      const h = await fixture(true, true);
      try {
        if (kind === "model") h.select(true, sol);
        else if (kind === "provider") h.select(true, "openai-codex/gpt-6.1-astra");
        else h.fail();
        await h.runtime.onUser(user(h.runtime, "no config consent"), signal);
        expect(h.bodies.at(-1).service_tier).toBe("default");
        expect(nativeFastEnabled(h.runtime.session.extensionRunner.createContext())).toBe(false);
        expect(JSON.stringify(h.frames)).toContain("Fast is off for this turn");
        expect(h.peer.configurationCalls).toHaveLength(1);
      } finally {
        await h.close();
      }
    },
  );

  test("unauthenticated names cannot supply consent; explicit non-T3 host control still works", async () => {
    const h = await fixture(false);
    try {
      await h.runtime.onUser(user(h.runtime, "no consent"), signal);
      expect(h.bodies.at(-1).service_tier).not.toBe("priority");
      expect(h.peer.configurationCalls).toHaveLength(0);
      await h.runtime.controls.apply_flag_settings!(control({ fastMode: true }), signal);
      await h.runtime.onUser(user(h.runtime, "explicit host consent"), signal);
      expect(h.bodies.at(-1).service_tier).toBe("priority");
      expect(h.peer.configurationCalls).toHaveLength(0);
    } finally {
      await h.close();
    }
  });
}
