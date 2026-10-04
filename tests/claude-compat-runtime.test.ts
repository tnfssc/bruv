import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AssistantMessage, type Context, createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { permissionBinding } from "../src/claude-compat/binding";
import { parseConnectorArguments } from "../src/claude-compat/arguments";
import { NativeHistory, readNativeHistory } from "../src/claude-compat/history";
import type { CompatFrame } from "../src/claude-compat/frontend";
import {
  type ClaudeCompatRuntime,
  type CompatUserMessage,
  createClaudeCompatRuntime,
} from "../src/claude-compat/runtime";

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
  async function fixture(options: { auxiliary?: boolean; auth?: boolean; extra?: object } = {}) {
    const dir = await mkdtemp(join(tmpdir(), "bruv-compat-engine-"));
    dirs.push(dir);
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
      sessionManager: SessionManager.inMemory(dir),
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

  test("unconfigured auth is an initialize error; aliases and unsupported policies are explicit failures", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { runtime } = await fixture({ auth: false });
      await expect(init(runtime)).rejects.toThrow("No configured authentication");
      await expect(runtime.controls.set_model!(control("set_model", { model: "sonnet" }), signal())).rejects.toThrow(
        "not a Claude alias",
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
    let captured!: Context;
    runtime.session.agent.streamFunction = (_model, context) => {
      captured = context;
      return output(assistant("fixture answer"));
    };
    await runtime.onUser(user(runtime), signal());
    expect(JSON.stringify(captured)).toContain("Quick work? Finish it.");
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
    ).rejects.toThrow("does not satisfy");
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
      extra: { permissionMode: "default", authorizeTool: binding.authorize, changePermissionMode: binding.setMode },
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
      runtime.session.agent.streamFunction = () =>
        calls++ === 0
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
      await runtime.onUser(user(runtime), signal());
      await until(() => requests.length === 1);
      expect(requests[0]).toMatchObject({ subtype: "can_use_tool", tool_name: "AskUserQuestion" });
      await until(() => calls >= 3 && runtime.session.isIdle);
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
      extra: { sessionManager: manager, nativeSessionId: nativeId, history },
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
    expect(entries[0]?.uuid).toBe("00000000-0000-4000-8000-000000000021");
    expect(entries[4]?.uuid).toBe("00000000-0000-4000-8000-000000000022");
    expect(new Set(entries.map((e) => e.bruv!.sourceMessageId)).size).toBe(6);
    const canonical = manager.getEntries().filter((e) => e.type === "message" && e.message.role !== "system");
    expect(entries.map((e) => e.bruv!.sourceMessageId)).toEqual(canonical.map((e) => e.id));
    for (let i = 1; i < entries.length; i++) expect(entries[i]!.parentUuid).toBe(entries[i - 1]!.uuid);
    const visible = frames.filter((f) => f.type === "assistant" || f.type === "user");
    for (const frame of visible) expect(entries.some((e) => e.uuid === frame.uuid)).toBe(true);
    expect(JSON.stringify(entries)).toContain("stored-tool");
    expect(JSON.stringify(entries)).toContain("HISTORY_RESULT");
    const reopened = SessionManager.open(manager.getSessionFile()!);
    expect(
      reopened
        .getEntries()
        .filter((e) => e.type === "message" && e.message.role !== "system")
        .map((e) => e.id),
    ).toEqual(canonical.map((e) => e.id));
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
}
