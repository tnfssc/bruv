import { expect, spyOn, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type JobDiagnosticInput, JobService } from "../../src/tasks/job-service";
import { TaskManager } from "../../src/tasks/task-manager";
import { formatTaskRow, type TaskRow, taskRowFromLaunch, upsertTaskRow } from "../../src/ui/task-rows";

import { ownedProcessSuite } from "../helpers/owned-process-suite";

ownedProcessSuite(import.meta.path, () => {
  const signal = new AbortController().signal;

  // Replace only the child runtime; TaskManager still owns receipts, waits and exit.
  function substituteAgentProcess(manager: TaskManager) {
    const spawn = manager.spawn.bind(manager);
    return spyOn(manager, "spawn").mockImplementation((launch) =>
      spawn({
        ...launch,
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 30)"],
      }),
    );
  }
  test("job helper validation rejects invalid inputs before spawning", async () => {
    const manager = new TaskManager(() => {}),
      service = new JobService(
        manager,
        () => ({ depth: 0 }),
        () => {},
      );
    try {
      for (const [method, params] of [
        ["shell", { command: "" }],
        ["shell", { command: "echo bad", waitSeconds: -1 }],
        ["shell", { command: "echo bad", waitSeconds: Infinity }],
        ["jobs.inspect", { id: "x", limit: 5001 }],
        ["jobs.list", { count: 101 }],
        ["subagent", { prompt: "x", model: "p/override" }],
        ["subagent", { type: "bad", prompt: "x" }],
        ["jobs.input", { id: "x" }],
      ])
        await expect(service.handle(method as string, params, { cwd: process.cwd() } as any, signal)).rejects.toThrow();
      expect(manager.list()).toHaveLength(0);
    } finally {
      await manager.shutdown();
    }
  });
  test("shell closes stdin by default while explicit open input remains writable", async () => {
    const manager = new TaskManager(() => {}),
      service = new JobService(
        manager,
        () => ({ depth: 0 }),
        () => {},
      ),
      ctx = { cwd: process.cwd() } as any;
    try {
      const closed = (await service.handle(
        "shell",
        { command: "cat >/dev/null; printf eof", waitSeconds: 1 },
        ctx,
        signal,
      )) as { status: string; output: string; stdinOpen?: boolean };
      expect(closed).toMatchObject({ status: "completed", output: "eof", stdinOpen: false });

      const launched = (await service.handle(
        "shell",
        {
          command: "cat",
          waitSeconds: 0,
          closeInput: false,
        },
        ctx,
        signal,
      )) as { id: string; status: string; stdinOpen?: boolean };
      expect(launched).toMatchObject({ status: "running", stdinOpen: true });

      const stillOpen = (await service.handle("jobs.input", { id: launched.id, data: "one\n" }, ctx, signal)) as {
        stdinOpen?: boolean;
      };
      expect(stillOpen.stdinOpen).toBe(true);
      await service.handle("jobs.input", { id: launched.id, data: "two\n", closeInput: true }, ctx, signal);
      const finished = await manager.wait(launched.id);
      expect(finished.output).toBe("one\ntwo\n");
      expect(finished.stdinOpen).toBe(false);
    } finally {
      await manager.shutdown();
    }
  });

  test("records metadata-only dispatch lifecycle against the supplied session recorder", async () => {
    const manager = new TaskManager(() => {}),
      records: JobDiagnosticInput[] = [];
    const service = new JobService(
      manager,
      () => ({ depth: 0 }),
      () => {},
      undefined,
      undefined,
      (input) => records.push(input),
    );
    try {
      const result = (await service.handle(
        "shell",
        { command: "printf private-value", waitSeconds: 1 },
        { cwd: process.cwd() } as any,
        signal,
      )) as { id: string };
      expect(records).toHaveLength(2);
      expect(records[0]!.dispatch).toBe("initiated");
      expect(records[1]).toMatchObject({ dispatch: "response", outcome: "success", taskId: result.id });
      expect(records[1]!.operationId).toBe(records[0]!.operationId);
      expect(JSON.stringify(records)).not.toContain("private-value");

      await expect(service.handle("unknown", {}, { cwd: process.cwd() } as any, signal)).rejects.toThrow(
        "Unknown job method",
      );
      expect(records.at(-1)).toMatchObject({ dispatch: "response", outcome: "failed" });
    } finally {
      await manager.shutdown();
    }
  });

  test("local profile settings become child arguments and launch options", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-jobs-profile-"));
    const profilesPath = join(dir, "profiles.json");
    await writeFile(profilesPath, JSON.stringify({ fast: { model: "p/quick", thinking: "off" } }));
    const manager = new TaskManager(() => {});
    const spawn = substituteAgentProcess(manager);
    const foreground = spyOn(manager, "foreground");
    const service = new JobService(manager, () => ({ depth: 0 }), undefined, profilesPath);
    const ctx = {
      cwd: dir,
      model: { provider: "p", id: "parent" },
      thinkingLevel: "medium",
      sessionManager: { getSessionDir: () => dir, getSessionFile: () => undefined },
    } as any;
    try {
      await service.handle(
        "subagent",
        { type: "fast", prompt: "scout", title: "Inspect renderer", timeoutSeconds: 2 },
        ctx,
        signal,
      );
      const launch = spawn.mock.calls[0]![0];
      expect(launch.title).toBe("Inspect renderer");
      expect(launch.args).toEqual([
        "--session",
        launch.agent!.sessionFile,
        "--mode",
        "json",
        "-p",
        "--model",
        "p/quick",
        "--thinking",
        "off",
        "--",
        "scout",
      ]);
      expect(launch).toMatchObject({
        command: process.execPath,
        cwd: dir,
        timeoutMs: 2000,
        closeStdin: true,
        notifyOnComplete: false,
      });
      expect(launch.workspace).toBeUndefined();
      expect(launch.env?.BRUV_SUBAGENT_TYPE).toBe("fast");
      expect(foreground.mock.calls[0]![1]).toBe(1000);
    } finally {
      spawn.mockRestore();
      foreground.mockRestore();
      await manager.shutdown();
    }
  });

  test("delegation policy permits only orchestrator children and caps depth at two", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-jobs-depth-"));
    const profilesPath = join(dir, "profiles.json");
    await writeFile(profilesPath, JSON.stringify({ fast: { model: "p/quick" } }));
    const manager = new TaskManager(() => {});
    const spawn = substituteAgentProcess(manager);
    let policy: { depth: number; type?: string } = { depth: 1 };
    const service = new JobService(manager, () => policy, undefined, profilesPath);
    const ctx = {
      cwd: dir,
      model: { provider: "p", id: "parent" },
      sessionManager: { getSessionDir: () => dir, getSessionFile: () => undefined },
    } as any;
    try {
      for (const type of ["fast", "normal"]) {
        policy = { depth: 1, type };
        await expect(service.handle("subagent", { prompt: "x" }, ctx, signal)).rejects.toThrow("Only orchestrator");
      }
      policy = { depth: 1, type: "orchestrator" };
      await expect(service.handle("subagent", { type: "orchestrator", prompt: "x" }, ctx, signal)).rejects.toThrow(
        "fast/normal",
      );
      expect(spawn).not.toHaveBeenCalled();

      await service.handle("subagent", { type: "fast", prompt: "x" }, ctx, signal);
      expect(spawn).toHaveBeenCalledTimes(1);
      const launch = spawn.mock.calls[0]![0];
      expect(launch.title).toBe("x");
      expect(launch.env?.BRUV_SUBAGENT_DEPTH).toBe("2");
      expect(dirname(launch.agent!.sessionFile!)).toBe(dir);

      policy = { depth: 2, type: "orchestrator" };
      await expect(service.handle("subagent", { prompt: "x" }, ctx, signal)).rejects.toThrow("two levels");
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      spawn.mockRestore();
      await manager.shutdown();
    }
  });

  test("local subagents inherit the parent's persisted native fast setting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-jobs-native-fast-"));
    const profilesPath = join(dir, "profiles.json");
    await writeFile(profilesPath, JSON.stringify({ fast: { model: "p/quick" } }));
    const manager = new TaskManager(() => {});
    const spawn = substituteAgentProcess(manager);
    const service = new JobService(manager, () => ({ depth: 0 }), undefined, profilesPath);
    const model = {
      provider: "openai-codex",
      id: "gpt-6.1-sol",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
    };
    const fastSetting = {
      type: "custom",
      customType: "bruv-native-fast-mode",
      data: {
        version: 2,
        oauth: true,
        sessionId: "parent",
        provider: model.provider,
        model: model.id,
        enabled: true,
        costAcknowledged: true,
        timestamp: 1,
      },
    };
    const ctx = {
      cwd: dir,
      model,
      modelRegistry: { isUsingOAuth: () => true },
      sessionManager: {
        getSessionDir: () => dir,
        getSessionFile: () => undefined,
        getSessionId: () => "parent",
        getCwd: () => dir,
        getBranch: () => [fastSetting],
      },
    } as any;
    try {
      await service.handle("subagent", { type: "fast", prompt: "inherit premium tier" }, ctx, signal);
      expect(spawn.mock.calls[0]![0].env?.BRUV_SUBAGENT_NATIVE_FAST).toBe("1");
      ctx.model = { ...ctx.model, provider: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1" };
      fastSetting.data.provider = ctx.model.provider;
      await service.handle("subagent", { type: "fast", prompt: "inherit new ChatGPT login tier" }, ctx, signal);
      expect(spawn.mock.calls.at(-1)![0].env?.BRUV_SUBAGENT_NATIVE_FAST).toBe("1");
      fastSetting.data.enabled = false;
      await service.handle("subagent", { type: "fast", prompt: "standard tier" }, ctx, signal);
      expect(spawn.mock.calls.at(-1)![0].env?.BRUV_SUBAGENT_NATIVE_FAST).toBe("0");
    } finally {
      spawn.mockRestore();
      await manager.shutdown();
    }
  });

  test("partial subagent spawn failure stops and notifies already-launched workers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-jobs-partial-spawn-")),
      profilesPath = join(dir, "profiles.json");
    await writeFile(profilesPath, JSON.stringify({ fast: { model: "fixture/fast" } }));
    const notifications: any[] = [],
      manager = new TaskManager((task) => notifications.push(task)),
      originalSpawn = manager.spawn.bind(manager),
      launchFailure = new Error("second spawn failed");
    const spawn = spyOn(manager, "spawn")
      .mockImplementationOnce((launch) =>
        originalSpawn({
          ...launch,
          command: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000)"],
        }),
      )
      .mockImplementationOnce(() => {
        throw launchFailure;
      });
    const service = new JobService(
      manager,
      () => ({ depth: 0 }),
      () => {
        throw new Error("refresh failed");
      },
      profilesPath,
    );
    const ctx = { cwd: dir, model: { provider: "fixture", id: "parent" } } as any;
    try {
      const error = await service
        .handle("subagent", { type: "fast", prompts: ["started", "fails"] }, ctx, signal)
        .catch((error) => error);
      expect(error).toBe(launchFailure);

      const [task] = manager.list();
      expect(task).toBeDefined();
      expect(task!.termination?.cause).toBe("execute-cancellation");
      await manager.wait(task!.id);
      expect(manager.inspect(task!.id).status).toBe("killed");
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ id: task!.id, status: "killed" });
    } finally {
      spawn.mockRestore();
      await manager.shutdown();
    }
  });

  test("optional and failing refresh callbacks cannot strand successful launches", async () => {
    for (const changed of [
      undefined,
      () => {
        throw new Error("refresh failed");
      },
    ]) {
      const manager = new TaskManager(() => {});
      const foreground = spyOn(manager, "foreground");
      const service = new JobService(manager, () => ({ depth: 0 }), changed);
      try {
        const result = (await service.handle(
          "shell",
          { command: "printf ok", waitSeconds: 1 },
          { cwd: process.cwd() } as any,
          signal,
        )) as { status: string; output: string };
        expect(foreground).toHaveBeenCalledTimes(1);
        expect(result.status).toBe("completed");
        expect(result.output).toBe("ok");
      } finally {
        foreground.mockRestore();
        await manager.shutdown();
      }
    }
  });

  test("healthy inspection polling does not produce per-poll diagnostics", async () => {
    const manager = new TaskManager(() => {}),
      records: JobDiagnosticInput[] = [];
    const service = new JobService(
      manager,
      () => ({ depth: 0 }),
      () => {},
      undefined,
      undefined,
      (input) => records.push(input),
    );
    try {
      for (let i = 0; i < 100; i++) await service.handle("jobs.list", {}, {} as any, signal);
      expect(records).toHaveLength(0);
      for (let i = 0; i < 3; i++)
        await expect(service.handle("jobs.inspect", { id: "task_missing" }, {} as any, signal)).rejects.toThrow();
      expect(records).toHaveLength(1);
    } finally {
      await manager.shutdown();
    }
  });

  test.each([
    { title: "Inspect renderer", prompt: "Arbitrary source is not a title", expected: "Inspect renderer" },
    { title: undefined, prompt: "Inspect renderer\nThen add tests", expected: "Inspect renderer Then add tests" },
    { title: "   ", prompt: "Inspect renderer", expected: "Inspect renderer" },
  ])("local subagent name survives launch, real completion and inspection: %s", async ({ title, prompt, expected }) => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-title-delivery-"));
    const profilesPath = join(dir, "profiles.json");
    await writeFile(profilesPath, JSON.stringify({ fast: { model: "fixture/fast" } }));
    let deliver!: (task: any) => void;
    const completion = new Promise<any>((resolve) => {
      deliver = resolve;
    });
    const manager = new TaskManager(deliver);
    const spawn = substituteAgentProcess(manager);
    const service = new JobService(manager, () => ({ depth: 0 }), undefined, profilesPath);
    try {
      const launch = (await service.handle(
        "subagent",
        { type: "fast", prompt, ...(title === undefined ? {} : { title }), waitSeconds: 0 },
        {
          cwd: dir,
          model: { provider: "fixture", id: "parent" },
          sessionManager: { getSessionDir: () => dir, getSessionFile: () => undefined },
        } as any,
        signal,
      )) as any;
      expect(launch).toMatchObject({ title: expected, background: true });
      const completed = await completion;
      expect(completed).toMatchObject({ id: launch.id, title: expected, status: "completed" });
      expect(manager.inspect(launch.id).title).toBe(expected);
    } finally {
      spawn.mockRestore();
      await manager.shutdown();
    }
  });

  test("shell records keep command previews out of explicit titles so execute labels survive owner updates", async () => {
    let completed!: (task: any) => void;
    const completion = new Promise<any>((resolve) => {
      completed = resolve;
    });
    const manager = new TaskManager(completed);
    const service = new JobService(manager, () => ({ depth: 0 }));
    const ctx = { cwd: process.cwd() } as any;
    try {
      const launch = (await service.handle(
        "shell",
        { command: "sleep 0.05; printf shell-output", waitSeconds: 0 },
        ctx,
        signal,
      )) as any;
      expect(launch.background).toBe(true);
      expect(launch.title).toBeUndefined();
      const rows = new Map<string, TaskRow>();
      upsertTaskRow(rows, taskRowFromLaunch(launch, "call", "Run final repaired root suite")!);
      const done = await completion;
      expect(done.title).toBeUndefined();
      upsertTaskRow(rows, taskRowFromLaunch(done)!);
      const owner = (await service.handle("jobs.inspect", { id: launch.id }, ctx, signal)) as any;
      expect(owner.title).toBeUndefined();
      upsertTaskRow(rows, taskRowFromLaunch(owner)!);
      expect(formatTaskRow([...rows.values()][0])).toBe("✓ Run final repaired root suite");
      expect(owner.output).toContain("shell-output");
    } finally {
      await manager.shutdown();
    }
  });
});
