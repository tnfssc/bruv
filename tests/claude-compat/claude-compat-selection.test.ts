import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { parseConnectorArguments } from "../../src/claude-compat/arguments";
import { permissionBinding } from "../../src/claude-compat/binding";
import type { CompatFrame } from "../../src/claude-compat/frontend";
import {
  type ClaudeCompatRuntime,
  createClaudeCompatRuntime,
  preflightClaudeCompatModel,
} from "../../src/claude-compat/runtime";
import { GoalStore, latestGoal } from "../../src/goals/store";

// Pi extension and session hooks are process-wide; keep the real SDK fixtures isolated.
if (process.env.BRUV_TEST_COMPAT_SELECTION_CHILD !== import.meta.path) {
  test("native permission and model selections in an isolated SDK process", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BRUV_TEST_COMPAT_SELECTION_CHILD: import.meta.path, HERDR_ENV: "0" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stdout + stderr).toBe(0);
  }, 30_000);
} else {
  const runtimes: ClaudeCompatRuntime[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });
  const signal = () => new AbortController().signal;
  const control = (subtype: string, fields: Record<string, unknown> = {}) => ({
    type: "control_request" as const,
    request_id: "selection-control",
    request: { subtype, ...fields },
  });

  async function fixture(options: { mode?: string; tools?: string[]; denied?: string; summarized?: boolean } = {}) {
    await mkdir(resolve(".tmp"), { recursive: true });
    const directory = await mkdtemp(resolve(".tmp/native-selection-"));
    directories.push(directory);
    await writeFile(
      join(directory, "auth.json"),
      JSON.stringify({
        anthropic: { type: "api_key", key: "offline-fixture" },
        google: { type: "api_key", key: "offline-fixture" },
      }),
    );
    const models = await ModelRuntime.create({
      authPath: join(directory, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const requested: string[] = [];
    const args = parseConnectorArguments([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--permission-mode",
      options.mode ?? "default",
      ...(options.denied ? ["--disallowedTools", options.denied] : []),
    ]);
    const permissions = permissionBinding(args, async (request) => {
      requested.push(String(request.tool_name));
      return { behavior: "deny", message: "Fixture denies arbitrary execution" };
    });
    const frames: CompatFrame[] = [];
    const settings = {
      cwd: directory,
      agentDir: directory,
      modelRuntime: models,
      model: "anthropic/claude-sonnet-4-5",
      settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }, { projectTrusted: false }),
      sessionManager: SessionManager.inMemory(directory),
      tools: options.tools,
      permissionMode: options.mode ?? "default",
      authorizeTool: permissions.authorize,
      changePermissionMode: permissions.setMode,
      thinkingDisplay: options.summarized ? "summarized" : undefined,
      emit: (frame: CompatFrame) => {
        frames.push(frame);
      },
    };
    const runtime = await createClaudeCompatRuntime(settings);
    runtimes.push(runtime);
    await runtime.controls.initialize!(control("initialize"), signal());
    return { runtime, directory, frames, requested, models, settings };
  }

  function reply(content: AssistantMessage["content"], stopReason: "stop" | "toolUse") {
    const message: AssistantMessage = {
      role: "assistant",
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      content,
      stopReason,
      timestamp: Date.now(),
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
    stream.push({ type: "done", reason: stopReason, message });
    return stream;
  }

  async function runTools(runtime: ClaudeCompatRuntime, calls: AssistantMessage["content"]) {
    let requests = 0;
    const prompts: string[] = [];
    const contexts: string[] = [];
    runtime.session.agent.streamFunction = (_model, context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));
      contexts.push(JSON.stringify(context.messages));
      return requests++ === 0 ? reply(calls, "toolUse") : reply([{ type: "text", text: "Fixture finished" }], "stop");
    };
    await runtime.onUser(
      {
        type: "user",
        uuid: "selection-user",
        session_id: runtime.session.sessionId,
        parent_tool_use_id: null,
        message: { role: "user", content: "Inspect the fixture" },
      },
      signal(),
    );
    return { prompts, contexts, requests };
  }

  test("Plan exposes real read tools and its instructions allow repository inspection without execution", async () => {
    const { runtime, directory, frames, requested } = await fixture({ mode: "plan" });
    expect(runtime.session.getActiveToolNames()).toEqual(["read", "grep", "find", "ls"]);
    await writeFile(join(directory, "fixture.txt"), "Repository inspection works");
    const observed = await runTools(runtime, [
      { type: "toolCall", id: "read-fixture", name: "read", arguments: { path: "fixture.txt" } },
    ]);
    expect(requested).toEqual([]);
    expect(JSON.stringify(frames)).toContain("Repository inspection works");
    expect(observed.prompts[0]).toContain("In plan mode, inspect the repository");
    expect(observed.prompts[0]).toContain("Do not use execute, run commands, change files");
    expect(observed.contexts[0]).toContain("Native permission state: plan");
  });

  test("mode switches activate native editing and restore normal tools without granting execute", async () => {
    const { runtime, directory, requested, frames } = await fixture();
    expect(runtime.session.getActiveToolNames()).toEqual(["execute"]);
    await runtime.controls.set_permission_mode!(control("set_permission_mode", { mode: "acceptEdits" }), signal());
    expect(runtime.session.getActiveToolNames()).toEqual(["execute", "read", "grep", "find", "ls", "edit", "write"]);
    await writeFile(join(directory, "inspect.txt"), "Read before editing");
    await runTools(runtime, [
      { type: "toolCall", id: "inspect-fixture", name: "read", arguments: { path: "inspect.txt" } },
      {
        type: "toolCall",
        id: "write-fixture",
        name: "write",
        arguments: { path: "edited.txt", content: "Allowed file edit" },
      },
      {
        type: "toolCall",
        id: "deny-execute",
        name: "execute",
        arguments: { code: 'await Bun.write("unsafe.txt", "must not execute")' },
      },
    ]);
    expect(await readFile(join(directory, "edited.txt"), "utf8")).toBe("Allowed file edit");
    expect(await Bun.file(join(directory, "unsafe.txt")).exists()).toBe(false);
    expect(requested).toEqual(["execute"]);
    expect(JSON.stringify(frames)).toContain("Fixture denies arbitrary execution");
    await runtime.controls.set_permission_mode!(control("set_permission_mode", { mode: "plan" }), signal());
    expect(runtime.session.getActiveToolNames()).toEqual(["read", "grep", "find", "ls"]);
    await runtime.controls.set_permission_mode!(control("set_permission_mode", { mode: "default" }), signal());
    expect(runtime.session.getActiveToolNames()).toEqual(["execute"]);
  });

  test("native auto-edit tools still obey explicit denied rules", async () => {
    const { runtime, directory, requested, frames } = await fixture({ mode: "acceptEdits", denied: "Write" });
    await runTools(runtime, [
      {
        type: "toolCall",
        id: "denied-write",
        name: "write",
        arguments: { path: "denied.txt", content: "must not write" },
      },
    ]);
    expect(await Bun.file(join(directory, "denied.txt")).exists()).toBe(false);
    expect(requested).toEqual([]);
    expect(JSON.stringify(frames)).toContain("Tool is disallowed");
  });

  test("Plan prevents new goal runs and preserves an existing goal without automatic continuations", async () => {
    const { runtime, directory, frames } = await fixture({ mode: "plan" });
    runtime.session.agent.streamFunction = () => {
      throw new Error("A Plan goal command must not dispatch the model");
    };
    await runtime.onUser(
      {
        type: "user",
        uuid: "plan-goal-command",
        session_id: runtime.session.sessionId,
        parent_tool_use_id: null,
        message: { role: "user", content: "/goal Build the fixture" },
      },
      signal(),
    );
    const manager = runtime.session.sessionManager;
    expect(latestGoal(manager.getBranch())).toBeUndefined();
    expect(JSON.stringify(frames)).toContain("Goal work needs the execute tool outside Plan mode");

    const store = new GoalStore((type, data) => manager.appendCustomEntry(type, data));
    const saved = store.set({ objective: "Finish implementation" });
    await writeFile(join(directory, "fixture.txt"), "Inspect before implementation");
    const observed = await runTools(runtime, [
      { type: "toolCall", id: "inspect-suspended-goal", name: "read", arguments: { path: "fixture.txt" } },
    ]);
    expect(observed.requests).toBe(2);
    expect(observed.contexts[0]).toContain("Goal pursuit is suspended in the current mode");
    expect(latestGoal(manager.getBranch())).toEqual(saved);
    await runtime.controls.set_permission_mode!(control("set_permission_mode", { mode: "default" }), signal());
    expect(runtime.session.getActiveToolNames()).toEqual(["execute"]);
    expect(latestGoal(manager.getBranch())).toEqual(saved);
  });

  test("explicit tool allowlists stay unchanged across permission-mode changes", async () => {
    for (const tools of [[], ["read"]]) {
      const { runtime } = await fixture({ mode: "plan", tools });
      for (const mode of ["plan", "acceptEdits", "default"]) {
        await runtime.controls.set_permission_mode!(control("set_permission_mode", { mode }), signal());
        expect(runtime.session.getActiveToolNames()).toEqual(tools);
      }
      await expect(
        runtime.controls.set_permission_mode!(control("set_permission_mode", { mode: "invalid" }), signal()),
      ).rejects.toThrow("Unsupported permission mode");
      expect(runtime.session.getActiveToolNames()).toEqual(tools);
    }
  });

  test("model switching checks the same thinking-display compatibility as initial launch", async () => {
    const { runtime, models, settings } = await fixture({ summarized: true });
    const target = models.getModel("google", "gemini-2.5-pro")!;
    expect(target.reasoning).toBe(true);
    const model = `${target.provider}/${target.id}`;
    await expect(preflightClaudeCompatModel({ ...settings, model })).rejects.toThrow(
      "Thinking summaries are unsupported",
    );
    await expect(runtime.controls.set_model!(control("set_model", { model }), signal())).rejects.toThrow(
      "Thinking summaries are unsupported",
    );
    expect(runtime.session.model?.provider).toBe("anthropic");
    expect(runtime.session.model?.id).toBe("claude-sonnet-4-5");

    await runtime.controls.set_model!(control("set_model", { model: "anthropic/claude-haiku-4-5" }), signal());
    expect(runtime.session.model?.id).toBe("claude-haiku-4-5");
  });
}
