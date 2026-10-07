import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { parseConnectorArguments, assertLaunchBindings } from "../src/claude-compat/arguments";
import {
  runConnector,
  CONNECTOR_DISPLAY_IDENTITY,
  BRUV_CONNECTOR_VERSION,
  type ConnectorIO,
  type RuntimeFactory,
  type ConnectorRuntimeOptions,
} from "../src/claude-compat/cli";

const streamFlags = [
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--permission-mode",
  "bypassPermissions",
  "--allow-dangerously-skip-permissions",
];
const schema = {
  type: "object",
  required: ["title"],
  properties: { title: { type: "string" } },
  additionalProperties: false,
};
const auxiliaryFlags = [
  "-p",
  "--output-format",
  "json",
  "--json-schema",
  JSON.stringify(schema),
  "--tools",
  "",
  "--disable-slash-commands",
  "--strict-mcp-config",
  "--permission-mode",
  "dontAsk",
];
function harness(input = new PassThrough()) {
  let stdout = "",
    stderr = "";
  const signals = new EventEmitter();
  const io: ConnectorIO = {
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
    cwd: "/project",
    home: "/home/test",
    env: {},
    signals,
  };
  return {
    io,
    signals,
    stdout: () => stdout,
    stderr: () => stderr,
    frames: () =>
      stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Bun.sleep(2);
  }
  throw new Error("Timed out waiting for launch fixture");
}

describe("connector launch arguments", () => {
  test("parses exact provider IDs, equals values, appended context and transient stream", () => {
    const args = parseConnectorArguments([
      ...streamFlags,
      "--model=openai/gpt-4.1",
      "--verbose",
      "--no-session-persistence",
      "--include-partial-messages",
      "--append-system-prompt",
      "A",
      "--append-system-prompt=B",
    ]);
    assertLaunchBindings(args);
    expect(args).toMatchObject({
      model: "openai/gpt-4.1",
      mode: "stream",
      noPersistence: true,
      partialMessages: true,
      appendSystemPrompt: ["A", "B"],
    });
  });
  test("parses the native plain text auxiliary launch and empty MCP", () => {
    const args = parseConnectorArguments([...auxiliaryFlags, "--mcp-config", '{"mcpServers":{}}', "summarize"]);
    assertLaunchBindings(args);
    expect(args).toMatchObject({ mode: "auxiliary", tools: "", prompt: "summarize", schema });
  });
  test("unknown, ambiguous and malformed launches fail", () => {
    for (const flags of [
      ["--unknown"],
      ["--model", "sonnet"],
      ["--settings", "[]"],
      ["--verbose=false"],
      ["--model"],
      ["--verbose", "--verbose"],
      ["--input-format=text"],
      ["--max-thinking-tokens", "NaN"],
      ["--model", "openai/gpt", "unexpected"],
    ]) {
      expect(() => parseConnectorArguments([...streamFlags, ...flags])).toThrow();
    }
    expect(() => parseConnectorArguments(["-p", "--output-format", "json"])).toThrow("--json-schema");
  });
  test("bound launch vocabulary accepts native health policy, rejects unsupported effects", () => {
    for (const flags of [
      ["--permission-prompt-tool", "stdio"],
      ["--allowedTools", "execute"],
      ["--disallowedTools", "execute"],
      ["--settings", '{"disableAllHooks":true,"permissions":{"allow":["Bash(*)"]}}'],
      ["--setting-sources", "user,project,local"],
      ["--add-dir", "/other"],
      ["--effort", "high"],
      ["--tools", "default"],
    ])
      expect(() => assertLaunchBindings(parseConnectorArguments([...streamFlags, ...flags]))).not.toThrow();
    for (const flags of [
      ["--session-id", "session"],
      ["--thinking", "unknown"],
      ["--thinking-display", "hide"],
      ["--max-thinking-tokens", "10"],
      ["--settings", '{"fastMode":true}'],
    ])
      expect(() => assertLaunchBindings(parseConnectorArguments([...streamFlags, ...flags]))).toThrow();
    expect(() => assertLaunchBindings(parseConnectorArguments(streamFlags.slice(0, 4)))).not.toThrow();
    expect(() => assertLaunchBindings(parseConnectorArguments(streamFlags.slice(0, -1)))).toThrow("explicit");
  });
});

