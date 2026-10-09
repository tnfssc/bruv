import { expect, spyOn, test } from "bun:test";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { TaskManager } from "../../src/tasks/task-manager";
import * as execution from "../../src/typescript/execution";
import { registerExecuteTool } from "../../src/typescript/extension";
import { executeOutputPreview } from "../../src/ui/execution-previews";

for (const mode of ["inline", "background", "error"] as const)
  test("execute handoff notice: " + mode, async () => {
    let tool!: ToolDefinition;
    const mock = spyOn(execution, "executeIsolated").mockImplementation(
      async (_code, _cwd, _signal, _timeout, options) => {
        await options!.jobHandler!("subagent", {}, new AbortController().signal);
        return {
          exitCode: mode === "error" ? 1 : 0,
          stdout: "",
          stderr: mode === "error" ? "code failed after launch" : "",
          stdoutLost: false,
          stderrLost: false,
          timedOut: false,
          cancelled: false,
          images: [],
        };
      },
    );
    try {
      registerExecuteTool(
        {
          registerTool(value: ToolDefinition) {
            tool = value;
          },
          on() {},
        } as unknown as ExtensionAPI,
        async () => [
          { id: "background-one", background: mode !== "inline" },
          { id: "inline-two", background: false },
        ],
      );
      const pending = tool.execute("test", { code: "" }, undefined, undefined, {
        cwd: process.cwd(),
      } as ExtensionToolContext);
      if (mode === "error") {
        await expect(pending).rejects.toThrow("Background jobs: background-one");
      } else {
        const result = await pending;
        const text = result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        if (mode === "background") {
          expect(text).toContain("Background jobs: background-one");
          expect(text).not.toContain("Results come later.");
          expect(text).not.toContain("inline-two");
          expect((result.details as any).stdout).toBe("");
        } else expect(text).not.toContain("Background handoff");
      }
    } finally {
      mock.mockRestore();
    }
  });

test("cooperative handoff releases a foreground wait, preserves its job, and notifies once", async () => {
  let tool!: ToolDefinition;
  let id = "";
  let notifications = 0;
  let complete!: () => void;
  const completion = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const manager = new TaskManager(() => {
    notifications++;
    complete();
  });
  const mock = spyOn(execution, "executeIsolated").mockImplementation(
    async (_code, _cwd, _signal, _timeout, options) => {
      const signal = new AbortController().signal;
      const waiting = options!.jobHandler!("shell", {}, signal);
      await options!.jobHandler!("handoff", { message: "Waiting for a dependency" }, signal);
      const launched = (await waiting) as any;
      expect(launched.background).toBe(true);
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        stdoutLost: false,
        stderrLost: false,
        timedOut: false,
        cancelled: false,
        images: [],
      };
    },
  );
  try {
    registerExecuteTool(
      {
        registerTool(value: ToolDefinition) {
          tool = value;
        },
        on() {},
      } as unknown as ExtensionAPI,
      async (_ctx, _method, _params, signal) => {
        const task = manager.spawn({
          kind: "command",
          command: "/bin/sh",
          args: ["-c", "read value; printf survived"],
          displayCommand: "input gate",
          cwd: process.cwd(),
        });
        id = task.id;
        return manager.foreground(id, 30000, signal);
      },
    );
    const result = await tool.execute("handoff", { code: "" }, undefined, undefined, {
      cwd: process.cwd(),
    } as ExtensionToolContext);
    expect(result.terminate).toBe(true);
    expect((result.details as any).handoff).toBe("Waiting for a dependency");
    expect((result.details as any).backgroundJobs).toEqual([id]);
    expect(manager.inspect(id).status).toBe("running");
    expect(notifications).toBe(0);
    const theme = { fg: (_: unknown, text: string) => text } as any;
    const collapsed = executeOutputPreview(result, false, false, theme).render(80);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].trimEnd()).toBe("↪ Waiting for a dependency");
    expect(collapsed.join("\n").split("Waiting for a dependency")).toHaveLength(2);
    const expanded = executeOutputPreview(result, true, false, theme).render(80).join("\n");
    expect(expanded).toContain("Waiting for a dependency");
    const modelVisible = result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    expect(modelVisible).toContain("Waiting for a dependency");
    await manager.write(id, "go\n", true);
    await completion;
    expect(manager.inspect(id).output).toBe("survived");
    expect(notifications).toBe(1);
  } finally {
    mock.mockRestore();
    await manager.shutdown();
  }
});

for (const message of [42, "", "   ", "x".repeat(2001)])
  test("handoff validates progress text: " + String(message).slice(0, 10), async () => {
    let accepted = false;
    let tool!: ToolDefinition;
    const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_c, _w, _s, _t, options) => {
      await options!.jobHandler!("handoff", { message }, new AbortController().signal);
      accepted = true;
      throw new Error("unexpected acceptance");
    });
    try {
      registerExecuteTool({
        registerTool(value: ToolDefinition) {
          tool = value;
        },
        on() {},
      } as unknown as ExtensionAPI);
      await expect(
        tool.execute("bad", { code: "" }, undefined, undefined, { cwd: process.cwd() } as ExtensionToolContext),
      ).rejects.toThrow();
      expect(accepted).toBe(false);
    } finally {
      mock.mockRestore();
    }
  });

