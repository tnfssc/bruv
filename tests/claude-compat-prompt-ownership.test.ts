import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AssistantMessage, type Context, createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { type CompatFrame, createClaudeCompatFrontend } from "../src/claude-compat/frontend";
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
  test("autonomous result cannot settle a native human prompt still in Pi preflight", async () => {
    const { runtime, frames } = await fixture();
    await init(runtime);
    let calls = 0,
      wakeStarted = false,
      humanPreflight = false;
    let releaseWake!: () => void, releaseInput!: () => void;
    const wakeGate = new Promise<void>((r) => (releaseWake = r)),
      inputGate = new Promise<void>((r) => (releaseInput = r));
    const input = runtime.session.extensionRunner.emitInput.bind(runtime.session.extensionRunner);
    spyOn(runtime.session.extensionRunner, "emitInput").mockImplementation(async (...args: any[]) => {
      if (args[0] === "HUMAN_NEW") {
        humanPreflight = true;
        await inputGate;
      }
      return (input as any)(...args);
    });
    const contexts: Context[] = [];
    runtime.session.agent.streamFunction = (_model, context) => {
      contexts.push(structuredClone(context));
      ++calls;
      if (calls === 1)
        return output(
          assistant("", {
            content: [
              {
                type: "toolCall",
                id: "actual-shell",
                name: "execute",
                arguments: {
                  label: "Launch owned review job",
                  code: 'console.log(await shell("sleep 0.1; echo REVIEW_WAKE", {waitSeconds:0}))',
                },
              },
            ],
            stopReason: "toolUse",
          }),
        );
      if (calls === 2) return output(assistant("initial done"));
      if (calls === 3) {
        wakeStarted = true;
        const stream = createAssistantMessageEventStream();
        void wakeGate.then(() => stream.push({ type: "done", reason: "stop", message: assistant("autonomous done") }));
        return stream;
      }
      return output(assistant("human done"));
    };
    await runtime.onUser(user(runtime, "INITIAL", { uuid: "00000000-0000-4000-8000-000000000001" }), signal());
    await until(() => wakeStarted);
    const human = runtime.onUser(
      user(runtime, "HUMAN_NEW", { uuid: "00000000-0000-4000-8000-000000000002" }),
      signal(),
    );
    await until(() => humanPreflight);
    releaseWake();
    await until(() => frames.filter((f) => f.type === "result").length === 2);
    expect(JSON.stringify(contexts[2])).not.toContain("HUMAN_NEW");
    releaseInput();
    await human;
    expect(frames.filter((f) => f.type === "result").map((f) => f.user_message_uuids)).toEqual([
      ["00000000-0000-4000-8000-000000000001"],
      undefined,
      ["00000000-0000-4000-8000-000000000002"],
    ]);
    expect(frames.filter((f) => f.type === "result")[1].origin).toEqual({ kind: "task-notification" });
    // The real adapter learns early echo mode from the first stream frame.
    expect(frames.find((f) => f.type === "stream_event")?.user_message_uuid).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    // Exact unmodified adapter UUID/origin decision, extracted below.
    const pinned = await readFile(resolve("tests/claude-compat/native-adapter-prompt-ownership.ts.txt"), "utf8");
    if (process.env.BRUV_T3_CLAUDE_ADAPTER_SOURCE) {
      const adapterSource = await readFile(process.env.BRUV_T3_CLAUDE_ADAPTER_SOURCE, "utf8");
      const echoFn = adapterSource.slice(
        adapterSource.indexOf("function claudeEchoedPromptUuids("),
        adapterSource.indexOf("// The prompt uuid a command_lifecycle"),
      );
      const classify = adapterSource.slice(
        adapterSource.indexOf("function isClaudeResultForOtherTurn("),
        adapterSource.indexOf("function isClaudeTaskNotificationOriginResult("),
      );
      expect(pinned.trimEnd().endsWith((echoFn + classify).trimEnd())).toBe(true);
    }
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(pinned + ";return isClaudeResultForOtherTurn");
    const classify = new Function(js)();
    const foreign = frames.filter((f) => f.type === "result")[1];
    const detected = classify({
      message: foreign,
      promptUuid: "00000000-0000-4000-8000-000000000002",
      promptEchoMode: "early",
    });
    expect(detected).toBe(true);
    expect(calls).toBe(4);
    expect(frames.filter((frame) => frame.type === "system" && frame.subtype === "init")).toHaveLength(3);
    expect(frames.filter((f) => f.type === "result").map((f) => f.result)).toEqual([
      "initial done",
      "autonomous done",
      "human done",
    ]);
  });

  for (const priority of ["now", "next", "now-without-uuid"]) {
    test("queued " + priority + " input echoes only after Pi consumption, without aborting", async () => {
      const { runtime, frames } = await fixture({
        extra: {
          extensionFactories: [
            {
              name: "transform-input",
              factory: (pi: any) => {
                pi.on("input", (event: any) => ({ action: "transform", text: "TRANSFORMED " + event.text }));
              },
            },
          ],
        },
      });
      await init(runtime);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const contexts: Context[] = [];
      runtime.session.agent.streamFunction = (_model, context) => {
        contexts.push(structuredClone(context));
        if (contexts.length === 1) {
          const stream = createAssistantMessageEventStream();
          void gate.then(() =>
            stream.push({ type: "done", reason: "stop", message: assistant("before queued consumption") }),
          );
          return stream;
        }
        return output(assistant("after queued consumption"));
      };
      const abort = spyOn(runtime.session, "abort");
      // Identical source text and transformed input must still keep distinct client identities.
      const first = runtime.onUser(
        user(runtime, "same text", { uuid: "00000000-0000-4000-8000-000000000011" }),
        signal(),
      );
      await until(() => contexts.length === 1);
      await runtime.onUser(
        user(runtime, "same text", {
          priority: priority === "now-without-uuid" ? "now" : priority,
          uuid: priority === "now-without-uuid" ? undefined : "00000000-0000-4000-8000-000000000012",
        }),
        signal(),
      );
      expect(runtime.session.isStreaming).toBe(true);
      expect(abort).not.toHaveBeenCalled();
      expect(
        frames.some((f) =>
          (f.user_message_uuids as string[] | undefined)?.includes("00000000-0000-4000-8000-000000000012"),
        ),
      ).toBe(false);
      expect(contexts.length).toBe(1);
      release();
      await first;
      expect(abort).not.toHaveBeenCalled();
      expect(contexts.length).toBe(2);
      expect(JSON.stringify(contexts[1])).toContain("TRANSFORMED same text");
      const results = frames.filter((f) => f.type === "result");
      expect(results).toHaveLength(1);
      expect(results[0].origin).toEqual({ kind: "human" });
      if (priority === "now-without-uuid") {
        expect(results[0].user_message_uuids).toEqual(["00000000-0000-4000-8000-000000000011"]);
      } else {
        expect(results[0].user_message_uuids).toEqual([
          "00000000-0000-4000-8000-000000000011",
          "00000000-0000-4000-8000-000000000012",
        ]);
        expect(results[0].user_message_uuid).toBe("00000000-0000-4000-8000-000000000012");
        expect(
          frames.find(
            (f) => f.type === "stream_event" && f.user_message_uuid === "00000000-0000-4000-8000-000000000012",
          ),
        ).toBeDefined();
      }
    });
  }

  // Result provenance follows messages Pi actually consumed in this generation.
  // A lifecycle frame (job finished) alone is not a model wake or an idle boundary.
  test("task wake result uses supported SDK origin only after consumption and settlement", async () => {
    const frames: CompatFrame[] = [];
    const frontend = createClaudeCompatFrontend({
      sessionId: () => "root",
      model: () => "test/model",
      initialization: () => ({ model: "test/model", tools: [] }),
      emit: (frame) => {
        frames.push(frame);
      },
    });
    const consume = (customType: string) =>
      frontend.onEvent({
        type: "message_start",
        message: { role: "custom", customType, content: "notification", display: true, timestamp: 1 },
      });
    consume("task-complete");
    frontend.onEvent({ type: "message_end", message: assistant("wake reply") });
    await frontend.flush();
    expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
    expect(frames.filter((frame) => frame.subtype === "session_state_changed").map((frame) => frame.state)).toEqual([
      "running",
    ]);
    frontend.onEvent({ type: "agent_settled" });
    await frontend.flush();
    const wake = frames.find((frame) => frame.type === "result")!;
    expect(wake.origin).toEqual({ kind: "task-notification" });
    expect(wake.user_message_uuid).toBeUndefined();
    expect(wake.result).toBe("wake reply");
    expect(frames.at(-1)).toMatchObject({ type: "system", subtype: "session_state_changed", state: "idle" });

    consume("task-attention");
    frontend.consumeUser("next-human");
    frontend.onEvent({ type: "message_end", message: assistant("human reply") });
    frontend.onEvent({ type: "agent_settled" });
    await frontend.flush();
    expect(frames.filter((frame) => frame.type === "result")[1]).toMatchObject({
      origin: { kind: "human" },
      user_message_uuid: "next-human",
      result: "human reply",
    });

    frontend.onEvent({ type: "agent_start" });
    consume("unrelated-extension");
    frontend.onEvent({ type: "message_end", message: assistant("other reply") });
    frontend.onEvent({ type: "agent_settled" });
    await frontend.flush();
    const unrelated = frames.filter((frame) => frame.type === "result")[2];
    expect(unrelated.origin).toEqual({ kind: "unclassified" });
    expect(unrelated.user_message_uuid).toBeUndefined();
    expect(frames.filter((frame) => frame.subtype === "session_state_changed").map((frame) => frame.state)).toEqual([
      "running",
      "idle",
      "running",
      "idle",
      "running",
      "idle",
    ]);
    expect(frames.filter((frame) => frame.type === "system" && frame.subtype === "init")).toHaveLength(3);
  });

  // Both real Pi replies can precede the same agent_settled. The human UUID is
  // turn attribution, not the identity of either reply or its stream.
  test("same settlement epoch retains distinct replies and matching stream identities", async () => {
    const frames: CompatFrame[] = [];
    const sourceIds = new WeakMap<object, string>();
    const frontend = createClaudeCompatFrontend({
      sessionId: () => "root",
      model: () => "test/model",
      initialization: () => ({ model: "test/model", tools: [] }),
      messageUuid: (message) => {
        let id = sourceIds.get(message);
        if (!id) {
          id = crypto.randomUUID();
          sourceIds.set(message, id);
        }
        return id;
      },
      emit: (frame) => {
        frames.push(frame);
      },
    });
    frontend.consumeUser("consumed-human");
    const acknowledgement = assistant("acknowledgement");
    frontend.onEvent({ type: "message_start", message: acknowledgement });
    frontend.onEvent({ type: "message_end", message: acknowledgement });
    frontend.onEvent({
      type: "message_start",
      message: {
        role: "custom",
        customType: "task-complete",
        content: "terminal notification",
        display: true,
        timestamp: 1,
      },
    });
    const completion = assistant("completion reply");
    frontend.onEvent({ type: "message_start", message: completion });
    frontend.onEvent({ type: "message_end", message: completion });
    await frontend.flush();
    expect(frames.filter((frame) => frame.type === "result")).toHaveLength(0);
    frontend.onEvent({ type: "agent_settled" });
    await frontend.flush();
    const replies = frames.filter((frame) => frame.type === "assistant");
    expect(replies.map((frame) => (frame.message as any).content[0].text)).toEqual([
      "acknowledgement",
      "completion reply",
    ]);
    expect(new Set(replies.map((frame) => frame.uuid)).size).toBe(2);
    expect(replies.map((frame) => frame.uuid)).toEqual([sourceIds.get(acknowledgement), sourceIds.get(completion)]);
    expect(replies.map((frame) => frame.user_message_uuid)).toEqual(["consumed-human", "consumed-human"]);
    const starts = frames.filter(
      (frame) => frame.type === "stream_event" && (frame.event as any).type === "message_start",
    );
    expect(replies.map((frame) => (frame.message as any).id)).toEqual(
      starts.map((frame) => (frame.event as any).message.id),
    );
    expect(new Set(replies.map((frame) => (frame.message as any).id)).size).toBe(2);
    expect(frames.filter((frame) => frame.type === "result")).toHaveLength(1);
    expect(frames.find((frame) => frame.type === "result")).toMatchObject({
      result: "completion reply",
      origin: { kind: "human" },
      user_message_uuid: "consumed-human",
      num_turns: 2,
    });
    expect(frames.filter((frame) => frame.type === "system" && frame.subtype === "init")).toHaveLength(1);
  });
}