describe("connector entry glue (injected engine, not integrated product proof)", () => {
  test("own help and version perform no engine initialization", async () => {
    let calls = 0;
    const factory: RuntimeFactory = async () => {
      calls++;
      throw new Error("must not start");
    };
    const h = harness();
    expect(await runConnector(["--version"], factory, h.io)).toBe(0);
    expect(h.stdout()).toBe(CONNECTOR_DISPLAY_IDENTITY + "\n");
    expect(CONNECTOR_DISPLAY_IDENTITY).toBe("Bruv connector");
    expect(h.stdout() + h.stderr()).not.toMatch(/\d+\.\d+\.\d+/);
    const real = harness();
    expect(await runConnector(["--bruv-version"], factory, real.io)).toBe(0);
    expect(real.stdout()).toBe(BRUV_CONNECTOR_VERSION + "\n");
    expect(BRUV_CONNECTOR_VERSION.startsWith("bruv-claude-compat ")).toBe(true);
    expect(await runConnector(["--help"], factory, h.io)).toBe(0);
    expect(h.stdout()).toContain("not Anthropic Claude Code");
    expect(calls).toBe(0);
  });
  test("connector uses explicit home-prefixed overrides including spaces", async () => {
    const h = harness();
    h.io.env.BRUV_CLAUDE_COMPAT_HOME = "~/.bruv/custom auth";
    h.io.env.BRUV_CLAUDE_COMPAT_BRUV_PATH = "~/custom bin/bruv";
    let options: ConnectorRuntimeOptions | undefined;
    const factory: RuntimeFactory = async (o) => {
      options = o;
      return {
        controls: {},
        onUser: async () => {},
        close: async () => {},
        runAuxiliary: async () => ({ type: "result", structured_output: { title: "fixture" } }),
      };
    };
    expect(await runConnector([...auxiliaryFlags, "prompt"], factory, h.io)).toBe(0);
    expect(options).toMatchObject({
      agentDir: "/home/test/.bruv/custom auth",
      executablePath: "/home/test/custom bin/bruv",
    });
  });
  test("launch errors are nonzero stderr only, before runtime or state access", async () => {
    const h = harness();
    let calls = 0;
    const factory: RuntimeFactory = async () => {
      calls++;
      throw new Error("must not start");
    };
    expect(await runConnector([...streamFlags, "--resume=old"], factory, h.io)).toBe(1);
    expect(h.stdout()).toBe("");
    expect(h.stderr()).toContain("must be a UUID");
    expect(calls).toBe(0);
  });
  test("successful initialization does zero model calls; prompt and controls share one runtime", async () => {
    const h = harness();
    let prompts = 0,
      closed = 0;
    let options: ConnectorRuntimeOptions | undefined;
    const factory: RuntimeFactory = async (o) => {
      options = o;
      return {
        controls: {
          initialize: async () => ({
            account: {},
            models: [{ value: "openai/gpt-4.1" }],
            bruv: { readiness: { configured: true, access_verified: false } },
          }),
          interrupt: async () => ({}),
        },
        onUser: async (message) => {
          prompts++;
          expect(message.uuid).toBe("source-id");
          await o.emit({ type: "stream_event", event: { type: "content_block_delta" } });
          await o.emit({
            type: "assistant",
            message: { role: "assistant", model: o.model, content: [{ type: "text", text: "done" }] },
          });
          await o.emit({ type: "result", subtype: "success", is_error: false, result: "done" });
        },
        close: async () => {
          closed++;
        },
        runAuxiliary: async () => {
          throw new Error("wrong mode");
        },
      };
    };
    const running = runConnector(
      [...streamFlags, "--model=openai/gpt-4.1", "--append-system-prompt=workspace"],
      factory,
      h.io,
    );
    h.io.input.push(
      JSON.stringify({ type: "control_request", request_id: "init", request: { subtype: "initialize" } }) + "\n",
    );
    await until(() => h.frames().length === 1);
    expect(prompts).toBe(0);
    expect(h.frames()[0].response.response.account).toEqual({});
    expect(h.frames()[0].response.response.bruv.readiness.access_verified).toBe(false);
    h.io.input.push(
      JSON.stringify({
        type: "user",
        uuid: "source-id",
        parent_tool_use_id: null,
        message: { role: "user", content: "work" },
      }) + "\n",
    );
    await until(() => h.frames().some((f) => f.type === "result"));
    expect(h.frames().map((f) => f.type)).toEqual(["control_response", "assistant", "result"]);
    h.io.input.push(null);
    expect(await running).toBe(0);
    expect(closed).toBe(1);
    expect(h.stderr()).toBe("");
    expect(options).toMatchObject({
      agentDir: "/home/test/.bruv/agent",
      auxiliary: false,
      appendSystemPrompt: ["workspace"],
      model: "openai/gpt-4.1",
    });
  });
  test("partial-message flag changes emitted output and unsupported controls error", async () => {
    const h = harness();
    const factory: RuntimeFactory = async (o) => ({
      controls: {},
      onUser: async () => {
        await o.emit({ type: "stream_event", event: {} });
      },
      close: async () => {},
      runAuxiliary: async () => ({ type: "result" }),
    });
    const running = runConnector([...streamFlags, "--include-partial-messages"], factory, h.io);
    h.io.input.push('{"type":"control_request","request_id":"mcp","request":{"subtype":"mcp_status"}}\n');
    h.io.input.push('{"type":"user","parent_tool_use_id":null,"message":{"role":"user","content":"go"}}\n');
    await until(() => h.frames().length === 2);
    expect(h.frames()[0].response.subtype).toBe("error");
    expect(h.frames()[1].type).toBe("stream_event");
    h.io.input.push(null);
    expect(await running).toBe(0);
  });
  test("plain stdin schema request produces one JSON result and isolates runtime", async () => {
    const h = harness();
    let closed = 0;
    h.io.input.push("write a title");
    h.io.input.push(null);
    const factory: RuntimeFactory = async (o, args) => {
      expect(o.auxiliary).toBe(true);
      expect(o.permissionMode).toBe("dontAsk");
      expect(args.schema).toEqual(schema);
      return {
        controls: {},
        onUser: async () => {
          throw new Error("not NDJSON");
        },
        close: async () => {
          closed++;
        },
        runAuxiliary: async (prompt, requested) => {
          expect(prompt).toBe("write a title");
          expect(requested).toEqual(schema);
          return { type: "result", subtype: "success", structured_output: { title: "A title" } };
        },
      };
    };
    expect(await runConnector(auxiliaryFlags, factory, h.io)).toBe(0);
    expect(h.frames()).toEqual([{ type: "result", subtype: "success", structured_output: { title: "A title" } }]);
    expect(closed).toBe(1);
    expect(h.stderr()).toBe("");
  });
  test("auxiliary engine/schema failure is nonzero and emits no successful JSON", async () => {
    const h = harness();
    const factory: RuntimeFactory = async () => ({
      controls: {},
      onUser: async () => {},
      close: async () => {},
      runAuxiliary: async () => {
        throw new Error("Model output does not satisfy schema");
      },
    });
    expect(await runConnector([...auxiliaryFlags, "prompt"], factory, h.io)).toBe(1);
    expect(h.stdout()).toBe("");
    expect(h.stderr()).toContain("does not satisfy schema");
  });
  for (const stop of ["EOF", "SIGTERM", "SIGINT"] as const)
    test(stop + " cancels current owner and awaits exactly one teardown", async () => {
      const h = harness();
      let started = false,
        aborted = false,
        closed = 0;
      const factory: RuntimeFactory = async () => ({
        controls: {},
        onUser: async (_message, signal) => {
          started = true;
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            ),
          );
        },
        close: async () => {
          closed++;
          await Bun.sleep(5);
        },
        runAuxiliary: async () => ({ type: "result" }),
      });
      const running = runConnector(streamFlags, factory, h.io);
      h.io.input.push('{"type":"user","parent_tool_use_id":null,"message":{"role":"user","content":"long work"}}\n');
      await until(() => started);
      if (stop === "EOF") h.io.input.push(null);
      else h.signals.emit(stop);
      expect(await running).toBe(stop === "EOF" ? 0 : stop === "SIGTERM" ? 143 : 130);
      expect(aborted).toBe(true);
      expect(closed).toBe(1);
      expect(h.signals.listenerCount("SIGTERM")).toBe(0);
    });
  test("normal completion awaits teardown and reports a teardown failure once", async () => {
    const h = harness();
    let closed = 0;
    const factory: RuntimeFactory = async () => ({
      controls: {},
      onUser: async () => {},
      runAuxiliary: async () => ({ type: "result", structured_output: { title: "fixture" } }),
      close: async () => {
        closed++;
        await Bun.sleep(5);
        throw new Error("History flush failed");
      },
    });
    expect(await runConnector([...auxiliaryFlags, "prompt"], factory, h.io)).toBe(1);
    expect(closed).toBe(1);
    expect(h.frames()).toHaveLength(1);
    expect(h.stderr()).toBe("[bruv-claude-compat] shutdown failed: History flush failed\n");
    expect(h.signals.listenerCount("SIGTERM")).toBe(0);
    expect(h.signals.listenerCount("SIGINT")).toBe(0);
  });
  test("run failure and teardown failure remain distinct diagnostics", async () => {
    const h = harness();
    let closed = 0;
    const factory: RuntimeFactory = async () => ({
      controls: {},
      onUser: async () => {},
      runAuxiliary: async () => {
        throw new Error("Model output does not satisfy schema");
      },
      close: async () => {
        closed++;
        throw new Error("History flush failed");
      },
    });
    expect(await runConnector([...auxiliaryFlags, "prompt"], factory, h.io)).toBe(1);
    expect(closed).toBe(1);
    expect(h.stdout()).toBe("");
    expect(h.stderr()).toBe(
      "[bruv-claude-compat] Model output does not satisfy schema\n" +
        "[bruv-claude-compat] shutdown failed: History flush failed\n",
    );
  });
  test("startup cancellation cannot hide teardown failure", async () => {
    const h = harness();
    let closed = 0;
    const factory: RuntimeFactory = async () => {
      h.signals.emit("SIGTERM");
      return {
        controls: {},
        onUser: async () => {},
        runAuxiliary: async () => {
          throw new Error("must not start");
        },
        close: async () => {
          closed++;
          throw new Error("History flush failed");
        },
      };
    };
    expect(await runConnector([...auxiliaryFlags, "prompt"], factory, h.io)).toBe(1);
    expect(closed).toBe(1);
    expect(h.stdout()).toBe("");
    expect(h.stderr()).toBe("[bruv-claude-compat] shutdown failed: History flush failed\n");
  });
  test("SIGTERM during startup still closes the eventual runtime", async () => {
    const h = harness();
    let closed = 0;
    const factory: RuntimeFactory = async () => {
      h.signals.emit("SIGTERM");
      return {
        controls: {},
        onUser: async () => {},
        close: async () => {
          closed++;
        },
        runAuxiliary: async () => ({ type: "result" }),
      };
    };
    expect(await runConnector(streamFlags, factory, h.io)).toBe(143);
    expect(closed).toBe(1);
  });
  test("SIGTERM cancels auxiliary generation without publishing output", async () => {
    const h = harness();
    let started = false,
      closed = 0;
    let rejectGeneration: ((error: Error) => void) | undefined;
    const factory: RuntimeFactory = async () => ({
      controls: {},
      onUser: async () => {},
      close: async () => {
        closed++;
        rejectGeneration?.(new Error("Interrupted"));
      },
      runAuxiliary: async () => {
        started = true;
        return new Promise((_resolve, reject) => {
          rejectGeneration = reject;
        });
      },
    });
    const running = runConnector([...auxiliaryFlags, "prompt"], factory, h.io);
    await until(() => started);
    h.signals.emit("SIGTERM");
    expect(await running).toBe(143);
    expect(h.stdout()).toBe("");
    expect(closed).toBe(1);
  });
});