test("accepted handoff cannot hide execution failure or its published launch", async () => {
  let tool!: ToolDefinition;
  const launches: unknown[] = [];
  const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_c, _w, _s, _t, options) => {
    const signal = new AbortController().signal;
    await options!.jobHandler!("shell", {}, signal);
    await options!.jobHandler!("handoff", { message: "Waiting for a dependency" }, signal);
    return {
      exitCode: 1,
      stdout: "",
      stderr: "failed after handoff",
      stdoutLost: false,
      stderrLost: false,
      timedOut: false,
      cancelled: false,
      images: [],
    };
  });
  try {
    registerExecuteTool(
      {
        registerTool(value: ToolDefinition) {
          tool = value;
        },
        on() {},
        events: { emit: (_event: string, launch: unknown) => launches.push(launch) },
      } as unknown as ExtensionAPI,
      async () => ({ id: "surviving-job", kind: "command", status: "running", background: true }),
    );
    const pending = tool.execute("failed-handoff", { code: "", label: "Start dependency" }, undefined, undefined, {
      cwd: process.cwd(),
    } as ExtensionToolContext);
    await expect(pending).rejects.toThrow("failed after handoff");
    await expect(pending).rejects.toThrow("Background jobs: surviving-job");
    await expect(pending).rejects.not.toThrow("Execution handed off");
    expect(launches).toEqual([
      {
        sessionId: undefined,
        row: {
          id: "surviving-job",
          source: "local",
          sourceCallId: "failed-handoff",
          title: "Start dependency",
          status: "running",
          terminal: false,
        },
      },
    ]);
  } finally {
    mock.mockRestore();
  }
});

test("overlapping execute invocations keep handoff and launch evidence with their owner", async () => {
  let tool!: ToolDefinition;
  const finishes = new Map<string, () => void>();
  const launches: unknown[] = [];
  const waitSignals = new Map<string, AbortSignal>();
  const mock = spyOn(execution, "executeIsolated").mockImplementation(async (code, _w, _s, _t, options) => {
    const finished = new Promise<void>((resolve) => finishes.set(code, resolve));
    const signal = new AbortController().signal;
    await options!.jobHandler!("shell", { command: code }, signal);
    if (code === "one") await options!.jobHandler!("handoff", { message: "One is waiting" }, signal);
    await finished;
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutLost: false,
      stderrLost: false,
      timedOut: false,
      cancelled: false,
      images: [],
    };
  });
  try {
    registerExecuteTool(
      {
        registerTool(value: ToolDefinition) {
          tool = value;
        },
        on() {},
        events: { emit: (_event: string, launch: unknown) => launches.push(launch) },
      } as unknown as ExtensionAPI,
      async (_ctx, _method, params, signal) => {
        const id = (params as { command: string }).command;
        waitSignals.set(id, signal);
        return { id, kind: "command", status: "running", background: true };
      },
    );
    const run = (code: string) =>
      tool.execute(code, { code, label: "Launch " + code }, undefined, undefined, {
        cwd: process.cwd(),
        sessionManager: { getSessionId: () => "session-" + code },
      } as unknown as ExtensionToolContext);
    const one = run("one");
    const two = run("two");
    try {
      finishes.get("two")!();
      const resultTwo = await two;
      finishes.get("one")!();
      const resultOne = await one;
      expect(waitSignals.get("one")!.aborted).toBe(true);
      expect(waitSignals.get("two")!.aborted).toBe(false);
      expect(resultTwo).not.toHaveProperty("terminate");
      expect(resultTwo.details).not.toHaveProperty("handoff");
      expect(resultTwo.details).toMatchObject({
        backgroundJobs: ["two"],
        taskRows: [{ id: "two", sourceCallId: "two", title: "Launch two" }],
      });
      expect(resultOne).toHaveProperty("terminate", true);
      expect(resultOne.details).toMatchObject({
        handoff: "One is waiting",
        backgroundJobs: ["one"],
        taskRows: [{ id: "one", sourceCallId: "one", title: "Launch one" }],
      });
      expect(launches).toMatchObject([
        { sessionId: "session-one", row: { id: "one", sourceCallId: "one" } },
        { sessionId: "session-two", row: { id: "two", sourceCallId: "two" } },
      ]);
    } finally {
      // Release and drain both owners before restoring the shared execution spy,
      // including when one call fails while the other is still waiting.
      for (const finish of finishes.values()) finish();
      await Promise.allSettled([one, two]);
    }
  } finally {
    mock.mockRestore();
  }
});
