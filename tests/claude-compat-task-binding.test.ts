import { expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { NativeHistory } from "../src/claude-compat/history";
import {
  type AgentCallFrame,
  agentLaunchToolUseId,
  bindNativeTasks,
  createTaskBindingExtension,
  TASK_BINDING_ENTRY,
} from "../src/claude-compat/task-binding";
import { type ChildBody, type NativeTaskFrame, nativeTaskId } from "../src/claude-compat/task-projection";
import { disposeDiskBackedSessionManager, installDiskBackedSessionManager } from "../src/history/session-manager";
import { withJobRequestIdentity } from "../src/job-delivery";
import { JobService } from "../src/tasks/job-service";
import { type TaskInspection, TaskManager } from "../src/tasks/task-manager";

async function fixture() {
  installDiskBackedSessionManager();
  const dir = await mkdtemp(join(tmpdir(), "bruv-real-task-binding-"));
  let session = SessionManager.create(dir, dir);
  const sessionFile = session.getSessionFile()!;
  await writeFile(sessionFile, JSON.stringify(session.getHeader()) + "\n");
  disposeDiskBackedSessionManager(session);
  session = SessionManager.open(sessionFile);
  const ctx = {
    cwd: dir,
    model: { provider: "anthropic", id: "claude-sonnet-4-5" },
    sessionManager: session,
  } as unknown as ExtensionContext;
  const notifications: TaskInspection[] = [];
  const manager = new TaskManager((task) => {
    notifications.push(task);
  }, 15);
  const profiles = join(dir, "profiles.json");
  await writeFile(profiles, JSON.stringify({ fast: { model: "anthropic/claude-sonnet-4-5", thinking: "off" } }));
  await writeFile(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "offline-fixture" } }));
  const service = new JobService(manager, () => ({ depth: 0 }), undefined, profiles);
  const frames: (NativeTaskFrame | AgentCallFrame)[] = [];
  const history: { source: string; entry: string; frame: unknown }[] = [];
  const diagnostics: string[] = [];
  const root = { namespace: "bruv:test", sourceSessionId: sessionFile, sessionId: randomUUID() };
  const owner = {
    manager,
    context: ctx,
    sourceSessionId: sessionFile,
    appendEntry: (type: string, data: unknown) => session.appendCustomEntry(type, data),
  };
  const options = {
    root,
    emit: (frame: NativeTaskFrame | AgentCallFrame) => {
      frames.push(frame);
    },
    diagnostic: (text: string) => {
      diagnostics.push(text);
    },
    translateChildEntry: ({ entry }: any): ChildBody[] => {
      const message = entry.message;
      if (message.role === "assistant" || message.role === "user")
        return [{ type: message.role, message: { role: message.role, content: message.content } }];
      return [];
    },
    writeChildFrame: ({ link, entry }: any, frame: any) => {
      history.push({ source: link.child.sourceSessionId, entry: entry.id, frame });
    },
  };
  const binding = bindNativeTasks(owner, options);
  const request = (call: string, index = 1) =>
    withJobRequestIdentity(new AbortController().signal, { executeInvocationId: call, callIndex: index });
  return {
    dir,
    session,
    ctx,
    manager,
    service,
    frames,
    history,
    diagnostics,
    notifications,
    root,
    owner,
    options,
    binding,
    request,
    async close() {
      await manager.shutdown();
      await binding.close();
      disposeDiskBackedSessionManager(session);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
const subtype = (frames: any[], name: string) => frames.filter((frame) => frame.subtype === name);

test("actual JobService shell causal launch, background handoff, complete roster and confirmed late exit", async () => {
  const f = await fixture();
  try {
    const task = (await f.service.handle(
      "shell",
      { command: "sleep .08; printf real-late-output", waitSeconds: 0 },
      f.ctx,
      f.request("execute-shell"),
    )) as TaskInspection;
    await f.binding.flush();
    expect(task.launchIdentity).toMatchObject({
      sourceSessionId: f.root.sourceSessionId,
      sourceCallId: "execute-shell",
      callIndex: 1,
    });
    expect(subtype(f.frames, "task_started")).toHaveLength(1);
    expect(subtype(f.frames, "task_started")[0].tool_use_id).toBe("execute-shell");
    expect(subtype(f.frames, "task_notification")).toHaveLength(0);
    const liveRoster = subtype(f.frames, "background_tasks_changed").at(-1);
    expect(liveRoster.tasks).toHaveLength(1);
    expect(liveRoster.tasks[0].task_type).toBe("local_bash");
    // A root result/new user turn is NOT a binding reset: the same source owns late completion.
    await f.manager.wait(task.id);
    await f.binding.flush();
    expect(subtype(f.frames, "task_notification")).toHaveLength(1);
    expect(subtype(f.frames, "task_notification")[0]).toMatchObject({
      tool_use_id: "execute-shell",
      status: "completed",
      summary: "real-late-output",
    });
    expect(subtype(f.frames, "task_progress")).toHaveLength(0);
    expect(subtype(f.frames, "background_tasks_changed").at(-1).tasks).toEqual([]);
    expect(f.session.getBranch().some((e) => e.type === "custom" && e.customType === TASK_BINDING_ENTRY)).toBe(true);
    expect(f.diagnostics).toEqual([]);
  } finally {
    await f.close();
  }
});

test("actual shell failures and stop requests project ONLY confirmed process close", async () => {
  const f = await fixture();
  try {
    const failed = (await f.service.handle(
      "shell",
      { command: "printf failed-output; exit 4", waitSeconds: 1 },
      f.ctx,
      f.request("execute-failure"),
    )) as TaskInspection;
    await f.binding.flush();
    expect(failed.status).toBe("failed");
    expect(subtype(f.frames, "task_notification")[0]).toMatchObject({ status: "failed", summary: "failed-output" });
    const task = (await f.service.handle(
      "shell",
      { command: "sleep 30", waitSeconds: 0 },
      f.ctx,
      f.request("execute-stop"),
    )) as TaskInspection;
    await f.binding.flush();
    await f.service.handle("jobs.stop", { id: task.id }, f.ctx, f.request("stop-call"));
    await f.manager.wait(task.id);
    await f.binding.flush();
    expect(subtype(f.frames, "task_notification").at(-1)).toMatchObject({
      status: "stopped",
      tool_use_id: "execute-stop",
    });
    expect(subtype(f.frames, "task_started")).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("real local worker subprocess, actual Pi journal/model usage, distinct Agent identity and exact history source", async () => {
  const f = await fixture();
  const configDir = join(f.dir, "isolated-native-config");
  const native = await NativeHistory.open({
    configDir,
    cwd: f.dir,
    sessionId: f.root.sessionId,
    sourceSessionId: f.root.sourceSessionId,
  });
  const sourcePrompt = f.session.appendMessage({
    role: "user",
    content: "launch the actual requested work",
    timestamp: Date.now(),
  });
  await native.append({
    sourceMessageId: sourcePrompt,
    type: "user",
    message: { role: "user", content: "launch the actual requested work" },
    timestamp: new Date().toISOString(),
  });
  const recordChild = f.options.writeChildFrame;
  f.options.writeChildFrame = async (source, frame) => {
    const writer = await native.child({
      taskId: nativeTaskId(source.link),
      sourceSessionId: source.link.child.sourceSessionId,
      sourceCallId: source.link.launchToolUseId,
    });
    await writer.append({
      sourceMessageId: source.entry.id,
      type: frame.type,
      message: frame.message,
      timestamp: source.entry.timestamp,
      uuid: frame.uuid,
    });
    recordChild(source, frame);
  };
  const originalSpawn = f.manager.spawn.bind(f.manager);
  // The unbundled test runner is not the production Bruv executable. Replace ONLY
  // its command line with a real Pi child harness, retaining JobService's prepared
  // child identity/prompt/profile and all manager process/lifecycle ownership.
  const spawn = spyOn(f.manager, "spawn").mockImplementation((launch) =>
    originalSpawn({
      ...launch,
      command: process.execPath,
      args: [
        resolve("tests/fixtures/claude-task-worker.ts"),
        launch.agent!.sessionFile,
        launch.launchIdentity!.prompt!,
      ],
    }),
  );
  try {
    const task = (await f.service.handle(
      "subagent",
      { type: "fast", prompt: "the actual requested work", waitSeconds: 0 },
      f.ctx,
      f.request("execute-with-many-helpers", 2),
    )) as TaskInspection;
    await f.binding.flush();
    expect(task.background).toBe(true);
    expect(task.agent!.parentSessionFile).toBe(f.root.sourceSessionId);
    const agentId = agentLaunchToolUseId(task);
    expect(agentId).not.toBe("execute-with-many-helpers");
    const call = f.frames.find(
      (frame: any) => frame.type === "assistant" && frame.parent_tool_use_id === null,
    ) as AgentCallFrame;
    expect(call.bruv).toMatchObject({
      sourceCallId: "execute-with-many-helpers",
      callIndex: 2,
      jobId: task.id,
      prompt: "the actual requested work",
      profile: "fast",
    });
    expect(call.message.content).toEqual([
      {
        type: "tool_use",
        id: agentId,
        name: "Agent",
        input: {
          prompt: "the actual requested work",
          subagent_type: "fast",
          description: "the actual requested work",
        },
      },
    ]);
    expect(subtype(f.frames, "task_started")[0]).toMatchObject({
      task_type: "local_agent",
      tool_use_id: agentId,
      is_backgrounded: true,
      prompt: "the actual requested work",
      subagent_type: "fast",
      spawn_depth: 1,
    });
    const completed = await f.manager.wait(task.id);
    await f.binding.flush();
    if (completed.status !== "completed") console.log("worker failure", completed.output);
    expect(completed.status).toBe("completed");
    expect(completed.output).toContain("actual worker answer: the actual requested work");
    expect(f.history).toHaveLength(2);
    expect(f.history.every((entry) => entry.source === task.agent!.sessionFile)).toBe(true);
    expect(f.history.every((entry: any) => entry.frame.parent_tool_use_id === agentId)).toBe(true);
    const journal = await readFile(task.agent!.sessionFile, "utf8");
    expect(f.history.every((entry) => journal.includes(entry.entry))).toBe(true);
    expect(subtype(f.frames, "task_notification").at(-1)).toMatchObject({
      tool_use_id: agentId,
      status: "completed",
      usage: { total_tokens: 23, tool_uses: 0 },
    });
    const child = f.frames.find(
      (frame: any) => frame.type === "assistant" && frame.parent_tool_use_id === agentId,
    ) as any;
    expect(child.message.content).toEqual([{ type: "text", text: "actual worker answer: the actual requested work" }]);
    expect(subtype(f.frames, "task_progress").some((frame) => frame.usage.total_tokens === 23)).toBe(true);
    expect(f.diagnostics).toEqual([]);
    const taskId = subtype(f.frames, "task_started")[0].task_id;
    const writer = await native.child({ taskId, sourceSessionId: task.agent!.sessionFile, sourceCallId: agentId });
    const stored = (await readFile(writer.filePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(stored.map((entry) => entry.uuid)).toEqual(f.history.map((entry: any) => entry.frame.uuid));
    expect(stored.every((entry) => entry.bruv.sourceSessionId === task.agent!.sessionFile)).toBe(true);
    const sdkPath = resolve(process.env.BRUV_CLAUDE_SDK_PATH ?? ".cache/claude-compat-boundary/package/sdk.mjs");
    if (existsSync(sdkPath)) {
      expect(JSON.parse(await readFile(join(dirname(sdkPath), "package.json"), "utf8")).version).toBe("0.3.276");
      const script =
        "const sdk = await import(" +
        JSON.stringify(pathToFileURL(sdkPath).href) +
        "); console.log(JSON.stringify(await sdk.getSubagentMessages(" +
        JSON.stringify(f.root.sessionId) +
        "," +
        JSON.stringify(taskId) +
        ", {dir:" +
        JSON.stringify(f.dir) +
        "})));";
      const child = Bun.spawn([process.execPath, "-e", script], {
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(child.stdout).text();
      const err = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(err).toBe("");
      const messages = JSON.parse(out);
      expect(messages).toHaveLength(2);
      expect(messages.map((message: any) => message.uuid)).toEqual(stored.map((entry) => entry.uuid));
      expect(messages.every((message: any) => message.parent_tool_use_id === agentId)).toBe(true);
    } else if (process.env.BRUV_REQUIRE_CLAUDE_SDK === "1") throw new Error("Required pinned native SDK is missing");
  } finally {
    spawn.mockRestore();
    await f.close();
  }
}, 20000);

test("reattach cursors do not resurrect jobs or emit fake starts; owner mismatch rejected", async () => {
  const f = await fixture();
  try {
    const task = (await f.service.handle(
      "shell",
      { command: "printf complete", waitSeconds: 1 },
      f.ctx,
      f.request("execute-persist"),
    )) as TaskInspection;
    await f.binding.flush();
    await f.binding.close();
    const count = subtype(f.frames, "task_notification").length;
    const next = bindNativeTasks(f.owner, f.options);
    await next.flush();
    expect(subtype(f.frames, "task_notification")).toHaveLength(count);
    expect(subtype(f.frames, "task_started")).toHaveLength(1);
    await next.close();
    const emptyManager = new TaskManager(() => {});
    const fresh = bindNativeTasks({ ...f.owner, manager: emptyManager }, f.options);
    await fresh.flush();
    expect(emptyManager.list()).toEqual([]);
    expect(subtype(f.frames, "background_tasks_changed").at(-1).tasks).toEqual([]);
    expect(() => bindNativeTasks({ ...f.owner, sourceSessionId: "someone-else" }, f.options)).toThrow("owning session");
    await fresh.close();
    await emptyManager.shutdown();
    expect(f.manager.inspect(task.id).status).toBe("completed");
  } finally {
    await f.close();
  }
});

test("actual SDK execute bridge binds two shells and a real Pi worker without label inference", async () => {
  const f = await fixture();
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  const observed: any[] = [];
  let tasks: TaskManager | undefined;
  let restoreSpawn: (() => void) | undefined;
  const environment = ["BRUV_SUBAGENT_DEPTH", "BRUV_SUBAGENT_TYPE"].map((key) => [key, process.env[key]] as const);
  // This test creates its own root SDK session; do not inherit the outer test-runner worker profile.
  for (const [key] of environment) delete process.env[key];
  try {
    await f.binding.close(); // This fixture authority is not installed into the SDK session.
    const runner = join(f.dir, "execute-runner");
    await writeFile(
      runner,
      "#!" +
        process.execPath +
        "\nimport { runTypeScriptFromStdin } from " +
        JSON.stringify(resolve("src/typescript/runner.ts")) +
        "; await runTypeScriptFromStdin(); process.exit(0);\n",
    );
    await chmod(runner, 0o700);
    const models = await ModelRuntime.create({
      authPath: join(f.dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const model = models.getModel("anthropic", "claude-sonnet-4-5")!;
    models.streamSimple = (_model, context) => {
      const complete = context.messages.some((m) => m.role === "toolResult");
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        usage: {
          input: 11,
          output: 7,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 18,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: complete ? "stop" : "toolUse",
        content: complete
          ? [{ type: "text", text: "done" }]
          : [
              {
                type: "toolCall",
                id: "actual-sdk-execute-call",
                name: "execute",
                arguments: {
                  label: "An arbitrary label that must NOT become Agent",
                  code: 'console.log(await shell("printf first", { waitSeconds: 1 })); console.log(await shell("printf second", { waitSeconds: 1 })); console.log(await subagent({ type: "fast", prompt: "SDK-launched work", waitSeconds: 1 }));',
                },
              },
            ],
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: complete ? "stop" : "toolUse", message });
      stream.end(message);
      return stream;
    };
    const settings = SettingsManager.inMemory({ cacheWarming: "off" }, { projectTrusted: false });
    const loader = new DefaultResourceLoader({
      cwd: f.dir,
      agentDir: f.dir,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: "bruv-tools",
          hidden: true,
          factory: createTaskBindingExtension({
            tasks: { executablePath: runner, profilesPath: join(f.dir, "profiles.json") },
            root: (owner) => {
              tasks = owner.manager;
              const original = tasks.spawn.bind(tasks);
              const spy = spyOn(tasks, "spawn").mockImplementation((launch) =>
                launch.kind === "agent"
                  ? original({
                      ...launch,
                      command: process.execPath,
                      args: [
                        resolve("tests/fixtures/claude-task-worker.ts"),
                        launch.agent!.sessionFile,
                        launch.launchIdentity!.prompt!,
                      ],
                    })
                  : original(launch),
              );
              restoreSpawn = () => spy.mockRestore();
              return { ...f.root, sourceSessionId: owner.sourceSessionId };
            },
            translateChildEntry: f.options.translateChildEntry,
            writeChildFrame: f.options.writeChildFrame,
            emit: (frame) => {
              observed.push(frame);
            },
          }),
        },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: f.dir,
      agentDir: f.dir,
      modelRuntime: models,
      model,
      sessionManager: f.session,
      settingsManager: settings,
      resourceLoader: loader,
      tools: ["execute"],
    }));
    await session.bindExtensions({ mode: "rpc" });
    await session.prompt("run the actual shells");
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    if (tasks!.list().length !== 3)
      console.log(
        "actual root error",
        session.messages.filter((m) => m.role === "toolResult").map((m) => m.content),
      );
    expect(tasks!.list()).toHaveLength(3);
    expect(tasks!.list().map((task) => task.launchIdentity)).toEqual([
      { sourceSessionId: f.root.sourceSessionId, sourceCallId: "actual-sdk-execute-call", callIndex: 1 },
      { sourceSessionId: f.root.sourceSessionId, sourceCallId: "actual-sdk-execute-call", callIndex: 2 },
      {
        sourceSessionId: f.root.sourceSessionId,
        sourceCallId: "actual-sdk-execute-call",
        callIndex: 3,
        prompt: "SDK-launched work",
        profile: "fast",
      },
    ]);
    expect(subtype(observed, "task_started")).toHaveLength(3);
    expect(subtype(observed, "task_notification").map((frame) => frame.summary)).toEqual([
      "first",
      "second",
      "actual worker answer: SDK-launched work",
    ]);
    expect(
      subtype(observed, "task_started")
        .slice(0, 2)
        .every((frame) => frame.tool_use_id === "actual-sdk-execute-call"),
    ).toBe(true);
    const agent = observed.filter((frame) => frame.type === "assistant" && frame.parent_tool_use_id === null);
    expect(agent).toHaveLength(1); // ONLY the actual worker launch, never arbitrary execute.
    expect(agent[0].message.content[0]).toMatchObject({
      name: "Agent",
      id: agentLaunchToolUseId(tasks!.list()[2]),
      input: { prompt: "SDK-launched work", subagent_type: "fast" },
    });
    expect(f.history).toHaveLength(2);
  } finally {
    restoreSpawn?.();
    await session?.dispose();
    await f.close();
    for (const [key, value] of environment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}, 20000);

test("full opaque shell roster retains the other running job after one real exit", async () => {
  const f = await fixture();
  try {
    const a = (await f.service.handle(
      "shell",
      { command: "sleep .25", waitSeconds: 0 },
      f.ctx,
      f.request("roster-a"),
    )) as TaskInspection;
    const b = (await f.service.handle(
      "shell",
      { command: "sleep .5", waitSeconds: 0 },
      f.ctx,
      f.request("roster-b"),
    )) as TaskInspection;
    await f.binding.flush();
    const both = subtype(f.frames, "background_tasks_changed").at(-1).tasks;
    expect(both).toHaveLength(2);
    expect(new Set(both.map((task: any) => task.task_id)).size).toBe(2);
    await f.manager.wait(a.id);
    await f.binding.flush();
    expect(subtype(f.frames, "background_tasks_changed").at(-1).tasks).toHaveLength(1);
    await f.manager.wait(b.id);
    await f.binding.flush();
    expect(subtype(f.frames, "background_tasks_changed").at(-1).tasks).toEqual([]);
    expect(f.frames.some((frame: any) => frame.type === "assistant" || frame.task_type === "monitor")).toBe(false);
  } finally {
    await f.close();
  }
});

test("failed OS spawn never creates a fictitious live native task", async () => {
  const f = await fixture();
  try {
    const task = f.manager.spawn({
      kind: "command",
      command: join(f.dir, "missing-executable"),
      displayCommand: "missing executable",
      cwd: f.dir,
      launchIdentity: { sourceSessionId: f.root.sourceSessionId, sourceCallId: "actual-failed-spawn", callIndex: 1 },
    });
    expect(task.pid).toBeUndefined();
    const completed = await f.manager.wait(task.id);
    await f.binding.flush();
    expect(completed.status).toBe("failed");
    expect(subtype(f.frames, "task_started")).toHaveLength(0);
    expect(subtype(f.frames, "task_notification")).toHaveLength(0);
    expect(subtype(f.frames, "background_tasks_changed").at(-1).tasks).toEqual([]);
    expect(f.diagnostics.some((message) => message.includes("No confirmed process spawn"))).toBe(true);
  } finally {
    await f.close();
  }
});

test("already-exited async launch never also becomes an inline ACK-owned result", async () => {
  const f = await fixture();
  try {
    const task = f.manager.spawn({
      kind: "command",
      command: "/bin/sh",
      args: ["-c", "printf already-exited"],
      displayCommand: "fast async launch",
      cwd: f.dir,
      notifyOnComplete: true,
      launchIdentity: { sourceSessionId: f.root.sourceSessionId, sourceCallId: "fast-async-call", callIndex: 1 },
    });
    await f.manager.wait(task.id);
    const result = await f.manager.foreground(task.id, 0);
    await f.binding.flush();
    expect(result).toMatchObject({ background: true, status: "completed", output: "already-exited" });
    expect(f.notifications).toHaveLength(1);
    expect(subtype(f.frames, "task_started")[0].is_backgrounded).toBe(true);
    expect(subtype(f.frames, "task_notification")).toHaveLength(1);
  } finally {
    await f.close();
  }
});
