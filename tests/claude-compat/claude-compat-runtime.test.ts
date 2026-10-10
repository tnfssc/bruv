import { getCurrentSystemPrompt, getCurrentTools, type TranscriptContext } from "@earendil-works/pi-ai";
import { stream as anthropicStream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { expectExecuteOnce } from "../prompts/combined-request";
import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { runConnector } from "../../src/claude-compat/cli";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AssistantMessage, type Context, createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InjectedMcpSession } from "../../src/claude-compat/mcp";
import { mcpFactory } from "../../src/claude-compat/binding";
import { httpMcpLifecycleFixture } from "./fixtures/http-mcp-lifecycle";
import { parseClaudeLine, mightCarryUsage, priceUsage } from "./fixtures/t3-usage";
import { permissionBinding } from "../../src/claude-compat/binding";
import { parseConnectorArguments } from "../../src/claude-compat/arguments";
import { NativeHistory, readNativeHistory } from "../../src/claude-compat/history";
import { GoalStore, latestGoal } from "../../src/goals/store";
import { QuestionService } from "../../src/questions/service";
import type { CompatFrame } from "../../src/claude-compat/frontend";
import {
  type ClaudeCompatRuntime,
  type CompatUserMessage,
  createClaudeCompatRuntime,
} from "../../src/claude-compat/runtime";

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
  const runtimes: ClaudeCompatRuntime[] = [];
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((r) => r.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const usage = {
    input: 11,
    output: 7,
    cacheRead: 3,
    cacheWrite: 2,
    totalTokens: 23,
    cost: { input: 0.001, output: 0.002, cacheRead: 0.003, cacheWrite: 0.004, total: 0.01 },
  };
  function assistant(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
    return {
      role: "assistant",
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
      usage: structuredClone(usage),
      stopReason: "stop",
      ...overrides,
    };
  }
  function output(message: AssistantMessage) {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    if (message.content[0]?.type === "text") {
      stream.push({ type: "text_start", contentIndex: 0, partial: message });
      stream.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message });
      stream.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
    }
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  }
  async function fixture(
    options: { auxiliary?: boolean; auth?: boolean; persistent?: boolean; customPrompt?: string; extra?: object } = {},
  ) {
    const dir = await mkdtemp(join(tmpdir(), "bruv-compat-engine-"));
    dirs.push(dir);
    if (options.customPrompt) await writeFile(join(dir, "SYSTEM.md"), options.customPrompt);
    // This is genuinely locally configured fixture auth, not a hasConfiguredAuth override.
    await writeFile(
      join(dir, "auth.json"),
      JSON.stringify(
        options.auth === false ? {} : { anthropic: { type: "api_key", key: "offline-fixture-not-provider-auth" } },
      ),
      { mode: 0o600 },
    );
    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const frames: CompatFrame[] = [];
    const runner = join(dir, "runner");
    await writeFile(
      runner,
      "#!" +
        process.execPath +
        "\nimport { runTypeScriptFromStdin } from " +
        JSON.stringify(resolve("src/typescript/runner.ts")) +
        "; await runTypeScriptFromStdin(); process.exit(0);\n",
    );
    await chmod(runner, 0o700);
    const runtime = await createClaudeCompatRuntime({
      cwd: dir,
      agentDir: dir,
      modelRuntime,
      model: "anthropic/claude-sonnet-4-5",
      settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }, { projectTrusted: false }),
      sessionManager: options.persistent
        ? SessionManager.create(dir, join(dir, "sessions"))
        : SessionManager.inMemory(dir),
      auxiliary: options.auxiliary,
      permissionMode: "bypassPermissions",
      executablePath: runner,
      emit: (frame) => {
        frames.push(frame);
      },
      ...options.extra,
    });
    runtimes.push(runtime);
    return { dir, runtime, modelRuntime, frames };
  }
  const control = (subtype: string, extra: Record<string, unknown> = {}) => ({
    type: "control_request" as const,
    request_id: "control-1",
    request: { subtype, ...extra },
  });
  const signal = () => new AbortController().signal;
  const user = (
    runtime: ClaudeCompatRuntime,
    text = "hello",
    extra: Record<string, unknown> = {},
  ): CompatUserMessage => ({
    type: "user",
    uuid: "retained-user-id",
    session_id: runtime.session.sessionId,
    parent_tool_use_id: null,
    message: { role: "user", content: text },
    ...extra,
  });
  async function init(runtime: ClaudeCompatRuntime) {
    return runtime.controls.initialize!(control("initialize"), signal());
  }
  async function until(predicate: () => boolean) {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("Fixture checkpoint timed out");
  }

  test("complete native requests keep external prose and schemas through tool and user continuations", async () => {
    const description = "EXTERNAL_DESCRIPTION\nShort words. Short sentences. Plain talk.\nEXTERNAL_DESCRIPTION";
    const schemaDescription = "EXTERNAL_SCHEMA\nEXTERNAL_SCHEMA";
    const peer = await httpMcpLifecycleFixture({ description, schemaDescription });
    const captures: unknown[] = [];
    try {
      for (const appOwned of [false, true])
        for (const customPrompt of [undefined, "USER_BASE\nUSER_BASE"]) {
          const mcp = await InjectedMcpSession.open(peer.config, {
            cwd: process.cwd(),
            appOwnedServers: appOwned ? ["t3-code"] : [],
            policy: {
              authorizeServer: async () => true,
              beforeAppOwnedCall: async () => {},
              authorizeTool: async (request) => ({ behavior: "allow", updatedInput: request.input }),
            },
          });
          try {
            const { runtime, modelRuntime } = await fixture({
              customPrompt,
              extra: {
                mcp,
                appendSystemPrompt: ["USER_APPEND\nUSER_APPEND"],
                extensionFactories: [
                  { name: "external-fixture", factory: mcpFactory(mcp), hidden: true },
                  {
                    name: "final-payload-proof",
                    factory: (pi: ExtensionAPI) => {
                      pi.on("before_provider_request", (event) => ({
                        ...(event.payload as object),
                        metadata: { user_id: "FINAL_HOOK_SENTINEL" },
                      }));
                    },
                    hidden: true,
                  },
                ],
                tools: ["execute", "mcp__t3-code__echo"],
              },
            });
            await init(runtime);
            const contexts: TranscriptContext[] = [];
            const payloads: any[] = [];
            modelRuntime.streamSimple = (async (model: any, context: TranscriptContext, options: any) => {
              contexts.push(structuredClone(context));
              let payload: any;
              for await (const _event of anthropicStream(model, context, {
                ...options,
                apiKey: "offline-fixture",
                onPayload: async (body, requestModel) => {
                  payload = (await options?.onPayload?.(body, requestModel)) ?? body;
                  throw new Error("offline capture");
                },
                fetch: (async () => {
                  throw new Error("unexpected network");
                }) as unknown as typeof fetch,
              })) {
                /* Stop before dispatch, after the final SDK hooks. */
              }
              payloads.push(payload);
              return output(
                contexts.length === 1
                  ? assistant("", {
                      stopReason: "toolUse",
                      content: [
                        {
                          type: "toolCall",
                          id: "external-echo",
                          name: "mcp__t3-code__echo",
                          arguments: { text: "QUOTED_TOOL_DATA" },
                        },
                      ],
                    })
                  : assistant("done"),
              );
            }) as any;
            await runtime.onUser(user(runtime, "FIRST_USER_DATA"), signal());
            await runtime.onUser(user(runtime, "NEXT_USER_DATA"), signal());
            expect(contexts).toHaveLength(3);
            for (const [turn, context] of contexts.entries()) {
              const system = getCurrentSystemPrompt(context.messages);
              const tools = getCurrentTools(context.messages);
              expectExecuteOnce(system, tools);
              expect(tools.map((t) => t.name)).toEqual(["execute", "mcp__t3-code__echo"]);
              const external = tools.find((t) => t.name === "mcp__t3-code__echo")!;
              expect(external.description).toBe(description);
              expect((external.parameters as any).properties.text.description).toBe(schemaDescription);
              expect(system.split("USER_APPEND")).toHaveLength(3);
              if (customPrompt) expect(system.split("USER_BASE")).toHaveLength(3);
              const whole = JSON.stringify(context);
              for (const fact of [
                "shell 3 seconds",
                "one pinned commit",
                "questions.block({",
                "history.search({",
                "repo.read",
              ]) {
                expect(whole.split(fact).length - 1, fact).toBe(1);
              }
              expect(whole.split("EXTERNAL_DESCRIPTION")).toHaveLength(3);
              expect(whole.split("EXTERNAL_SCHEMA")).toHaveLength(3);
              if (turn > 0) expect(whole).toContain("QUOTED_TOOL_DATA");
              if (turn === 2) expect(whole).toContain("NEXT_USER_DATA");
              const payload = payloads[turn];
              expect(payload?.metadata.user_id).toBe("FINAL_HOOK_SENTINEL");
              expect(payload).toBeDefined();
              const wire = JSON.stringify(payload);
              expect(wire.split("EXTERNAL_DESCRIPTION")).toHaveLength(3);
              expect(wire.split("EXTERNAL_SCHEMA")).toHaveLength(3);
              for (const fact of ["shell 3 seconds", "one pinned commit", "questions.block({", "repo.read"]) {
                expect(wire.split(fact).length - 1, fact).toBe(1);
              }
              captures.push({ appOwned, custom: !!customPrompt, turn, context, payload });
            }
          } finally {
            await mcp.close();
          }
        }
      if (process.env.BRUV_REQUEST_CAPTURE_DIR)
        await writeFile(
          join(process.env.BRUV_REQUEST_CAPTURE_DIR, "native-external-requests.json"),
          JSON.stringify(captures, null, 2),
        );
    } finally {
      await peer.stopHost();
    }
  });

  test("selected SDK tools keep their declarations through tool and user continuations", async () => {
    const names = ["execute", "read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];
    const { dir, runtime } = await fixture({ extra: { tools: names } });
    await writeFile(join(dir, "input.txt"), "BUILTIN_QUOTED_DATA");
    await init(runtime);
    const contexts: TranscriptContext[] = [];
    runtime.session.agent.streamFunction = (_model, context) => {
      contexts.push(structuredClone(context));
      return output(
        contexts.length === 1
          ? assistant("", {
              stopReason: "toolUse",
              content: [
                { type: "toolCall", id: "sdk-read", name: "read", arguments: { path: join(dir, "input.txt") } },
              ],
            })
          : assistant("done"),
      );
    };
    await runtime.onUser(user(runtime), signal());
    await runtime.onUser(user(runtime, "continue"), signal());
    expect(contexts).toHaveLength(3);
    for (const context of contexts) {
      const tools = getCurrentTools(context.messages);
      expect(tools.map((tool) => tool.name)).toEqual(names);
      expectExecuteOnce(getCurrentSystemPrompt(context.messages), tools);
      for (const tool of tools)
        expect(tool.description).toBe((runtime.session as any)._toolRegistry.get(tool.name).description);
      expect(JSON.stringify(context).split("shell 3 seconds")).toHaveLength(2);
    }
    expect(JSON.stringify(contexts.at(-1))).toContain("BUILTIN_QUOTED_DATA");
    if (process.env.BRUV_REQUEST_CAPTURE_DIR)
      await writeFile(
        join(process.env.BRUV_REQUEST_CAPTURE_DIR, "sdk-tool-requests.json"),
        JSON.stringify(contexts, null, 2),
      );
  });

  test("actual production initialization is local, publishes exact configured models and no fake account", async () => {
    const fetch = spyOn(globalThis, "fetch").mockImplementation((() => {
      throw new Error("unexpected provider request");
    }) as unknown as typeof globalThis.fetch);
    try {
      const { runtime, frames } = await fixture();
      let calls = 0;
      runtime.session.agent.streamFunction = () => {
        calls++;
        throw new Error("unexpected init model call");
      };
      const initialized = await init(runtime);
      expect(initialized.account).toEqual({});
      expect(initialized.bruv).toMatchObject({
        engine: "pi",
        readiness: { configured: true, provider: "anthropic", model: "claude-sonnet-4-5", access_verified: false },
      });
      expect((initialized.models as any[]).some((m) => m.value === "anthropic/claude-sonnet-4-5")).toBe(true);
      expect((initialized.models as any[]).some((m) => m.value === "default" || m.value === "sonnet")).toBe(false);
      expect(runtime.session.getActiveToolNames()).toEqual(["execute"]);
      expect(frames).toEqual([]);
      expect(calls).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  test("native root and child frames keep one owner on first and later turns", async () => {
    const priorDepth = process.env.BRUV_SUBAGENT_DEPTH;
    const priorType = process.env.BRUV_SUBAGENT_TYPE;
    const captures: unknown[] = [];
    try {
      for (const customPrompt of [undefined, "USER_NATIVE_BASE"])
        for (const role of ["root", "fast", "normal", "orchestrator"]) {
          process.env.BRUV_SUBAGENT_DEPTH = role === "root" ? "0" : "1";
          process.env.BRUV_SUBAGENT_TYPE = role;
          const { runtime } = await fixture({ customPrompt, extra: { appendSystemPrompt: ["USER_NATIVE_APPEND"] } });
          await init(runtime);
          const contexts: TranscriptContext[] = [];
          runtime.session.agent.streamFunction = (_model, context) => {
            contexts.push(structuredClone(context));
            return output(assistant("offline"));
          };
          await runtime.onUser(user(runtime), signal());
          await runtime.onUser(user(runtime, "next turn"), signal());
          expect(contexts).toHaveLength(2);
          for (const context of contexts) {
            const system = getCurrentSystemPrompt(context.messages);
            expectExecuteOnce(system, getCurrentTools(context.messages));
            expect(system.split("USER_NATIVE_APPEND")).toHaveLength(2);
            if (customPrompt) {
              expect(system.split(customPrompt)).toHaveLength(2);
              expect(system).not.toContain("Quick work? Finish it.");
            } else {
              expect(system.split("Short words. Short sentences. Plain talk.")).toHaveLength(2);
            }
            if (role !== "root") expect(system.split("You are a " + role + " sub-agent.")).toHaveLength(2);
            expect(JSON.stringify(context).split("shell 3 seconds")).toHaveLength(2);
          }
          captures.push({ role, custom: !!customPrompt, contexts });
        }
      if (process.env.BRUV_REQUEST_CAPTURE_DIR)
        await writeFile(
          join(process.env.BRUV_REQUEST_CAPTURE_DIR, "native-role-requests.json"),
          JSON.stringify(captures, null, 2),
        );
    } finally {
      if (priorDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
      else process.env.BRUV_SUBAGENT_DEPTH = priorDepth;
      if (priorType === undefined) delete process.env.BRUV_SUBAGENT_TYPE;
      else process.env.BRUV_SUBAGENT_TYPE = priorType;
    }
  });

  test("unconfigured auth is a preflight error; aliases and unsupported policies are explicit failures", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(fixture({ auth: false })).rejects.toThrow("No configured authentication");
      const { runtime } = await fixture();
      await expect(runtime.controls.set_model!(control("set_model", { model: "sonnet" }), signal())).rejects.toThrow(
        "Claude aliases not supported",
      );
      expect(runtime.controls.set_permission_mode).toBeUndefined();
      const gated = await fixture({ extra: { permissionMode: "default" } });
      expect(gated.runtime.session).toBeDefined();
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  test("prompt streams, assistant completion and result carry real usage and assembled Bruv context", async () => {
    const { runtime, frames } = await fixture();
    await init(runtime);
    let captured!: TranscriptContext;
    runtime.session.agent.streamFunction = (_model, context) => {
      captured = context;
      return output(assistant("fixture answer"));
    };
    await runtime.onUser(user(runtime), signal());
    expect(JSON.stringify(captured)).toContain("Quick work? Finish it.");
    expectExecuteOnce(getCurrentSystemPrompt(captured.messages), getCurrentTools(captured.messages));
    expect(frames.some((f) => f.type === "stream_event" && (f.event as any).delta?.text === "fixture answer")).toBe(
      true,
    );
    const result = frames.find((f) => f.type === "result")!;
    expect(result).toMatchObject({
      subtype: "success",
      is_error: false,
      result: "fixture answer",
      num_turns: 1,
      total_cost_usd: 0.01,
      usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    });
    expect(result.duration_api_ms).toBeUndefined();
    expect(await runtime.controls.get_usage!(control("get_usage"), signal())).toMatchObject({ total_cost_usd: 0.01 });
    expect(frames.filter((f) => f.type === "result")).toHaveLength(1);
  });

  test("priority now uses actual Pi steer and one owning run, not abort/restart", async () => {
    const { runtime, frames } = await fixture();
    await init(runtime);
    let calls = 0,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const contexts: Context[] = [];
    runtime.session.agent.streamFunction = (_model, context) => {
      contexts.push(structuredClone(context));
      const stream = createAssistantMessageEventStream();
      if (++calls === 1)
        void gate.then(() => stream.push({ type: "done", reason: "stop", message: assistant("first") }));
      else stream.push({ type: "done", reason: "stop", message: assistant("steered") });
      return stream;
    };
    const steer = spyOn(runtime.session, "steer");
    const first = runtime.onUser(user(runtime, "start"), signal());
    await until(() => calls === 1);
    await runtime.onUser(user(runtime, "STEER_NOW_MARKER", { priority: "now" }), signal());
    expect(steer).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(calls).toBe(2);
    expect(JSON.stringify(contexts[1])).toContain("STEER_NOW_MARKER");
    expect(frames.filter((f) => f.type === "result")).toHaveLength(1);
    expect((frames.find((f) => f.type === "result") as any).result).toBe("steered");
  });

  test("interrupt genuinely aborts Pi, emits failure once and leaves session reusable", async () => {
    const { runtime, frames } = await fixture();
    await init(runtime);
    let calls = 0,
      cancelled = false;
    runtime.session.agent.streamFunction = (_model, _context, options) => {
      calls++;
      const stream = createAssistantMessageEventStream();
      options?.signal?.addEventListener(
        "abort",
        () => {
          cancelled = true;
          stream.push({ type: "error", reason: "aborted", error: assistant("", { stopReason: "aborted" }) });
        },
        { once: true },
      );
      return stream;
    };
    const run = runtime.onUser(user(runtime), signal());
    await until(() => calls === 1);
    await runtime.controls.interrupt!(control("interrupt"), signal());
    await run;
    expect(cancelled).toBe(true);
    expect(runtime.session.isIdle).toBe(true);
    expect(frames.filter((f) => f.type === "result")).toHaveLength(1);
    expect(frames.find((f) => f.type === "result")).toMatchObject({ is_error: true });
    runtime.session.agent.streamFunction = () => output(assistant("reused"));
    await runtime.onUser(user(runtime, "again"), signal());
    expect(frames.filter((f) => f.type === "result")).toHaveLength(2);
  });

  test("app HTTP cleanup can take longer than five seconds within its configured timeout", async () => {
    const peer = await httpMcpLifecycleFixture({ timeout: 15_000 });
    const mcp = await InjectedMcpSession.open(peer.config, {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: {
        authorizeServer: async () => true,
        authorizeTool: async () => ({ behavior: "allow" }),
        beforeAppOwnedCall: async () => {},
      },
    });
    let runtime: ClaudeCompatRuntime | undefined;
    const deliveryErrors: unknown[] = [];
    try {
      const f = await fixture({ extra: { mcp, onOutputError: (error: unknown) => deliveryErrors.push(error) } });
      runtime = f.runtime;
      await init(runtime);
      peer.delayDeletion(6000);
      runtime.session.agent.streamFunction = () => output(assistant("finished provider run"));
      const run = runtime.onUser(user(runtime), signal());
      // Discovery already released one lease. The second DELETE closes this run.
      await until(() => peer.requests.filter((request) => request.method === "DELETE").length === 2);
      expect(peer.activeSessions()).toBe(1);
      expect(f.frames.some((frame) => frame.type === "result")).toBe(false);
      await run;
      expect(peer.activeSessions()).toBe(0);
      expect(deliveryErrors).toHaveLength(0);
      expect(f.frames.filter((frame) => frame.type === "result")).toEqual([
        expect.objectContaining({ subtype: "success", result: "finished provider run" }),
      ]);
      expect(
        f.frames.filter(
          (frame) => frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === "idle",
        ),
      ).toHaveLength(1);
      await runtime.close();
    } finally {
      if (runtime) {
        runtimes.splice(runtimes.indexOf(runtime), 1);
        await runtime.close().catch(() => {});
      }
      await mcp.close().catch(() => {});
      await peer.stopHost();
    }
  }, 20_000);

  test("failed app HTTP release must not publish native idle", async () => {
    const peer = await httpMcpLifecycleFixture();
    const mcp = await InjectedMcpSession.open(peer.config, {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: {
        authorizeServer: async () => true,
        authorizeTool: async () => ({ behavior: "allow" }),
        beforeAppOwnedCall: async () => {},
      },
    });
    let runtime: ClaudeCompatRuntime | undefined;
    const deliveryErrors: unknown[] = [];
    try {
      const f = await fixture({ extra: { mcp, onOutputError: (error: unknown) => deliveryErrors.push(error) } });
      runtime = f.runtime;
      await init(runtime);
      peer.rejectDeletion();
      runtime.session.agent.streamFunction = () => output(assistant("finished provider run"));
      await expect(runtime.onUser(user(runtime), signal())).rejects.toThrow("teardown");
      const results = f.frames.filter((frame) => frame.type === "result");
      const idle = f.frames.filter(
        (frame) => frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === "idle",
      );
      console.log(
        "RELEASE_FAILURE_REPRO",
        JSON.stringify({
          resultFrames: results.length,
          idleFrames: idle.length,
          remoteSessions: peer.activeSessions(),
        }),
      );
      expect(results).toHaveLength(0);
      expect(idle).toHaveLength(0);
      expect(deliveryErrors).toHaveLength(1);
      expect(String(deliveryErrors[0])).toContain("teardown");
      expect(peer.activeSessions()).toBe(1);
    } finally {
      if (runtime) {
        runtimes.splice(runtimes.indexOf(runtime), 1);
        await expect(runtime.close()).rejects.toThrow("Connector teardown failed");
      } else await mcp.close().catch(() => {});
      await peer.stopHost();
    }
  });

  test.each(["human model turn", "human command", "autonomous task wake"])(
    "failed app HTTP release closes native transport and reports shutdown failure: %s",
    async (path) => {
      const peer = await httpMcpLifecycleFixture();
      const mcp = await InjectedMcpSession.open(peer.config, {
        cwd: process.cwd(),
        appOwnedServers: ["t3-code"],
        policy: {
          authorizeServer: async () => true,
          authorizeTool: async () => ({ behavior: "allow" }),
          beforeAppOwnedCall: async () => {},
        },
      });
      const input = new PassThrough();
      let stdout = "",
        stderr = "";
      const frames = () =>
        stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      let runtime: ClaudeCompatRuntime | undefined;
      let calls = 0;
      const providerStarted = Promise.withResolvers<void>();
      const finishProvider = Promise.withResolvers<void>();
      let wake: Promise<void> | undefined;
      try {
        const running = runConnector(
          [
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--permission-mode",
            "bypassPermissions",
            "--allow-dangerously-skip-permissions",
          ],
          async (options) => {
            ({ runtime } = await fixture({
              extra: {
                mcp,
                emit: options.emit,
                onOutputError: options.onOutputError,
                extensionFactories: [{ name: "real-mcp", factory: mcpFactory(mcp), hidden: true }],
                tools: ["mcp__t3-code__echo"],
              },
            }));
            runtime.session.agent.streamFunction = () => {
              calls++;
              if (path === "autonomous task wake" && calls === 1)
                return output(
                  assistant("", {
                    stopReason: "toolUse",
                    content: [
                      {
                        type: "toolCall",
                        id: "autonomous-echo",
                        name: "mcp__t3-code__echo",
                        arguments: { text: "real autonomous echo" },
                      },
                    ],
                  }),
                );
              expect(peer.activeSessions()).toBe(1);
              providerStarted.resolve();
              const stream = createAssistantMessageEventStream();
              void finishProvider.promise.then(() =>
                stream.push({ type: "done", reason: "stop", message: assistant("finished owning run") }),
              );
              return stream;
            };
            return runtime;
          },
          {
            input,
            output: new Writable({
              write(chunk, _encoding, next) {
                stdout += chunk;
                next();
              },
            }),
            stderr: new Writable({
              write(chunk, _encoding, next) {
                stderr += chunk;
                next();
              },
            }),
            cwd: process.cwd(),
            home: "/offline-fixture",
            env: {},
            signals: new EventEmitter(),
          },
        );
        input.write(JSON.stringify(control("initialize")) + "\n");
        await until(() => frames().some((frame) => frame.type === "control_response"));
        expect(runtime).toBeDefined();
        const owner = runtime!;
        if (path === "human command") {
          // A no-model command must still release an existing app lease before idle.
          await mcp.resumeAppOwned();
          peer.rejectDeletion();
          input.write(JSON.stringify(user(owner, "/bruv status")) + "\n");
        } else {
          if (path === "autonomous task wake") {
            // Real Pi custom-message trigger, deliberately no native onUser/flush waiter.
            wake = owner.session.sendCustomMessage(
              { customType: "task-complete", content: "offline task completed", display: false },
              { triggerTurn: true },
            );
          } else input.write(JSON.stringify(user(owner)) + "\n");
          await providerStarted.promise;
          expect(owner.session.isStreaming).toBe(true);
          peer.rejectDeletion();
          finishProvider.resolve();
        }
        // Input remains open: the fatal notification, not EOF or a timer, must end the transport.
        expect(await running).toBe(1);
        await wake;
        expect(calls).toBe(path === "human command" ? 0 : path === "autonomous task wake" ? 2 : 1);
        expect(frames().filter((frame) => frame.type === "result")).toHaveLength(0);
        expect(
          frames().filter(
            (frame) => frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === "idle",
          ),
        ).toHaveLength(0);
        expect(
          frames().filter((frame) => frame.type === "command_lifecycle" && frame.state === "completed"),
        ).toHaveLength(0);
        expect(stderr).toContain("MCP connection teardown was not fully confirmed");
        expect(stderr).toContain("shutdown failed");
        expect(peer.activeSessions()).toBe(1);
        expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(2);
        await expect(owner.close()).rejects.toThrow("Connector teardown failed");
        expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(2);
      } finally {
        input.destroy();
        if (runtime) runtimes.splice(runtimes.indexOf(runtime), 1);
        await peer.stopHost();
      }
    },
  );

  test("app HTTP leases end before native idle, reacquire for the next Pi run, and close after host shutdown", async () => {
    const peer = await httpMcpLifecycleFixture();
    const mcp = await InjectedMcpSession.open(peer.config, {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: {
        authorizeServer: async () => true,
        authorizeTool: async () => ({ behavior: "allow" }),
        beforeAppOwnedCall: async () => {},
      },
    });
    try {
      const frames: CompatFrame[] = [];
      const { runtime } = await fixture({
        extra: {
          mcp,
          extensionFactories: [{ name: "real-mcp", factory: mcpFactory(mcp), hidden: true }],
          tools: ["mcp__t3-code__echo"],
          emit: (frame: CompatFrame) => {
            if (
              frame.type === "result" ||
              (frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === "idle")
            )
              expect(peer.activeSessions()).toBe(0);
            frames.push(frame);
          },
        },
      });
      await init(runtime);
      expect(peer.activeSessions()).toBe(0);
      let calls = 0;
      runtime.session.agent.streamFunction = () => {
        expect(peer.activeSessions()).toBe(1);
        calls++;
        if (calls % 2 === 1)
          return output(
            assistant("", {
              stopReason: "toolUse",
              content: [
                { type: "toolCall", id: "echo-" + calls, name: "mcp__t3-code__echo", arguments: { text: "real echo" } },
              ],
            }),
          );
        return output(assistant("done"));
      };
      await runtime.onUser(user(runtime), signal());
      await runtime.onUser(user(runtime, "again"), signal());
      expect(calls).toBe(4);
      expect(frames.filter((frame) => frame.type === "result").every((frame) => frame.is_error === false)).toBe(true);
      expect(peer.requests.filter((request) => request.rpc === "tools/call")).toHaveLength(2);
      expect(peer.requests.filter((request) => request.rpc === "initialize")).toHaveLength(3);
      expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(3);
      expect(
        new Set(peer.requests.filter((request) => request.method === "DELETE").map((request) => request.session)).size,
      ).toBe(3);
      let started = false,
        cancelled = false;
      runtime.session.agent.streamFunction = (_model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        started = true;
        options?.signal?.addEventListener(
          "abort",
          () => {
            cancelled = true;
            stream.push({ type: "error", reason: "aborted", error: assistant("", { stopReason: "aborted" }) });
          },
          { once: true },
        );
        return stream;
      };
      const interrupted = runtime.onUser(user(runtime, "interrupt this run"), signal());
      await until(() => started);
      expect(peer.activeSessions()).toBe(1);
      await runtime.controls.interrupt!(control("interrupt"), signal());
      await interrupted;
      expect(cancelled).toBe(true);
      expect(peer.activeSessions()).toBe(0);
      expect(frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({ is_error: true });
      runtime.session.agent.streamFunction = () => output(assistant("reused after Stop"));
      await runtime.onUser(user(runtime, "reuse after Stop"), signal());
      expect(frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({ is_error: false });
      expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(5);
      await peer.stopHost(); // reproduces T3 stopping HTTP before the connector
      await runtime.close();
      await runtime.close();
      expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(5);
    } finally {
      await mcp.close();
      await peer.stopHost();
    }
  });

  test("process close shuts down real extensions and is idempotent", async () => {
    const { runtime } = await fixture();
    await init(runtime);
    let shutdowns = 0;
    runtime.session.extensionRunner.onError(() => {});
    const emit = spyOn(runtime.session.extensionRunner, "emit");
    await runtime.close();
    await runtime.close();
    shutdowns = emit.mock.calls.filter((c) => c[0].type === "session_shutdown").length;
    expect(shutdowns).toBe(1);
    await expect(runtime.onUser(user(runtime), signal())).rejects.toThrow("closed");
  });

  test("auxiliary uses the same actual Pi model in a transient tool-free session and validates output", async () => {
    const { runtime, frames } = await fixture({ auxiliary: true });
    let captured!: Context;
    runtime.session.agent.streamFunction = (_model, context) => {
      captured = context;
      return output(assistant('{"title":"Actual fixture title"}'));
    };
    const result = await runtime.runAuxiliary("Generate title", {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    });
    expect(result.structured_output).toEqual({ title: "Actual fixture title" });
    const request = JSON.stringify(captured);
    if (process.env.BRUV_REQUEST_CAPTURE_DIR)
      await Bun.write(
        join(process.env.BRUV_REQUEST_CAPTURE_DIR, "auxiliary-request.json"),
        JSON.stringify(captured, null, 2),
      );
    expect(request.split("Only JSON. Match this schema:").length - 1).toBe(1);
    expect(request).toContain("Answer user request.");
    expect(captured.tools ?? []).toHaveLength(0);
    expect(runtime.session.getActiveToolNames()).toHaveLength(0);
    expect(runtime.session.sessionManager.getSessionFile()).toBeUndefined();
    expect(frames).toEqual([]);
    await expect(runtime.runAuxiliary("again", {})).rejects.toThrow("single-use");
  });

  test("auxiliary refuses invalid structured output and cannot borrow the main session", async () => {
    const { runtime } = await fixture({ auxiliary: true });
    runtime.session.agent.streamFunction = () => output(assistant('{"title":42}'));
    await expect(
      runtime.runAuxiliary("Generate title", {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      }),
    ).rejects.toThrow("does not match JSON schema");
    const main = await fixture();
    await expect(main.runtime.runAuxiliary("Generate title", {})).rejects.toThrow("isolated");
  });

  test("actual Bruv execute tool and task manager share the session; native tool result retains call ID", async () => {
    const { runtime, frames } = await fixture();
    await init(runtime);
    let calls = 0;
    runtime.session.agent.streamFunction = () =>
      output(
        ++calls === 1
          ? assistant("", {
              content: [
                {
                  type: "toolCall",
                  id: "real-execute-call",
                  name: "execute",
                  arguments: { label: "Run deterministic fixture", code: 'console.log("OWNED_ENGINE_MARKER")' },
                },
              ],
              stopReason: "toolUse",
            })
          : assistant("tool finished"),
      );
    await runtime.onUser(user(runtime), signal());
    const tool = frames.find(
      (f) => f.type === "user" && (f.message as any).content[0]?.tool_use_id === "real-execute-call",
    );
    expect(tool).toBeDefined();
    expect(JSON.stringify(tool)).toContain("OWNED_ENGINE_MARKER");
    expect((tool!.message as any).content[0].is_error).toBe(false);
    expect(frames.filter((f) => f.type === "result")).toHaveLength(1);
  });

  for (const operation of ["close", "interrupt"] as const)
    test(operation + " during actual asynchronous Pi preflight cannot start a late provider call", async () => {
      const { runtime, frames } = await fixture();
      await init(runtime);
      let entered = false,
        calls = 0,
        release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = runtime.session.extensionRunner.emitBeforeAgentStart.bind(runtime.session.extensionRunner);
      spyOn(runtime.session.extensionRunner, "emitBeforeAgentStart").mockImplementation(async (...args) => {
        entered = true;
        await gate;
        return original(...args);
      });
      runtime.session.agent.streamFunction = () => {
        calls++;
        return output(assistant("late"));
      };
      const running = runtime.onUser(user(runtime), signal());
      await until(() => entered);
      const ending =
        operation === "close" ? runtime.close() : runtime.controls.interrupt!(control("interrupt"), signal());
      release();
      await ending;
      await running;
      expect(calls).toBe(0);
      expect(frames.filter((f) => f.type === "result")).toHaveLength(1);
      expect(frames.find((f) => f.type === "result")).toMatchObject({ is_error: true });
    });

  test("native process close owns real background shell shutdown; foreground-only interrupt preserves jobs", async () => {
    const { runtime, frames, dir } = await fixture();
    await init(runtime);
    const pidFile = join(dir, "owned-pid");
    let calls = 0;
    const command = "bash -c 'echo $$ > " + JSON.stringify(pidFile) + "; exec sleep 30'";
    runtime.session.agent.streamFunction = () =>
      output(
        ++calls === 1
          ? assistant("", {
              content: [
                {
                  type: "toolCall",
                  id: "background-launch",
                  name: "execute",
                  arguments: {
                    label: "Launch owned test shell",
                    code: "console.log(await shell(" + JSON.stringify(command) + ", { waitSeconds: 0 }))",
                  },
                },
              ],
              stopReason: "toolUse",
            })
          : assistant("shell retained"),
      );
    await runtime.onUser(user(runtime), signal());
    let pid = 0;
    for (let i = 0; i < 100; i++) {
      try {
        pid = Number((await readFile(pidFile, "utf8")).trim());
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).not.toThrow();
    await runtime.controls.interrupt!(control("interrupt"), signal());
    expect(() => process.kill(pid, 0)).not.toThrow();
    await runtime.close();
    expect(() => process.kill(pid, 0)).toThrow();
    expect(JSON.stringify(frames)).toContain("shell retained");
  }, 15000);

  test("real TaskManager idle completion wakes the same Pi owner exactly once", async () => {
    const { runtime, frames } = await fixture();
    await init(runtime);
    let calls = 0;
    const contexts: Context[] = [];
    runtime.session.agent.streamFunction = (_model, context) => {
      contexts.push(structuredClone(context));
      return output(
        ++calls === 1
          ? assistant("", {
              content: [
                {
                  type: "toolCall",
                  id: "wake-launch",
                  name: "execute",
                  arguments: {
                    label: "Launch completion fixture",
                    code: 'console.log(await shell("sleep 0.2; echo COMPLETION_WAKE_MARKER", { waitSeconds: 0 }))',
                  },
                },
              ],
              stopReason: "toolUse",
            })
          : assistant(calls === 2 ? "waiting for owned job" : "owned completion received"),
      );
    };
    await runtime.onUser(user(runtime), signal());
    await until(() => frames.filter((f) => f.type === "result").length === 2);
    expect(calls).toBe(3);
    expect(JSON.stringify(contexts[2])).toContain("COMPLETION_WAKE_MARKER");
    expect(frames.filter((f) => f.type === "result").map((f) => f.result)).toEqual([
      "waiting for owned job",
      "owned completion received",
    ]);
  });

  test("real Pi extension commands terminate native turns without model calls, while unsupported dialogs fail explicitly", async () => {
    const { runtime, frames } = await fixture({
      extra: {
        extensionFactories: [
          {
            name: "deterministic-command-fixture",
            factory: (pi: ExtensionAPI) => {
              pi.registerCommand("fixture-command", {
                description: "Persist a fixture marker",
                handler: async () => {
                  pi.appendEntry("fixture-command", { executed: true });
                },
              });
              pi.registerCommand("fixture-dialog", {
                description: "Request unsupported user interaction",
                handler: async (_args, ctx) => {
                  await ctx.ui.confirm("Confirm", "Fixture question");
                },
              });
            },
          },
        ],
      },
    });
    await init(runtime);
    let calls = 0;
    runtime.session.agent.streamFunction = () => {
      calls++;
      throw new Error("command must not call provider");
    };
    await runtime.onUser(user(runtime, "/fixture-command"), signal());
    expect(calls).toBe(0);
    expect(
      runtime.session.sessionManager.getBranch().some((e) => e.type === "custom" && e.customType === "fixture-command"),
    ).toBe(true);
    expect(frames.filter((f) => f.type === "result")).toHaveLength(1);
    expect(frames.find((f) => f.type === "result")).toMatchObject({ is_error: false, num_turns: 0 });
    await runtime.onUser(user(runtime, "/fixture-dialog"), signal());
    expect(frames.filter((f) => f.type === "result")).toHaveLength(2);
    expect(frames.filter((f) => f.type === "result")[1]).toMatchObject({
      is_error: true,
      errors: ["This connector does not yet support interactive CLI dialogs"],
    });
  });

  test("native identity is retained without renaming the canonical Pi session", async () => {
    const nativeSessionId = "11111111-1111-4111-8111-111111111111";
    const { runtime, frames } = await fixture({ extra: { nativeSessionId } });
    await init(runtime);
    expect(runtime.session.sessionId).not.toBe(nativeSessionId);
    runtime.session.agent.streamFunction = () => output(assistant("native session retained"));
    await runtime.onUser(user(runtime, "hello", { session_id: nativeSessionId }), signal());
    expect(frames.every((frame) => frame.session_id === nativeSessionId)).toBe(true);
    await expect(runtime.onUser(user(runtime), signal())).rejects.toThrow("session_id does not match");
  });

  test("native permission callback gates the actual execute hook, preserves real inputs and accepts updated input", async () => {
    const requests: Record<string, unknown>[] = [];
    const args = parseConnectorArguments([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--allowedTools",
      "Bash(*)",
    ]);
    const binding = permissionBinding(args, async (request) => {
      requests.push(structuredClone(request));
      return {
        behavior: "allow",
        updatedInput: { code: 'console.log("HUMAN_APPROVED_EXECUTION")', label: "Approved by human" },
      };
    });
    const { runtime, frames } = await fixture({
      extra: { permissionMode: "default", authorizeTool: binding.authorize },
    });
    await init(runtime);
    let calls = 0;
    runtime.session.agent.streamFunction = () =>
      calls++ === 0
        ? output(
            assistant("", {
              stopReason: "toolUse",
              content: [
                {
                  type: "toolCall",
                  id: "real-permission-call",
                  name: "execute",
                  arguments: { code: 'throw new Error("ORIGINAL_CODE_MUST_NOT_RUN")', label: "Original" },
                },
              ],
            }),
          )
        : output(assistant("permission complete"));
    await runtime.onUser(user(runtime), signal());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      subtype: "can_use_tool",
      tool_name: "execute",
      tool_use_id: "real-permission-call",
      input: { label: "Original" },
    });
    const result = frames.find((f) => f.type === "user") as any;
    expect(result.message.content[0].content[0].text).toContain("HUMAN_APPROVED_EXECUTION");
    expect(result.message.content[0].is_error).toBe(false);
  });

  test("denied and dontAsk execute calls never run arbitrary code, availability does not preapprove", async () => {
    let asks = 0;
    const args = parseConnectorArguments(["--input-format", "stream-json", "--output-format", "stream-json"]);
    const binding = permissionBinding(args, async () => {
      asks++;
      return { behavior: "deny", message: "Human refusal" };
    });
    const { runtime, frames, dir } = await fixture({
      extra: {
        permissionMode: "default",
        tools: ["execute"],
        authorizeTool: binding.authorize,
        changePermissionMode: binding.setMode,
      },
    });
    await init(runtime);
    expect(runtime.session.getActiveToolNames()).toContain("execute");
    for (const mode of ["default", "dontAsk", "plan"]) {
      if (mode !== "default")
        await runtime.controls.set_permission_mode!(control("set_permission_mode", { mode }), signal());
      let calls = 0;
      runtime.session.agent.streamFunction = () =>
        calls++ === 0
          ? output(
              assistant("", {
                stopReason: "toolUse",
                content: [
                  {
                    type: "toolCall",
                    id: "denied-" + mode,
                    name: "execute",
                    arguments: {
                      code: "await Bun.write(" + JSON.stringify(join(dir, "UNAUTHORIZED")) + ', "bad")',
                      label: "Must deny",
                    },
                  },
                ],
              }),
            )
          : output(assistant("denied"));
      await runtime.onUser(user(runtime), signal());
      const results = frames.filter((f) => f.type === "result") as any[];
      expect(results.at(-1).permission_denials).toHaveLength(1);
    }
    expect(asks).toBe(1);
    expect(await Bun.file(join(dir, "UNAUTHORIZED")).exists()).toBe(false);
    await expect(
      runtime.controls.set_permission_mode!(control("set_permission_mode", { mode: "bypassPermissions" }), signal()),
    ).rejects.toThrow("opt-in");
  });

  test("native saved question callback uses the real owner ledger and human answer, not worker prose", async () => {
    const oldDepth = process.env.BRUV_SUBAGENT_DEPTH;
    process.env.BRUV_SUBAGENT_DEPTH = "0";
    try {
      const qdir = await mkdtemp(join(tmpdir(), "bruv-native-question-root-"));
      dirs.push(qdir);
      const manager = SessionManager.create(qdir, join(qdir, "sessions"));
      const requests: Record<string, unknown>[] = [];
      const { runtime, frames } = await fixture({
        extra: {
          sessionManager: manager,
          request: async (request: Record<string, any>) => {
            requests.push(request);
            const text = request.input.questions[0].question;
            return {
              behavior: "allow",
              toolUseID: request.tool_use_id,
              updatedInput: { answers: { [text]: "Actual human choice" } },
            };
          },
        },
      });
      await init(runtime);
      let calls = 0;
      const contexts: TranscriptContext[] = [];
      runtime.session.agent.streamFunction = (_model, context) => {
        contexts.push(structuredClone(context));
        return calls++ === 0
          ? output(
              assistant("", {
                stopReason: "toolUse",
                content: [
                  {
                    type: "toolCall",
                    id: "question-source-call",
                    name: "execute",
                    arguments: {
                      code: 'const q = await questions.ask({text:"Which branch should I use?", choices:["Actual human choice","Other"]}); console.log(q);',
                      label: "Save genuine question",
                    },
                  },
                ],
              }),
            )
          : output(assistant("question saved"));
      };
      await runtime.onUser(user(runtime), signal());
      await until(() => requests.length === 1);
      expect(requests[0]).toMatchObject({ subtype: "can_use_tool", tool_name: "AskUserQuestion" });
      await until(() => calls >= 3 && runtime.session.isIdle);
      for (const context of contexts) {
        expectExecuteOnce(getCurrentSystemPrompt(context.messages), getCurrentTools(context.messages));
        const whole = JSON.stringify(context);
        expect(whole.split("not the old execute stack or native child.")).toHaveLength(2);
        expect(whole).not.toContain("This saved reply belongs to a new parent turn.");
      }
      const continued = JSON.stringify(contexts.at(-1));
      expect(continued).toContain("Actual human choice");
      expect(continued).toContain("reply_");
      if (process.env.BRUV_REQUEST_CAPTURE_DIR)
        await writeFile(
          join(process.env.BRUV_REQUEST_CAPTURE_DIR, "question-requests.json"),
          JSON.stringify(contexts, null, 2),
        );
      // The human command dispatches the real saved question command, with visible native output and no model call.
      const before = calls;
      await runtime.onUser(user(runtime, "/bruv questions list"), signal());
      expect(calls).toBe(before);
      expect(JSON.stringify(frames.filter((f) => (f.bruv as any)?.human_command)).toLowerCase()).toContain("answered");
    } finally {
      if (oldDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
      else process.env.BRUV_SUBAGENT_DEPTH = oldDepth;
    }
  });

  test("root journals price exact Pi model IDs from actual totals without a rate table", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-root-usage-"));
    dirs.push(dir);
    const manager = SessionManager.create(dir, join(dir, "pi"));
    const nativeId = "55963508-6de0-49c9-a81c-dea90f5cf7e5";
    const history = await NativeHistory.open({
      cwd: dir,
      configDir: join(dir, "native"),
      sessionId: nativeId,
      sourceSessionId: manager.getSessionId(),
    });
    const { runtime } = await fixture({ extra: { sessionManager: manager, nativeSessionId: nativeId, history } });
    await init(runtime);
    const models = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"];
    const costs = [0.031, 0.042, 0];
    let index = 0;
    runtime.session.agent.streamFunction = () => {
      const i = index++;
      return output(
        assistant("offline answer", {
          provider: "openai-codex",
          model: models[i]!,
          usage: { ...usage, cost: { input: costs[i]!, output: 0, cacheRead: 0, cacheWrite: 0, total: costs[i]! } },
        }),
      );
    };
    for (const model of models)
      await runtime.onUser(
        user(runtime, "offline " + model, {
          session_id: nativeId,
          uuid: "00000000-0000-4000-8000-00000000003" + models.indexOf(model),
        }),
        signal(),
      );
    await runtime.close();
    const entries = (await readNativeHistory(history.options)).filter((entry) => entry.type === "assistant");
    expect(entries).toHaveLength(3);
    for (const [i, entry] of entries.entries()) {
      const line = JSON.stringify(entry);
      expect(mightCarryUsage(line, "claude")).toBe(true);
      const parsed = parseClaudeLine(line);
      expect(parsed.dedupeKey).toBe(entry.uuid + ":");
      expect(parsed.model).toBe("openai-codex/" + models[i]);
      expect(parsed.reportedCostUsd).toBe(costs[i]);
      expect(parsed.totals).toMatchObject({
        uncachedInputTokens: 11,
        outputTokens: 7,
        cachedInputTokens: 3,
        cacheCreationTokens: 2,
      });
      expect(priceUsage(new Map(), parsed)).toMatchObject({ costUsd: costs[i], costSource: "providerReported" });
    }
  });

  test("source-entry history stores ordered real repeated messages/tool results and wire UUIDs, resumes Pi context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-composition-history-"));
    dirs.push(dir);
    const manager = SessionManager.create(dir, join(dir, "pi"));
    const nativeId = "55963508-6de0-49c9-a81c-dea90f5cf7e4";
    const history = await NativeHistory.open({
      cwd: dir,
      configDir: join(dir, "native"),
      sessionId: nativeId,
      sourceSessionId: manager.getSessionId(),
    });
    const { runtime, frames } = await fixture({
      extra: { sessionManager: manager, nativeSessionId: nativeId, history, thinkingDisplay: "omitted" },
    });
    await init(runtime);
    let calls = 0;
    runtime.session.agent.streamFunction = () =>
      calls++ === 0
        ? output(
            assistant("", {
              stopReason: "toolUse",
              content: [
                { type: "thinking", thinking: "stored reasoning", thinkingSignature: "stored signature" },
                {
                  type: "toolCall",
                  id: "stored-tool",
                  name: "execute",
                  arguments: { code: 'console.log("HISTORY_RESULT")', label: "History real tool" },
                },
              ],
            }),
          )
        : output(assistant("same prose"));
    await runtime.onUser(
      user(runtime, "same prose", { session_id: nativeId, uuid: "00000000-0000-4000-8000-000000000021" }),
      signal(),
    );
    await runtime.onUser(
      user(runtime, "same prose", { session_id: nativeId, uuid: "00000000-0000-4000-8000-000000000022" }),
      signal(),
    );
    await runtime.close();
    const entries = await readNativeHistory(history.options);
    expect(entries.map((e) => e.type)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    for (const entry of entries) {
      if (entry.type !== "assistant") {
        expect(entry.costUSD).toBeUndefined();
        continue;
      }
      const line = JSON.stringify(entry);
      expect(mightCarryUsage(line, "claude")).toBe(true);
      const parsed = parseClaudeLine(line);
      expect(parsed.dedupeKey).toBe(entry.uuid + ":");
      expect(parsed.model).toBe("anthropic/claude-sonnet-4-5");
      expect(parsed.totals).toMatchObject({
        uncachedInputTokens: 11,
        outputTokens: 7,
        cachedInputTokens: 3,
        cacheCreationTokens: 2,
      });
      expect(priceUsage(new Map(), parsed)).toMatchObject({ costUsd: 0.01, costSource: "providerReported" });
    }
    expect(entries[0]?.uuid).toBe("00000000-0000-4000-8000-000000000021");
    expect(entries[4]?.uuid).toBe("00000000-0000-4000-8000-000000000022");
    expect(new Set(entries.map((e) => e.bruv!.sourceMessageId)).size).toBe(6);
    const canonical = manager.getEntries().filter((e) => e.type === "message" && e.message.role !== "system");
    expect(entries.map((e) => e.bruv!.sourceMessageId)).toEqual(canonical.map((e) => e.id));
    for (let i = 1; i < entries.length; i++) expect(entries[i]!.parentUuid).toBe(entries[i - 1]!.uuid);
    const visible = frames.filter((f) => f.type === "assistant" || f.type === "user");
    for (const frame of visible) expect(entries.some((e) => e.uuid === frame.uuid)).toBe(true);
    expect(entries[1]!.message!.content).toEqual([
      { type: "thinking", thinking: "stored reasoning", signature: "stored signature" },
      {
        type: "tool_use",
        id: "stored-tool",
        name: "execute",
        input: { code: 'console.log("HISTORY_RESULT")', label: "History real tool" },
      },
    ]);
    expect((entries[2]!.message!.content as any[])[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "stored-tool",
      is_error: false,
    });
    for (const frame of visible.filter((frame) => frame.type === "assistant"))
      expect(JSON.stringify(frame.message)).not.toContain("stored reasoning");
    expect(JSON.stringify(entries)).toContain("HISTORY_RESULT");
    const reopened = SessionManager.open(manager.getSessionFile()!);
    expect(
      reopened
        .getEntries()
        .filter((e) => e.type === "message" && e.message.role !== "system")
        .map((e) => e.id),
    ).toEqual(canonical.map((e) => e.id));
  });

  test("turn completion and teardown drain queued history writes and retain the first failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-history-drain-"));
    dirs.push(dir);
    const manager = SessionManager.inMemory(dir);
    const history = await NativeHistory.open({
      cwd: dir,
      configDir: join(dir, "native"),
      sessionId: "00000000-0000-4000-8000-000000000031",
      sourceSessionId: manager.getSessionId(),
    });
    const pending = Promise.withResolvers<string>();
    const firstFailure = new Error("first history write failed");
    const laterFailure = new Error("later history write failed");
    const append = spyOn(history, "append")
      .mockImplementationOnce(() => pending.promise)
      .mockImplementationOnce(() => Promise.reject(laterFailure));
    const { runtime, frames } = await fixture({ extra: { sessionManager: manager, history } });
    await init(runtime);
    runtime.session.agent.streamFunction = () => output(assistant("completed model turn"));
    let turnFinished = false;
    const turn = runtime.onUser(user(runtime), signal()).then(() => {
      turnFinished = true;
    });
    await until(() => frames.some((frame) => frame.type === "result"));
    expect(append.mock.calls).toHaveLength(1);
    expect(turnFinished).toBe(false);
    let closeFinished = false;
    const closing = runtime.close().catch((error) => {
      closeFinished = true;
      return error;
    });
    // This is a held write, not a timer-dependent simulated slow filesystem.
    await Promise.resolve();
    expect(closeFinished).toBe(false);
    pending.reject(firstFailure);
    await turn;
    const error = await closing;
    runtimes.splice(runtimes.indexOf(runtime), 1);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([firstFailure]);
    expect(append.mock.calls.map(([entry]) => entry.type)).toEqual(["user", "assistant"]);
    expect(append.mock.calls[1]![0].parentUuid).toBe(append.mock.calls[0]![0].uuid);
    const canonical = manager
      .getEntries()
      .filter((entry) => entry.type === "message" && ["user", "assistant"].includes(entry.message.role));
    expect(append.mock.calls.map(([entry]) => entry.sourceMessageId)).toEqual(canonical.map((entry) => entry.id));
    // A failed close remains idempotently rejected; cleanup below must not retry it.
    await expect(runtime.close()).rejects.toBe(error);
    append.mockRestore();
  });

  test("received namespaced human command has a correlated native echo, not a model prompt", async () => {
    const { runtime, frames } = await fixture();
    await init(runtime);
    const before = runtime.session.messages.length;
    runtime.session.agent.streamFunction = () => {
      throw new Error("Human command reached model");
    };
    await runtime.onUser(user(runtime, "/bruv status", { uuid: "source-human-command" }), signal());
    expect(frames.find((f) => f.type === "user")).toMatchObject({
      uuid: "source-human-command",
      session_id: runtime.session.sessionId,
      message: { role: "user", content: "/bruv status" },
      parent_tool_use_id: null,
    });
    expect(frames.filter((f) => f.type === "result")).toHaveLength(1);
    expect(frames.find((f) => f.type === "result")).toMatchObject({
      user_message_uuid: "source-human-command",
      user_message_uuids: ["source-human-command"],
      origin: { kind: "human" },
      num_turns: 0,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(frames.filter((f) => f.type === "command_lifecycle")).toMatchObject([
      { command_uuid: "source-human-command", state: "started" },
      { command_uuid: "source-human-command", state: "completed" },
    ]);
    expect(frames.findIndex((f) => f.type === "command_lifecycle")).toBeLessThan(
      frames.findIndex((f) => f.type === "user"),
    );
    expect(frames.findIndex((f) => f.type === "result")).toBeLessThan(frames.findIndex((f) => f.state === "completed"));
    expect(runtime.session.messages).toHaveLength(before);
    runtime.session.agent.streamFunction = () => output(assistant("ordinary follow-up"));
    await runtime.onUser(user(runtime, "continue", { uuid: "next-human-prompt" }), signal());
    expect(frames.filter((f) => f.type === "command_lifecycle")).toHaveLength(2);
    expect(frames.filter((f) => f.type === "result").at(-1)).toMatchObject({
      user_message_uuid: "next-human-prompt",
      user_message_uuids: ["next-human-prompt"],
      origin: { kind: "human" },
    });
  });

  const currentGoal = (runtime: ClaudeCompatRuntime) => latestGoal(runtime.session.sessionManager.getBranch());
  const completeGoal = (id: string) =>
    assistant("", {
      content: [
        {
          type: "toolCall",
          id,
          name: "execute",
          arguments: {
            label: "Record verified goal completion",
            code: 'console.log(await goal.update({ status: "completed", evidence: "Offline acceptance criteria verified" }))',
          },
        },
      ],
      stopReason: "toolUse",
    });

  test("admitted goal work keeps its native owner and app lease while before_agent_start is blocked", async () => {
    const peer = await httpMcpLifecycleFixture();
    const mcp = await InjectedMcpSession.open(peer.config, {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: {
        authorizeServer: async () => true,
        authorizeTool: async () => ({ behavior: "allow" }),
        beforeAppOwnedCall: async () => {},
      },
    });
    const gate = Promise.withResolvers<void>();
    let entered = false;
    let runtime: ClaudeCompatRuntime | undefined;
    let command: Promise<void> | undefined;
    try {
      const f = await fixture({
        persistent: true,
        extra: {
          mcp,
          extensionFactories: [
            { name: "real-mcp", factory: mcpFactory(mcp), hidden: true },
            {
              name: "hold-admitted-goal",
              hidden: true,
              factory: (pi: ExtensionAPI) => {
                pi.on("before_agent_start", async () => {
                  entered = true;
                  await gate.promise;
                });
              },
            },
          ],
        },
      });
      runtime = f.runtime;
      const { frames } = f;
      await init(runtime);
      // Keep an actual app connection open through admission. A premature
      // command result would DELETE this lease before the goal can use it.
      await mcp.resumeAppOwned();
      const deletedBefore = peer.requests.filter((request) => request.method === "DELETE").length;
      expect(peer.activeSessions()).toBe(1);
      let calls = 0;
      runtime.session.agent.streamFunction = () => {
        expect(peer.activeSessions()).toBe(1);
        expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
        calls++;
        if (calls > 2) throw new Error("Admitted goal continued after completion");
        return output(
          calls === 1 ? completeGoal("admitted-goal-complete") : assistant("Admitted goal completed and verified"),
        );
      };
      command = runtime.onUser(
        user(runtime, "/goal set Finish the admitted native objective", { uuid: "admitted-goal-owner" }),
        signal(),
      );
      await until(() => entered);
      await command;
      expect(runtime.session.isIdle).toBe(true);
      expect(calls).toBe(0);
      expect(currentGoal(runtime)?.status).toBe("active");
      expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
      expect(frames.filter((frame) => frame.type === "system" && frame.state === "idle")).toHaveLength(0);
      expect(peer.activeSessions()).toBe(1);
      expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(deletedBefore);

      await runtime.onUser(user(runtime, "/goal status", { uuid: "admission-status-control" }), signal());
      expect(runtime.session.isIdle).toBe(true);
      expect(calls).toBe(0);
      expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
      expect(frames.filter((frame) => frame.type === "system" && frame.state === "idle")).toHaveLength(0);
      expect(peer.activeSessions()).toBe(1);
      expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(deletedBefore);
      expect(
        frames.filter((frame) => frame.type === "command_lifecycle" && frame.command_uuid === "admitted-goal-owner"),
      ).toMatchObject([{ state: "started" }, { state: "completed" }]);
      expect(
        frames.filter(
          (frame) => frame.type === "command_lifecycle" && frame.command_uuid === "admission-status-control",
        ),
      ).toMatchObject([{ state: "started" }, { state: "completed" }]);
      expect(
        frames.some(
          (frame) =>
            frame.type === "assistant" &&
            frame.user_message_uuid === "admission-status-control" &&
            JSON.stringify(frame.message).includes("Status: active"),
        ),
      ).toBe(true);

      await runtime.onUser(user(runtime, "/bruv status", { uuid: "admission-bruv-status" }), signal());
      const status = frames.find(
        (frame) => frame.type === "assistant" && frame.user_message_uuid === "admission-bruv-status",
      )?.message as { content: { text: string }[] };
      expect(JSON.parse(status.content[0].text).running).toBe(true);
      expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);

      gate.resolve();
      await runtime.session.waitForIdle();
      await until(() => frames.some((frame) => frame.type === "result"));
      expect(calls).toBe(2);
      expect(currentGoal(runtime)).toMatchObject({ status: "completed", tokensUsed: 46 });
      expect(frames.filter((frame) => frame.type === "result")).toMatchObject([
        {
          user_message_uuid: "admitted-goal-owner",
          result: "Admitted goal completed and verified",
          is_error: false,
          num_turns: 2,
          total_cost_usd: 0.02,
          usage: { input_tokens: 22, output_tokens: 14, cache_read_input_tokens: 6, cache_creation_input_tokens: 4 },
        },
      ]);
      expect(frames.filter((frame) => frame.type === "system" && frame.subtype === "init")).toHaveLength(1);
      expect(frames.filter((frame) => frame.type === "system" && frame.state === "running")).toHaveLength(1);
      expect(frames.filter((frame) => frame.type === "system" && frame.state === "idle")).toHaveLength(1);
      expect(peer.activeSessions()).toBe(0);
      expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(deletedBefore + 1);
    } finally {
      gate.resolve();
      await command?.catch(() => {});
      await runtime?.session.waitForIdle();
      await runtime?.close();
      await mcp.close();
      await peer.stopHost();
    }
  }, 15_000);

  test("native goal retains one outward turn through automatic Pi turns until completed", async () => {
    const { runtime, frames } = await fixture({ persistent: true });
    await init(runtime);
    const contexts: Context[] = [];
    let calls = 0;
    runtime.session.agent.streamFunction = (_model, context) => {
      contexts.push(structuredClone(context));
      calls++;
      expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
      if (calls > 7) throw new Error("Completed goal kept scheduling provider requests");
      return output(
        calls <= 5
          ? assistant("Completed useful step " + calls)
          : calls === 6
            ? completeGoal("native-goal-complete")
            : assistant("Goal completed and verified"),
      );
    };
    await runtime.onUser(
      user(runtime, "/bruv goal set Finish the offline native acceptance task", { uuid: "set-native-goal" }),
      signal(),
    );
    await runtime.session.waitForIdle();
    await until(
      () => frames.filter((frame) => frame.type === "result").at(-1)?.result === "Goal completed and verified",
    );
    expect(calls).toBe(7);
    expect(currentGoal(runtime)).toMatchObject({
      objective: "Finish the offline native acceptance task",
      status: "completed",
      evidence: "Offline acceptance criteria verified",
    });
    for (const context of contexts.slice(0, 6)) {
      expect(JSON.stringify(context)).toContain("Finish the offline native acceptance task");
      expect(JSON.stringify(context)).toContain("Status: active");
      expect(JSON.stringify(context)).not.toContain("bruv-goal-reminder:");
    }
    const results = frames.filter((frame) => frame.type === "result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      user_message_uuid: "set-native-goal",
      is_error: false,
      num_turns: 7,
      usage: { input_tokens: 77, output_tokens: 49, cache_read_input_tokens: 21, cache_creation_input_tokens: 14 },
    });
    expect(results.every((frame) => frame.is_error === false)).toBe(true);
    expect(frames.filter((frame) => frame.type === "command_lifecycle")).toMatchObject([
      { command_uuid: "set-native-goal", state: "started" },
      { command_uuid: "set-native-goal", state: "completed" },
    ]);
    expect(
      frames.filter(
        (frame) => frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === "idle",
      ),
    ).toHaveLength(results.length);
  }, 15_000);

  test.each(["steer", "followUp"] as const)(
    "native %s input preserves an active goal and the next automatic continuation",
    async (delivery) => {
      const { runtime, frames } = await fixture({ persistent: true });
      await init(runtime);
      let calls = 0;
      let firstStream: ReturnType<typeof createAssistantMessageEventStream> | undefined;
      const contexts: Context[] = [];
      runtime.session.agent.streamFunction = (_model, context, options) => {
        contexts.push(structuredClone(context));
        calls++;
        if (calls === 1) {
          firstStream = createAssistantMessageEventStream();
          options?.signal?.addEventListener(
            "abort",
            () =>
              firstStream?.push({ type: "error", reason: "aborted", error: assistant("", { stopReason: "aborted" }) }),
            { once: true },
          );
          return firstStream;
        }
        if (calls > 4) throw new Error("Goal continuation did not finish");
        return output(
          calls === 2
            ? assistant("Applied the additional user constraint")
            : calls === 3
              ? completeGoal("steered-goal-complete")
              : assistant("Steered goal completed"),
        );
      };
      await runtime.onUser(
        user(
          runtime,
          "/bruv goal set Preserve the original objective while accepting updates --criteria Offline criteria verified --constraints none",
        ),
        signal(),
      );
      expect(currentGoal(runtime), JSON.stringify(frames)).toMatchObject({ status: "active" });
      await until(() => firstStream !== undefined);
      const originalId = currentGoal(runtime)?.id;
      expect(originalId).toBeDefined();
      await runtime.onUser(
        user(runtime, "ADDITIONAL_GOAL_CONSTRAINT: preserve the existing file", {
          uuid: "goal-steering-message",
          ...(delivery === "steer" ? { priority: "now" } : {}),
        }),
        signal(),
      );
      expect(currentGoal(runtime)).toMatchObject({
        id: originalId,
        status: "active",
        objective: "Preserve the original objective while accepting updates",
      });
      firstStream!.push({ type: "done", reason: "stop", message: assistant("First step completed") });
      await runtime.session.waitForIdle();
      await until(() => frames.filter((frame) => frame.type === "result").at(-1)?.result === "Steered goal completed");
      expect(calls).toBe(4);
      expect(JSON.stringify(contexts[1])).toContain("ADDITIONAL_GOAL_CONSTRAINT");
      expect(JSON.stringify(contexts[2])).toContain("Status: active");
      expect(currentGoal(runtime)).toMatchObject({ id: originalId, status: "completed" });
      expect(
        runtime.session.sessionManager
          .getBranch()
          .filter((entry) => entry.type === "custom" && entry.customType === "bruv-goal")
          .some((entry) => (entry as { data: { goal?: { status: string } } }).data.goal?.status === "paused"),
      ).toBe(false);
    },
    15_000,
  );

  test("native stop pauses goal work, and explicit pause/resume preserves the objective and starts a fresh continuation", async () => {
    const { runtime, frames } = await fixture({ persistent: true });
    await init(runtime);
    let calls = 0;
    let started = false;
    runtime.session.agent.streamFunction = (_model, _context, options) => {
      calls++;
      const stream = createAssistantMessageEventStream();
      started = true;
      options?.signal?.addEventListener(
        "abort",
        () => stream.push({ type: "error", reason: "aborted", error: assistant("", { stopReason: "aborted" }) }),
        { once: true },
      );
      return stream;
    };
    await runtime.onUser(
      user(
        runtime,
        "/bruv goal set Finish after the user resumes --criteria Offline criteria verified --constraints none",
      ),
      signal(),
    );
    await until(() => started);
    const originalId = currentGoal(runtime)?.id;
    await runtime.controls.interrupt!(control("interrupt"), signal());
    await runtime.session.waitForIdle();
    expect(currentGoal(runtime)).toMatchObject({ id: originalId, status: "paused" });
    expect(calls).toBe(1);
    expect(frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({ is_error: true });
    await runtime.onUser(user(runtime, "/bruv goal pause Paused explicitly by the user"), signal());
    expect(currentGoal(runtime)).toMatchObject({
      status: "paused",
      pauseReason: "Paused explicitly by the user",
    });
    runtime.session.agent.streamFunction = () => {
      calls++;
      if (calls > 3) throw new Error("Resumed goal kept running after completion");
      return output(calls === 2 ? completeGoal("resumed-goal-complete") : assistant("Resumed goal completed"));
    };
    await runtime.onUser(user(runtime, "/bruv goal resume", { uuid: "resume-native-goal" }), signal());
    await runtime.session.waitForIdle();
    await until(() => frames.filter((frame) => frame.type === "result").at(-1)?.result === "Resumed goal completed");
    expect(currentGoal(runtime)).toMatchObject({
      id: originalId,
      objective: "Finish after the user resumes",
      status: "completed",
    });
    expect(calls).toBe(3);
    expect(frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({
      user_message_uuid: "resume-native-goal",
      is_error: false,
    });
  }, 15_000);

  test("idle native RPC input keeps a restored goal active despite the followUp delivery option", async () => {
    const { runtime } = await fixture({ persistent: true });
    await init(runtime);
    const manager = runtime.session.sessionManager;
    const restored = new GoalStore((type, entry) => manager.appendCustomEntry(type, entry)).set({
      objective: "Complete the restored native goal",
      criteria: ["Offline criteria verified"],
      constraints: [],
    });
    const contexts: Context[] = [];
    let calls = 0;
    runtime.session.agent.streamFunction = (_model, context) => {
      contexts.push(structuredClone(context));
      calls++;
      if (calls > 2) throw new Error("Restored goal kept running after completion");
      return output(calls === 1 ? completeGoal("restored-goal-complete") : assistant("Restored goal completed"));
    };
    await runtime.onUser(user(runtime, "Continue with the restored objective"), signal());
    await runtime.session.waitForIdle();
    expect(JSON.stringify(contexts[0])).toContain("Status: active");
    expect(currentGoal(runtime)).toMatchObject({ id: restored.id, status: "completed" });
    expect(calls).toBe(2);
  }, 15_000);

  test("busy native /goal status reports state without ending or stealing the running goal turn", async () => {
    const { runtime, frames } = await fixture({ persistent: true });
    const initialized = await init(runtime);
    expect(JSON.stringify(initialized)).toContain('"goal"');
    let calls = 0;
    let interrupted = false;
    let held: ReturnType<typeof createAssistantMessageEventStream> | undefined;
    runtime.session.agent.streamFunction = (_model, _context, options) => {
      calls++;
      if (calls === 1) {
        held = createAssistantMessageEventStream();
        options?.signal?.addEventListener(
          "abort",
          () => {
            interrupted = true;
            held?.push({ type: "error", reason: "aborted", error: assistant("", { stopReason: "aborted" }) });
          },
          { once: true },
        );
        return held;
      }
      if (calls > 2) throw new Error("Status read started an extra model run");
      return output(assistant("Original goal turn completed"));
    };
    await runtime.onUser(
      user(runtime, "/goal set Finish the original status-check objective", { uuid: "owning-goal-turn" }),
      signal(),
    );
    await until(() => held !== undefined);
    const resultCount = frames.filter((frame) => frame.type === "result").length;
    await runtime.onUser(user(runtime, "/goal status", { uuid: "goal-status-control" }), signal());
    expect(interrupted).toBe(false);
    expect(calls).toBe(1);
    expect(runtime.session.isStreaming).toBe(true);
    expect(currentGoal(runtime)).toMatchObject({
      status: "active",
      objective: "Finish the original status-check objective",
    });
    expect(
      frames.some(
        (frame) =>
          frame.type === "assistant" &&
          frame.user_message_uuid === "goal-status-control" &&
          JSON.stringify(frame.message).includes("Status: active"),
      ),
    ).toBe(true);
    expect(
      frames.filter((frame) => frame.type === "result" && frame.user_message_uuid === "owning-goal-turn"),
    ).toHaveLength(0);
    expect(
      frames.filter(
        (frame) => frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === "idle",
      ),
    ).toHaveLength(0);
    held!.push({ type: "done", reason: "toolUse", message: completeGoal("busy-status-goal-complete") });
    await runtime.session.waitForIdle();
    await until(() =>
      frames.some((frame) => frame.type === "result" && frame.result === "Original goal turn completed"),
    );
    expect(currentGoal(runtime)?.status).toBe("completed");
    expect(
      frames.filter((frame) => frame.type === "result" && frame.result === "Original goal turn completed"),
    ).toEqual([expect.objectContaining({ user_message_uuid: "owning-goal-turn", is_error: false })]);
    expect(frames.filter((frame) => frame.type === "result").length).toBeGreaterThan(resultCount);
  }, 15_000);

  test.each(["pause", "clear"] as const)(
    "busy native /goal %s stops the owned foreground run and reports the real state",
    async (action) => {
      const { runtime, frames } = await fixture({ persistent: true });
      await init(runtime);
      let calls = 0;
      let cancellations = 0;
      runtime.session.agent.streamFunction = (_model, _context, options) => {
        calls++;
        const stream = createAssistantMessageEventStream();
        options?.signal?.addEventListener(
          "abort",
          () => {
            cancellations++;
            stream.push({ type: "error", reason: "aborted", error: assistant("", { stopReason: "aborted" }) });
          },
          { once: true },
        );
        return stream;
      };
      await runtime.onUser(
        user(runtime, "/goal set Finish the controlled native task", { uuid: "controlled-goal-turn" }),
        signal(),
      );
      await until(() => calls === 1);
      const originalId = currentGoal(runtime)?.id;
      await runtime.onUser(
        user(runtime, action === "pause" ? "/goal pause Paused with native controls" : "/goal clear", {
          uuid: "goal-state-control",
        }),
        signal(),
      );
      await runtime.session.waitForIdle();
      expect(calls).toBe(1);
      expect(cancellations).toBe(1);
      expect(runtime.session.isIdle).toBe(true);
      expect(
        frames.filter((frame) => frame.type === "result" && frame.user_message_uuid === "controlled-goal-turn"),
      ).toEqual([expect.objectContaining({ is_error: true })]);
      expect(
        frames.filter((frame) => frame.type === "result" && frame.user_message_uuid === "goal-state-control"),
      ).toEqual([expect.objectContaining({ is_error: false, num_turns: 0 })]);
      if (action === "clear") {
        expect(currentGoal(runtime)).toBeUndefined();
        return;
      }
      expect(currentGoal(runtime)).toMatchObject({
        id: originalId,
        status: "paused",
        pauseReason: "Paused with native controls",
      });
      runtime.session.agent.streamFunction = () =>
        output(
          ++calls === 2
            ? completeGoal("controlled-resume-complete")
            : assistant("Controlled goal resumed and completed"),
        );
      await runtime.onUser(user(runtime, "/goal resume", { uuid: "controlled-resume" }), signal());
      await runtime.session.waitForIdle();
      await until(() =>
        frames.some((frame) => frame.type === "result" && frame.result === "Controlled goal resumed and completed"),
      );
      expect(calls).toBe(3);
      expect(currentGoal(runtime)).toMatchObject({ id: originalId, status: "completed" });
      expect(frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({
        user_message_uuid: "controlled-resume",
        is_error: false,
      });
    },
    15_000,
  );

  test("native goal survives a provider retry and continues automatically after successful recovery", async () => {
    const { runtime, frames } = await fixture({
      persistent: true,
      extra: {
        settingsManager: SettingsManager.inMemory(
          { cacheWarming: "off", retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
          { projectTrusted: false },
        ),
      },
    });
    await init(runtime);
    let calls = 0;
    const contexts: Context[] = [];
    runtime.session.agent.streamFunction = (_model, context) => {
      contexts.push(structuredClone(context));
      calls++;
      if (calls === 1) {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "error",
          reason: "error",
          error: assistant("", { stopReason: "error", errorMessage: "503 overloaded" }),
        });
        return stream;
      }
      if (calls > 4) throw new Error("Recovered goal failed to finish");
      return output(
        calls === 2
          ? assistant("Provider recovered; goal still has work remaining")
          : calls === 3
            ? completeGoal("recovered-goal-complete")
            : assistant("Recovered goal completed"),
      );
    };
    await runtime.onUser(user(runtime, "/bruv goal set Complete work after the provider recovers"), signal());
    await runtime.session.waitForIdle();
    await until(() => frames.some((frame) => frame.type === "result" && frame.result === "Recovered goal completed"));
    expect(calls).toBe(4);
    expect(JSON.stringify(contexts[2])).toContain("Status: active");
    expect(currentGoal(runtime)?.status).toBe("completed");
    expect(frames.filter((frame) => frame.type === "result").every((frame) => frame.is_error === false)).toBe(true);
  }, 15_000);

  test("native goal budget stops before tool execution, requires an explicit increase to resume, and freezes after completion", async () => {
    const { runtime, frames, dir } = await fixture({ persistent: true });
    await init(runtime);
    const forbiddenArtifact = join(dir, "must-not-execute-after-goal-budget");
    let calls = 0;
    runtime.session.agent.streamFunction = (_model, _context, options) => {
      // Pi drains a cancelled tool batch through the provider with its already
      // aborted signal. Match a provider that refuses that dispatch before any
      // request or token usage, rather than pretending it is another paid call.
      if (options?.signal?.aborted) {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "error",
          reason: "aborted",
          error: assistant("", {
            stopReason: "aborted",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          }),
        });
        return stream;
      }
      calls++;
      if (calls > 1) throw new Error("Exhausted budget started another provider request");
      return output(
        assistant("", {
          content: [
            {
              type: "toolCall",
              id: "must-not-execute-after-budget",
              name: "execute",
              arguments: {
                label: "Tool must not execute after budget exhaustion",
                code: "await Bun.write(" + JSON.stringify(forbiddenArtifact) + ', "unexpected execution")',
              },
            },
          ],
          stopReason: "toolUse",
        }),
      );
    };
    await runtime.onUser(
      user(runtime, "/goal set Complete the bounded native task --tokens 23", { uuid: "budget-goal-start" }),
      signal(),
    );
    await runtime.session.waitForIdle();
    await until(() => frames.some((frame) => frame.type === "result"));
    const exhausted = currentGoal(runtime);
    expect(exhausted).toMatchObject({
      objective: "Complete the bounded native task",
      status: "budget_exceeded",
      tokenBudget: 23,
      tokensUsed: 23,
    });
    await expect(readFile(forbiddenArtifact, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toBe(1);
    expect(runtime.session.isIdle).toBe(true);
    expect(
      frames.some(
        (frame) =>
          frame.type === "assistant" &&
          (frame.bruv as { goal_status?: boolean } | undefined)?.goal_status === true &&
          JSON.stringify(frame.message).includes("Status: budget_exceeded"),
      ),
    ).toBe(true);

    await runtime.onUser(user(runtime, "/goal resume", { uuid: "exhausted-goal-resume" }), signal());
    expect(calls).toBe(1);
    expect(runtime.session.isIdle).toBe(true);
    expect(currentGoal(runtime)).toMatchObject({ id: exhausted?.id, status: "budget_exceeded", tokensUsed: 23 });
    expect(
      frames.some(
        (frame) =>
          frame.type === "assistant" &&
          frame.user_message_uuid === "exhausted-goal-resume" &&
          JSON.stringify(frame.message).includes("Goal token budget is exhausted"),
      ),
    ).toBe(true);

    await runtime.onUser(user(runtime, "/goal budget 100", { uuid: "increase-goal-budget" }), signal());
    expect(currentGoal(runtime)).toMatchObject({
      id: exhausted?.id,
      status: "paused",
      tokenBudget: 100,
      tokensUsed: 23,
    });
    expect(calls).toBe(1);
    expect(runtime.session.isIdle).toBe(true);
    runtime.session.agent.streamFunction = () => {
      calls++;
      if (calls > 3) throw new Error("Completed budgeted goal started another provider request");
      return output(calls === 2 ? completeGoal("budgeted-goal-complete") : assistant("Budgeted goal completed"));
    };
    await runtime.onUser(user(runtime, "/goal resume", { uuid: "increased-goal-resume" }), signal());
    await runtime.session.waitForIdle();
    await until(() => frames.some((frame) => frame.type === "result" && frame.result === "Budgeted goal completed"));
    const completed = currentGoal(runtime);
    expect(completed).toMatchObject({
      id: exhausted?.id,
      status: "completed",
      tokenBudget: 100,
      tokensUsed: 69,
    });
    expect(calls).toBe(3);
    runtime.session.agent.streamFunction = () => {
      calls++;
      return output(assistant("Unrelated follow-up answered"));
    };
    await runtime.onUser(user(runtime, "Answer an unrelated follow-up", { uuid: "unrelated-after-goal" }), signal());
    await runtime.session.waitForIdle();
    expect(calls).toBe(4);
    expect(currentGoal(runtime)).toEqual(completed);
    expect(frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({
      result: "Unrelated follow-up answered",
      user_message_uuid: "unrelated-after-goal",
      is_error: false,
    });
  }, 15_000);

  test("native controls and saved answers stay usable during work without taking ownership of the foreground turn", async () => {
    const oldDepth = process.env.BRUV_SUBAGENT_DEPTH;
    process.env.BRUV_SUBAGENT_DEPTH = "0";
    try {
      const { runtime, frames } = await fixture({
        persistent: true,
        extra: { request: async () => ({ behavior: "deny", message: "Keep pending for an explicit text answer" }) },
      });
      await init(runtime);
      let calls = 0;
      let interrupted = false;
      let held: ReturnType<typeof createAssistantMessageEventStream> | undefined;
      const contexts: Context[] = [];
      runtime.session.agent.streamFunction = (_model, context, options) => {
        calls++;
        contexts.push(structuredClone(context));
        if (calls === 1) {
          return output(
            assistant("", {
              stopReason: "toolUse",
              content: [
                {
                  type: "toolCall",
                  id: "busy-saved-question",
                  name: "execute",
                  arguments: {
                    label: "Save question while doing independent work",
                    code: 'console.log(await questions.ask({text: "Which target should the next step use?"}))',
                  },
                },
              ],
            }),
          );
        }
        if (calls === 2) {
          held = createAssistantMessageEventStream();
          options?.signal?.addEventListener(
            "abort",
            () => {
              interrupted = true;
              held?.push({ type: "error", reason: "aborted", error: assistant("", { stopReason: "aborted" }) });
            },
            { once: true },
          );
          return held;
        }
        if (calls > 3) throw new Error("Saved answer was delivered more than once");
        return output(assistant("Saved answer consumed exactly once"));
      };
      const foreground = runtime.onUser(
        user(runtime, "Begin the foreground task", { uuid: "foreground-control-owner" }),
        signal(),
      );
      await until(() => held !== undefined);
      const ledger = new QuestionService();
      const context = runtime.session.extensionRunner.createCommandContext();
      const question = ledger.list(context).find((item) => item.text === "Which target should the next step use?");
      expect(question?.status).toBe("pending");
      const shortId = question!.id.slice(0, 10);
      const answer = "HUMAN_TARGET: first  choice\n    preserve this indentation";
      const controlsDuringWork = [
        { text: "/bruv help", expected: "/questions open" },
        { text: "/bruv status", expected: '"running": true' },
        { text: "/bruv resources", expected: '"commands"' },
        { text: "/bruv live status", expected: "Live off" },
        { text: "/bruv live capabilities", expected: '"browserAudio":false' },
        { text: "/bruv live stop", expected: "No Live voice session belongs to this agent session" },
        { text: "/mode fast", expected: "Main-agent mode: fast" },
        { text: "/questions list", expected: question!.text },
        { text: "/questions detail " + shortId, expected: question!.text },
        { text: "/questions open " + shortId, expected: question!.text },
        { text: "/questions answer " + shortId + " " + answer, expected: "Answer saved" },
      ];
      for (const [index, command] of controlsDuringWork.entries()) {
        const uuid = "busy-human-control-" + index;
        await runtime.onUser(user(runtime, command.text, { uuid }), signal());
        expect(runtime.session.isStreaming).toBe(true);
        expect(interrupted).toBe(false);
        expect(calls).toBe(2);
        expect(
          frames.some(
            (frame) =>
              frame.type === "assistant" &&
              frame.user_message_uuid === uuid &&
              ((frame.message as { content: Array<{ text?: string }> }).content[0]?.text ?? "").includes(
                command.expected,
              ),
          ),
          command.text +
            ": " +
            JSON.stringify(frames.filter((frame) => frame.type === "assistant" && frame.user_message_uuid === uuid)),
        ).toBe(true);
        expect(
          frames
            .filter((frame) => frame.type === "command_lifecycle" && frame.command_uuid === uuid)
            .map((frame) => frame.state),
        ).toEqual(["started", "completed"]);
        expect(frames.filter((frame) => frame.type === "user" && frame.uuid === uuid)).toHaveLength(1);
        expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
        expect(
          frames.filter(
            (frame) => frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === "idle",
          ),
        ).toHaveLength(0);
      }
      expect(ledger.get(context, question!.id)).toMatchObject({ status: "answered", answer, delivery: "queued" });
      expect(
        runtime.session.sessionManager
          .getBranch()
          .some(
            (entry) =>
              entry.type === "custom" &&
              entry.customType === "bruv-instruction-mode" &&
              (entry.data as { mode?: string }).mode === "fast",
          ),
      ).toBe(true);
      held!.push({ type: "done", reason: "stop", message: assistant("Foreground task finished") });
      await foreground;
      await until(
        () =>
          calls === 3 &&
          runtime.session.isIdle &&
          frames.some((frame) => frame.type === "result" && frame.result === "Saved answer consumed exactly once"),
      );
      const results = frames.filter((frame) => frame.type === "result");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        user_message_uuid: "foreground-control-owner",
        result: "Foreground task finished",
        is_error: false,
      });
      expect(results[1]).toMatchObject({ result: "Saved answer consumed exactly once", is_error: false });
      expect(results[1]).not.toHaveProperty("user_message_uuid");
      expect(JSON.stringify(contexts[2])).toContain("HUMAN_TARGET");
      const deliveries = runtime.session.messages.filter(
        (message) => message.role === "custom" && message.customType === "question-answer",
      );
      expect(deliveries).toHaveLength(1);
      expect(ledger.get(context, question!.id).delivery).toBe("delivered");
      expect(interrupted).toBe(false);
      expect(calls).toBe(3);
    } finally {
      if (oldDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
      else process.env.BRUV_SUBAGENT_DEPTH = oldDepth;
    }
  }, 15_000);

  test.each([
    { name: "unknown command", content: "/bruv unknown-control", expected: "Unavailable Bruv command" },
    { name: "invalid syntax", content: "/bruv:goal123", expected: "Invalid Bruv command syntax" },
    {
      name: "malformed text block",
      content: [
        { type: "text", text: "/bruv status" },
        { type: "text", text: 42 },
      ],
      expected: "text only",
    },
  ])("idle native control error is visible and leaves the next prompt usable: $name", async ({ content, expected }) => {
    const { runtime, frames } = await fixture();
    await init(runtime);
    let calls = 0;
    runtime.session.agent.streamFunction = () => {
      calls++;
      return output(assistant("Ordinary prompt still works"));
    };
    const invalid = user(runtime, "ignored", { uuid: "invalid-idle-control" });
    invalid.message.content = typeof content === "string" ? content : [...content];
    await runtime.onUser(invalid, signal());
    expect(calls).toBe(0);
    expect(runtime.session.isIdle).toBe(true);
    expect(frames.filter((frame) => frame.type === "result")).toEqual([
      expect.objectContaining({
        user_message_uuid: "invalid-idle-control",
        is_error: true,
        num_turns: 0,
        errors: [expect.stringContaining(expected)],
      }),
    ]);
    expect(
      frames.some(
        (frame) =>
          frame.type === "assistant" &&
          frame.user_message_uuid === "invalid-idle-control" &&
          JSON.stringify(frame.message).includes(expected),
      ),
    ).toBe(true);
    await runtime.onUser(user(runtime, "Continue ordinary work", { uuid: "after-invalid-control" }), signal());
    expect(calls).toBe(1);
    expect(frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({
      user_message_uuid: "after-invalid-control",
      is_error: false,
      result: "Ordinary prompt still works",
    });
  });

  test("busy invalid or unavailable controls report isolated errors while the original goal keeps running", async () => {
    const { runtime, frames } = await fixture({ persistent: true });
    await init(runtime);
    let calls = 0;
    let interrupted = false;
    let held: ReturnType<typeof createAssistantMessageEventStream> | undefined;
    runtime.session.agent.streamFunction = (_model, _context, options) => {
      calls++;
      if (calls === 1) {
        held = createAssistantMessageEventStream();
        options?.signal?.addEventListener(
          "abort",
          () => {
            interrupted = true;
            held?.push({ type: "error", reason: "aborted", error: assistant("", { stopReason: "aborted" }) });
          },
          { once: true },
        );
        return held;
      }
      if (calls > 2) throw new Error("Invalid command changed the running goal");
      return output(assistant("Original goal survived invalid controls"));
    };
    await runtime.onUser(
      user(runtime, "/goal set Preserve running work through invalid controls", { uuid: "busy-error-owner" }),
      signal(),
    );
    await until(() => held !== undefined);
    const originalGoal = currentGoal(runtime);
    for (const [index, command] of [
      "/bruv nope",
      "/bruv live start",
      "/bruv live model",
      "/bruv live status extra",
      "/bruv live stop extra",
      "/bruv live capabilities extra",
      "/goal clear extra",
      "/bruv:goal123",
    ].entries()) {
      const uuid = "invalid-busy-control-" + index;
      await runtime.onUser(user(runtime, command, { uuid }), signal());
      expect(interrupted).toBe(false);
      expect(calls).toBe(1);
      expect(runtime.session.isStreaming).toBe(true);
      expect(currentGoal(runtime)).toEqual(originalGoal);
      expect(
        frames.some(
          (frame) =>
            frame.type === "assistant" &&
            frame.user_message_uuid === uuid &&
            (frame.bruv as { level?: string } | undefined)?.level === "error",
        ),
      ).toBe(true);
      expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
      expect(
        frames.filter(
          (frame) => frame.type === "system" && frame.subtype === "session_state_changed" && frame.state === "idle",
        ),
      ).toHaveLength(0);
    }
    held!.push({ type: "done", reason: "toolUse", message: completeGoal("busy-invalid-goal-complete") });
    await runtime.session.waitForIdle();
    await until(() => frames.some((frame) => frame.type === "result"));
    expect(frames.filter((frame) => frame.type === "result")).toEqual([
      expect.objectContaining({
        user_message_uuid: "busy-error-owner",
        result: "Original goal survived invalid controls",
        is_error: false,
      }),
    ]);
    expect(currentGoal(runtime)?.status).toBe("completed");
    expect(calls).toBe(2);
  }, 15_000);

  test.each([
    { order: "prompt first", command: "/bruv status" },
    { order: "command first", command: "/bruv resources" },
  ])(
    "concurrent native admission keeps command and model ownership separate: $order",
    async ({ order, command }) => {
      const outputBlocked = Promise.withResolvers<void>();
      const releaseOutput = Promise.withResolvers<void>();
      const frames: CompatFrame[] = [];
      const { runtime } = await fixture({
        extra: {
          emit: async (frame: CompatFrame) => {
            frames.push(frame);
            if (
              order === "command first" &&
              frame.type === "assistant" &&
              frame.user_message_uuid === "concurrent-control"
            ) {
              outputBlocked.resolve();
              await releaseOutput.promise;
            }
          },
        },
      });
      await init(runtime);
      let calls = 0;
      runtime.session.agent.streamFunction = () => {
        calls++;
        return output(assistant("Independent model answer"));
      };
      let mainRun: Promise<void> | undefined;
      let commandRun: Promise<void> | undefined;
      try {
        if (order === "prompt first") {
          mainRun = runtime.onUser(
            user(runtime, "Do the independently owned work", { uuid: "concurrent-main" }),
            signal(),
          );
          commandRun = runtime.onUser(user(runtime, command, { uuid: "concurrent-control" }), signal());
        } else {
          commandRun = runtime.onUser(user(runtime, command, { uuid: "concurrent-control" }), signal());
          await outputBlocked.promise;
          mainRun = runtime.onUser(
            user(runtime, "Do the independently owned work", { uuid: "concurrent-main" }),
            signal(),
          );
          // Keep the idle command's asynchronous output pending while the next
          // submitted prompt gets a chance to enter the shared admission seam.
          await new Promise<void>((resolve) => setImmediate(resolve));
          releaseOutput.resolve();
        }
        await Promise.all([mainRun, commandRun]);
        expect(calls).toBe(1);
        const modelResults = frames.filter(
          (frame) => frame.type === "result" && frame.result === "Independent model answer",
        );
        expect(modelResults).toEqual([
          expect.objectContaining({
            user_message_uuid: "concurrent-main",
            user_message_uuids: ["concurrent-main"],
            num_turns: 1,
            is_error: false,
          }),
        ]);
        expect(
          frames.filter(
            (frame) =>
              frame.type === "assistant" &&
              (frame.message as { content: Array<{ text?: string }> }).content[0]?.text === "Independent model answer",
          ),
        ).toEqual([expect.objectContaining({ user_message_uuid: "concurrent-main" })]);
        expect(frames.filter((frame) => frame.type === "user" && frame.uuid === "concurrent-control")).toHaveLength(1);
        expect(
          frames
            .filter((frame) => frame.type === "command_lifecycle" && frame.command_uuid === "concurrent-control")
            .map((frame) => frame.state),
        ).toEqual(["started", "completed"]);
        for (const result of frames.filter(
          (frame) => frame.type === "result" && frame.user_message_uuid === "concurrent-control",
        )) {
          expect(result).toMatchObject({ num_turns: 0, user_message_uuids: ["concurrent-control"] });
        }
        expect(runtime.session.isIdle).toBe(true);
      } finally {
        releaseOutput.resolve();
        await Promise.allSettled([mainRun, commandRun].filter((run): run is Promise<void> => !!run));
      }
    },
    15_000,
  );

  test.each(["interrupt", "close"] as const)(
    "native %s cancels an idle Live picker before waiting for command admission",
    async (operation) => {
      const oldDepth = process.env.BRUV_SUBAGENT_DEPTH;
      process.env.BRUV_SUBAGENT_DEPTH = "0";
      const dialogStarted = Promise.withResolvers<void>();
      let dialogAborted = false;
      try {
        const { runtime, frames } = await fixture({
          persistent: true,
          extra: {
            request: async (request: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
              expect(request.tool_name).toBe("AskUserQuestion");
              expect(String(request.tool_use_id)).toStartWith("bruv-live:");
              expect(options?.signal).toBeDefined();
              dialogStarted.resolve();
              return await new Promise<never>((_resolve, reject) => {
                const abort = () => {
                  dialogAborted = true;
                  reject(options?.signal?.reason ?? new Error("Native Live picker cancelled"));
                };
                if (options?.signal?.aborted) abort();
                else options?.signal?.addEventListener("abort", abort, { once: true });
              });
            },
          },
        });
        await init(runtime);
        let calls = 0;
        runtime.session.agent.streamFunction = () => {
          calls++;
          return output(assistant("Work continues after cancelling the picker"));
        };
        const picker = runtime.onUser(user(runtime, "/bruv live model", { uuid: "pending-live-picker" }), signal());
        await dialogStarted.promise;
        expect(calls).toBe(0);
        const cancellation =
          operation === "interrupt" ? runtime.controls.interrupt!(control("interrupt"), signal()) : runtime.close();
        await Promise.all([picker, cancellation]);
        expect(dialogAborted).toBe(true);
        expect(calls).toBe(0);
        if (operation === "close") {
          await expect(runtime.onUser(user(runtime, "Closed session cannot run"), signal())).rejects.toThrow("closed");
          return;
        }
        expect(runtime.session.isIdle).toBe(true);
        await runtime.onUser(user(runtime, "Continue ordinary work", { uuid: "after-live-picker" }), signal());
        expect(calls).toBe(1);
        expect(frames.filter((frame) => frame.type === "result").at(-1)).toMatchObject({
          user_message_uuid: "after-live-picker",
          user_message_uuids: ["after-live-picker"],
          result: "Work continues after cancelling the picker",
          is_error: false,
        });
      } finally {
        if (oldDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
        else process.env.BRUV_SUBAGENT_DEPTH = oldDepth;
      }
    },
    15_000,
  );
}