test("root controls are scrubbed before factory startup and resumed human requests wait for the paired transport", async () => {
  const h = harness();
  h.io.env = {
    T3_MCP_URL: "must-not-reach-runtime",
    T3_ACP_MCP_BEARER: "must-not-reach-runtime",
    BRUV_ROOT_TEST: "root-only",
    BRUV_WEB_TASK_EVENTS: "1",
    OPENAI_API_KEY: "fixture-only-auth",
    CLAUDE_CONFIG_DIR: "/scoped/sdk-home",
  };
  const abort = new AbortController();
  let callback: Promise<Record<string, unknown>> | undefined;
  const factory: RuntimeFactory = async (options) => {
    expect(h.io.env.T3_MCP_URL).toBeUndefined();
    expect(h.io.env.T3_ACP_MCP_BEARER).toBeUndefined();
    expect(h.io.env.BRUV_ROOT_TEST).toBeUndefined();
    expect(h.io.env.BRUV_WEB_TASK_EVENTS).toBeUndefined();
    expect(h.io.env.OPENAI_API_KEY).toBe("fixture-only-auth");
    expect(options.configDir).toBe("/scoped/sdk-home");
    callback = options.request!(
      {
        subtype: "can_use_tool",
        tool_name: "AskUserQuestion",
        tool_use_id: "real-saved-question",
        input: { questions: [] },
      },
      { signal: abort.signal },
    );
    return {
      controls: { initialize: async () => ({}) },
      onUser: async () => {},
      runAuxiliary: async () => ({ type: "result" }),
      close: async () => {
        abort.abort();
      },
    };
  };
  const run = runConnector(streamFlags, factory, h.io);
  for (let i = 0; i < 50 && !h.frames().some((f) => f.type === "control_request"); i++)
    await new Promise((r) => setTimeout(r, 1));
  const request = h.frames().find((f) => f.type === "control_request")!;
  expect(request.request.tool_use_id).toBe("real-saved-question");
  h.io.input.push(
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request.request_id,
        response: { behavior: "allow", updatedInput: { answers: { Question: "Human answer" } } },
      },
    }) + "\n",
  );
  expect(await callback).toMatchObject({ behavior: "allow" });
  h.io.input.push(null);
  expect(await run).toBe(0);
});
