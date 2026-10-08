import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { inspectDiagnostics } from "../src/diagnostics";
import { JobService } from "../src/tasks/job-service";
import { type TaskInspection, TaskManager } from "../src/tasks/task-manager";
import { executeIsolated } from "../src/typescript/execution";
import { registerExecuteTool } from "../src/typescript/extension";

import { ownedEnvironmentTest, ownedProcessSuite } from "./owned-process-suite";

ownedProcessSuite(import.meta.path, () => {
  const binary = resolve(import.meta.dir, "../dist/bruv");

  type JobHandler = NonNullable<NonNullable<Parameters<typeof executeIsolated>[4]>["jobHandler"]>;

  // One parent session owns jobs across multiple compiled execute invocations.
  class SessionJobs {
    readonly notifications: TaskInspection[] = [];
    readonly manager = new TaskManager((task) => this.notifications.push(task));
    private readonly service = new JobService(
      this.manager,
      () => ({ depth: 0 }),
      () => {},
    );

    readonly handle: JobHandler = (method, params, signal) =>
      this.service.handle(method, params, { cwd: process.cwd() } as any, signal);

    execute(
      code: string,
      {
        signal,
        timeoutMs = 3000,
        jobHandler = this.handle,
      }: {
        signal?: AbortSignal;
        timeoutMs?: number;
        jobHandler?: JobHandler;
      } = {},
    ) {
      return executeIsolated(code, process.cwd(), signal, timeoutMs, {
        executablePath: binary,
        jobHandler,
      });
    }

    registeredExecute(
      handler: Parameters<typeof registerExecuteTool>[1] = (ctx, method, params, signal) =>
        this.service.handle(method, params, ctx, signal),
    ) {
      let tool: any;
      registerExecuteTool(
        {
          on() {},
          registerTool(registered: any) {
            tool = registered;
          },
        } as any,
        handler,
        binary,
      );
      return (code: string, callId: string) =>
        tool.execute(callId, { code }, new AbortController().signal, () => {}, { cwd: process.cwd() });
    }

    async [Symbol.asyncDispose]() {
      await this.manager.shutdown();
    }
  }

  test("execute helpers multiplex responses, reject errors, and do not print implicitly", async () => {
    const seen: string[] = [];
    const result = await executeIsolated(
      'const values = await Promise.all([shell("one"), jobs.list()]); console.log(JSON.stringify(values)); try { await jobs.stop("bad"); } catch(e) { console.log(e.message); }',
      process.cwd(),
      undefined,
      3000,
      {
        executablePath: binary,
        jobHandler: async (method, params) => {
          seen.push(method);
          if (method === "jobs.stop") throw new Error("unknown job");
          return { method, params };
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(seen).toEqual(["shell", "jobs.list", "jobs.stop"]);
    expect(result.stdout).toContain('"command":"one"');
    expect(result.stdout).toContain("unknown job");
    expect(inspectDiagnostics(result).records).toContainEqual({
      version: 1,
      generated: expect.any(String),
      component: "bridge",
      code: "delivery_failed",
      outcome: "failed",
      dispatch: "response",
    });
  });
  test("job helpers without a session bridge fail clearly", async () => {
    const result = await executeIsolated('await shell("echo nope")', process.cwd(), undefined, 3000, {
      executablePath: binary,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("bridge is unavailable");
  });
  test("foreground work returns inline; background work survives execute and accepts input", async () => {
    await using jobs = new SessionJobs();
    const fast = await jobs.execute('console.log(JSON.stringify(await shell("printf inline")))');
    expect(fast.exitCode).toBe(0);
    expect(JSON.parse(fast.stdout)).toMatchObject({
      background: false,
      status: "completed",
      output: "inline",
    });
    expect(jobs.notifications).toHaveLength(0);
    const launch = await jobs.execute(
      'console.log(JSON.stringify(await shell("read value; printf received:$value", {waitSeconds:0,closeInput:false})))',
    );
    expect(launch.exitCode).toBe(0);
    const job = JSON.parse(launch.stdout);
    expect(job.background).toBe(true);
    expect(jobs.manager.list().find((t) => t.id === job.id)?.status).toBe("running");
    const send = await jobs.execute(
      "console.log(await jobs.input(" +
        JSON.stringify(job.id) +
        ", " +
        JSON.stringify("hello\n") +
        ", {closeInput:true}))",
    );
    expect(send.exitCode).toBe(0);
    await jobs.manager.wait(job.id);
    expect(jobs.notifications).toHaveLength(1);
    expect(jobs.notifications[0].output).toBe("received:hello");
    const inspect = await jobs.execute(
      "console.log(JSON.stringify(await jobs.inspect(" + JSON.stringify(job.id) + ")))",
    );
    expect(JSON.parse(inspect.stdout).output).toBe("received:hello");
  });
  test("canceling execute after a delayed job spawn transfers notification ownership without killing its job", async () => {
    await using jobs = new SessionJobs();
    const controller = new AbortController();
    let unsubscribe = () => {};
    const spawned = new Promise<string>((resolve) => {
      unsubscribe = jobs.manager.subscribe((event) => {
        if (event.type !== "spawned") return;
        resolve(event.task.id);
        controller.abort();
      });
    });
    try {
      const execution = jobs.execute('await shell("read value; printf survived", {waitSeconds:60,closeInput:false})', {
        signal: controller.signal,
        jobHandler: async (method, params, signal) => {
          // Reproduce startup slower than the former 200 ms execute timeout.
          await Bun.sleep(300);
          return jobs.handle(method, params, signal);
        },
      });
      const taskId = await spawned;
      const result = await execution;
      expect(result.cancelled).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(jobs.manager.inspect(taskId).status).toBe("running");
      await jobs.manager.write(taskId, "go\n", true);
      await jobs.manager.wait(taskId);
      expect(jobs.notifications).toHaveLength(1);
      expect(jobs.notifications[0].output).toBe("survived");
    } finally {
      unsubscribe();
    }
  });
  test("bridge budgets reject oversized messages without corrupting subsequent calls", async () => {
    const result = await executeIsolated(
      'try { await shell("x".repeat(1100000)); } catch(e) { console.log("request bounded"); } try { await shell("huge-result"); } catch(e) { console.log("response bounded"); } console.log(await jobs.list());',
      process.cwd(),
      undefined,
      3000,
      {
        executablePath: binary,
        jobHandler: async (method) => (method === "shell" ? "x".repeat(1100000) : "still works"),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("request bounded");
    expect(result.stdout).toContain("response bounded");
    expect(result.stdout).toContain("still works");
  });

  test("shell defaults to a three-second foreground budget", async () => {
    await using jobs = new SessionJobs();
    const started = Date.now();
    const normal = await jobs.execute('console.log(JSON.stringify(await shell("read value", {closeInput:false})))', {
      timeoutMs: 5000,
    });
    const elapsed = Date.now() - started;
    expect(normal.exitCode).toBe(0);
    expect(JSON.parse(normal.stdout).background).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(2900);
    expect(elapsed).toBeLessThan(4900);
    expect(jobs.notifications).toHaveLength(0);
  });

  test("shell zero wait returns immediately", async () => {
    await using jobs = new SessionJobs();
    const started = Date.now();
    const immediate = await jobs.execute(
      'console.log(JSON.stringify(await shell("read value", {waitSeconds:0,closeInput:false})))',
      { timeoutMs: 5000 },
    );
    expect(immediate.exitCode).toBe(0);
    expect(JSON.parse(immediate.stdout).background).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(jobs.notifications).toHaveLength(0);
  });

  test("shell timeout stays independent of the default foreground budget", async () => {
    await using jobs = new SessionJobs();
    const timeout = await jobs.execute(
      'console.log(JSON.stringify(await shell("read value", {timeoutSeconds:0.2,closeInput:false})))',
      { timeoutMs: 5000 },
    );
    expect(timeout.exitCode).toBe(0);
    expect(JSON.parse(timeout.stdout)).toMatchObject({
      background: false,
      status: "killed",
      timedOut: true,
    });
    expect(jobs.notifications).toHaveLength(0);
  });

  test("shell failure returns inline without a completion notification", async () => {
    await using jobs = new SessionJobs();
    const failure = await jobs.execute('console.log(JSON.stringify(await shell("exit 7")))', { timeoutMs: 5000 });
    expect(failure.exitCode).toBe(0);
    expect(JSON.parse(failure.stdout)).toMatchObject({
      background: false,
      status: "failed",
      exitCode: 7,
    });
    expect(jobs.notifications).toHaveLength(0);
  });

  test("canceling concurrent bridge waits hands off every launched job exactly once", async () => {
    await using jobs = new SessionJobs();
    const abort = new AbortController();
    let launched = 0;
    const result = await jobs.execute(
      'await Promise.all(Array.from({length:3}, () => shell("read value; printf done", {waitSeconds:60,closeInput:false})))',
      {
        signal: abort.signal,
        timeoutMs: 5000,
        jobHandler: (m, p, signal) => {
          const result = jobs.handle(m, p, signal);
          if (m === "shell" && ++launched === 3) abort.abort();
          return result;
        },
      },
    );
    expect(result.cancelled).toBe(true);
    const tasks = jobs.manager.list();
    expect(tasks).toHaveLength(3);
    for (const task of tasks) await jobs.manager.write(task.id, "go\n", true);
    await Promise.all(tasks.map((task) => jobs.manager.wait(task.id)));
    expect(jobs.notifications).toHaveLength(3);
    expect(new Set(jobs.notifications.map((task) => task.id)).size).toBe(3);
  });

  test("disconnect before an inline response is acknowledged restores completion notification ownership", async () => {
    await using jobs = new SessionJobs();
    const abort = new AbortController();
    const result = await jobs.execute('await shell("printf raced", {waitSeconds:60})', {
      signal: abort.signal,
      timeoutMs: 5000,
      jobHandler: async (method, params, signal) => {
        const value = await jobs.handle(method, params, signal);
        // Tear down execute after foreground selected the completed inline
        // result, but before the bridge can deliver and acknowledge it.
        abort.abort();
        return value;
      },
    });
    expect(result.cancelled).toBe(true);
    expect(jobs.notifications).toHaveLength(1);
    expect(jobs.notifications[0]).toMatchObject({
      status: "completed",
      output: "raced",
    });
  });

  test("registered execute preserves ACK ownership through its wrapper for batch subagents", async () => {
    await using jobs = new SessionJobs();
    const execute = jobs.registeredExecute(async (_ctx: any, method: string, params: any, signal: AbortSignal) => {
      if (method !== "subagent") throw new Error("unexpected method");
      const tasks = params.prompts.map((prompt: string) =>
        jobs.manager.spawn({
          kind: "agent" as const,
          command: process.execPath,
          args: ["-e", `console.log(${JSON.stringify(prompt)})`],
          displayCommand: prompt,
          cwd: process.cwd(),
          closeStdin: true,
          notifyOnComplete: false,
        }),
      );
      return Promise.all(tasks.map((task: any) => jobs.manager.foreground(task.id, 3000, signal)));
    });
    const result = await execute('console.log(JSON.stringify(await subagent({prompts:["first","second"]})))', "call");
    const values = JSON.parse(result.details.stdout);
    expect(values).toHaveLength(2);
    expect(values.map((value: any) => value.output.trim())).toEqual(["first", "second"]);
    expect(values.every((value: any) => value.background === false)).toBe(true);
    expect(jobs.notifications).toHaveLength(0);
  });

  test("ACK is provisional until clean worker exit", async () => {
    await using jobs = new SessionJobs();
    const result = await jobs.execute('await shell("printf delivered"); process.exit(7)');
    expect(result.exitCode).toBe(7);
    expect(jobs.notifications).toHaveLength(1);
    expect(jobs.notifications[0].output).toBe("delivered");
  });

  test("oversized reply releases foreground ownership exactly once", async () => {
    await using jobs = new SessionJobs();
    const result = await jobs.execute(
      'try { await shell("printf retained") } catch (error) { console.log(error.message) }',
      {
        jobHandler: async (method, params, signal) => ({
          ...((await jobs.handle(method, params, signal)) as object),
          oversized: "x".repeat(1_100_000),
        }),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("response exceeded 1 MB");
    expect(inspectDiagnostics(result).records).toContainEqual({
      version: 1,
      generated: expect.any(String),
      component: "bridge",
      code: "frame_oversize",
      outcome: "fallback",
      dispatch: "response",
    });
    expect(jobs.notifications).toHaveLength(1);
    expect(jobs.notifications[0].output).toBe("retained");
  });

  test("registered execute handoff separates completed delivery from pending wait cancellation", async () => {
    await using jobs = new SessionJobs();
    const execute = jobs.registeredExecute();
    const result = await execute(
      'await shell("printf inline"); await shell("read value; printf pending:$value", {waitSeconds:0,closeInput:false}); await handoff("waiting")',
      "handoff",
    );
    expect(result.terminate).toBe(true);
    const tasks = jobs.manager.list();
    expect(tasks).toHaveLength(2);
    const inline = tasks[0]!;
    const pending = tasks[1]!;
    expect(inline.status).toBe("completed");
    expect(pending.status).toBe("running");
    expect(jobs.notifications).toHaveLength(0);
    await jobs.manager.write(pending.id, "done\n", true);
    await jobs.manager.wait(pending.id);
    expect(jobs.notifications).toHaveLength(1);
    expect(jobs.notifications[0]).toMatchObject({
      id: pending.id,
      output: "pending:done",
    });
  });

  test("handler failure releases inline ownership from a partial batch", async () => {
    await using jobs = new SessionJobs();
    const execute = jobs.registeredExecute(async (_ctx, method, params: any, signal) => {
      if (method !== "subagent") throw new Error("unexpected method");
      let inlineReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        inlineReady = resolve;
      });
      return Promise.all(
        params.prompts.map(async (prompt: string) => {
          if (prompt === "error") {
            await ready;
            throw new Error("batch item failed");
          }
          const task = jobs.manager.spawn({
            kind: "agent",
            command: process.execPath,
            args: ["-e", "console.log('inline result')"],
            displayCommand: prompt,
            cwd: process.cwd(),
            closeStdin: true,
            notifyOnComplete: false,
          });
          const result = await jobs.manager.foreground(task.id, 3000, signal);
          inlineReady();
          return result;
        }),
      );
    });
    const result = await execute(
      'try { await subagent({prompts:["inline", "error"]}) } catch (error) { console.log(error.message) }',
      "batch",
    );
    expect(result.details.stdout).toContain("batch item failed");
    expect(jobs.notifications).toHaveLength(1);
    expect(jobs.notifications[0]).toMatchObject({ status: "completed" });
    expect(jobs.notifications[0].output.trim()).toBe("inline result");
  });

  test("execute exposes attention helper RPCs through the single bridge", async () => {
    const seen: any[] = [];
    const result = await executeIsolated(
      'console.log(JSON.stringify([await jobs.snooze("task_1",{minutes:5}),await jobs.setWatch("task_1",{enabled:false})]))',
      process.cwd(),
      undefined,
      3000,
      {
        executablePath: binary,
        jobHandler: async (method, params) => {
          seen.push([method, params]);
          return params;
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(seen).toEqual([
      ["jobs.snooze", { minutes: 5, id: "task_1" }],
      ["jobs.setWatch", { enabled: false, id: "task_1" }],
    ]);
  });
  test("goal helpers share the single execute bridge and do not print implicitly", async () => {
    const seen: any[] = [];
    const result = await executeIsolated(
      'const before=await goal.get(); await goal.set({objective:"o",criteria:["c"],constraints:[]}); console.log((await goal.update({status:"completed",evidence:"verified"})).status)',
      process.cwd(),
      undefined,
      3000,
      {
        executablePath: binary,
        jobHandler: async (method, params) => {
          seen.push([method, params]);
          return method === "goal.update" ? { status: "completed" } : null;
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("completed");
    expect(seen.map((x) => x[0])).toEqual(["goal.get", "goal.set", "goal.update"]);
  });

  test("history helpers share the execute bridge with explicit parameters", async () => {
    const seen: any[] = [];
    const result = await executeIsolated(
      'const found=await history.search({query:"needle",limit:2}); console.log((await history.read({ref:found.ref,maxChars:9})).text)',
      process.cwd(),
      undefined,
      3000,
      {
        executablePath: binary,
        jobHandler: async (method, params) => {
          seen.push([method, params]);
          return method === "history.search" ? { ref: "bruv-history-v1:s:e:0" } : { text: "evidence" };
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("evidence");
    expect(seen).toEqual([
      ["history.search", { query: "needle", limit: 2 }],
      ["history.read", { ref: "bruv-history-v1:s:e:0", maxChars: 9 }],
    ]);
  });

  ownedEnvironmentTest(
    import.meta.path,
    "execute cannot read T3 bridge credentials while parent job capability remains available",
    {
      T3_MCP_URL: "http://secret.invalid/mcp",
      T3_MCP_BEARER_TOKEN: "SECRET_EXECUTE_TOKEN",
      BRUV_SAFE_SENTINEL: "visible",
    },
    async () => {
      const seen: string[] = [];
      const result = await executeIsolated(
        'console.log(JSON.stringify({url:process.env.T3_MCP_URL,token:process.env.T3_MCP_BEARER_TOKEN,safe:process.env.BRUV_SAFE_SENTINEL,job:await subagent({prompt:"work",type:"fast"})}))',
        process.cwd(),
        undefined,
        3_000,
        {
          executablePath: binary,
          jobHandler: async (method) => {
            seen.push(method);
            return { id: "native-1", background: true };
          },
        },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        safe: "visible",
        job: { id: "native-1", background: true },
      });
      expect(seen).toEqual(["subagent"]);
      expect(result.stdout).not.toContain("SECRET_EXECUTE_TOKEN");
    },
  );
});
