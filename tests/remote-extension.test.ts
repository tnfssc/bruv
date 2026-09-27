import { clearRemoteJobEvents, remoteJobEvents } from "../src/remote/job-events";
import { createRemoteOperations } from "../src/remote/operations";
import { expect, test } from "bun:test";
import remoteExtension, { parseRemoteLaunch, renderRemote } from "../src/remote/extension";

test("remote uses execute bridge while human output persists in conversation", async () => {
  let active = ["execute"];
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const messages: any[] = [];
  const tools: any[] = [];
  const pi = {
    on: (name: string, fn: Function) => handlers.set(name, fn),
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    sendMessage: (message: any) => messages.push(message),
  };
  remoteExtension(
    pi as any,
    { path: "/nonexistent/remote-test/state.json", status: async () => ({ tasks: {} }) } as any,
  );
  expect(active).toEqual(["execute"]);
  expect(tools).toEqual([]);
  expect(
    await createRemoteOperations({
      path: "/nonexistent/remote-test/state.json",
      status: async () => ({ tasks: {} }),
    } as any)({ op: "status" }),
  ).toMatchObject({
    cached: true,
    tasks: [],
  });
  await commands.get("remote").handler("status", {});
  expect(messages[0].display).toBe(true);
  expect(JSON.parse(messages[0].content)).toMatchObject({ cached: true, tasks: [] });
});

test("remote launch preserves raw prompt and quoted repository paths", () => {
  expect(parseRemoteLaunch('launch "/repo with spaces" first  line\n  second line  ')).toEqual({
    repoPath: "/repo with spaces",
    prompt: "first  line\n  second line  ",
  });
  expect(() => parseRemoteLaunch('launch "/broken prompt')).toThrow("Unclosed");
  expect(() => parseRemoteLaunch("launch /repo ")).toThrow("Usage");
});
test("accepted retry syncs; uncertain retry retains same launch ID", async () => {
  let command: any;
  const calls: string[] = [];
  let outcome = "accepted";
  const task = { taskId: "id", repoPath: "/repo", prompt: "prompt", events: [] };
  const messages: any[] = [];
  const pi = {
    on() {},
    registerTool() {},
    registerCommand(_n: string, c: any) {
      command = c;
    },
    sendMessage(m: any) {
      messages.push(m);
    },
  };
  const client = {
    path: "/nonexistent/remote-test/state.json",
    transcript: async () => ({ ...task, outcome }),
    sync: async (id: string) => {
      calls.push("sync:" + id);
      return task;
    },
    launch: async (_r: string, _p: string, id: string) => {
      calls.push("launch:" + id);
      return task;
    },
    connect: async () => ({}),
  };
  remoteExtension(pi as any, client as any);
  await command.handler("retry id", {});
  outcome = "unknown";
  await command.handler("retry id", {});
  expect(calls).toEqual(["sync:id", "launch:id"]);
  await command.handler("connect host", {});
  expect(messages.at(-1).content).toContain("shared across");
});

test("execute remote methods use configured client, never accept a host", async () => {
  const calls: unknown[][] = [];
  const pi = { on() {}, registerCommand() {}, sendMessage() {} };
  const client = {
    path: "/nonexistent/remote-test/state.json",
    launch: async (...args: unknown[]) => {
      calls.push(args);
      return { events: [], taskId: "id" };
    },
    sync: async (id: string) => ({ events: [], taskId: id }),
    transcript: async (id: string) => ({ events: Array.from({ length: 55 }, (_, i) => i), taskId: id }),
  };
  remoteExtension(pi as any, client as any);
  await createRemoteOperations(client as any)({ op: "launch", repoPath: "/repo", prompt: "do work", taskId: "id" });
  expect(calls).toEqual([["/repo", "do work", "id", undefined, undefined]]);
  await createRemoteOperations(client as any)(
    { op: "launch", repoPath: "/repo", prompt: "owned", taskId: "owned" },
    "/repo",
    undefined,
    "/sessions/parent.jsonl",
  );
  expect(calls.at(-1)).toEqual(["/repo", "owned", "owned", undefined, "/sessions/parent.jsonl"]);
  expect(await createRemoteOperations(client as any)({ op: "transcript", taskId: "id", offset: 50 })).toMatchObject({
    events: [50, 51, 52, 53, 54],
    offset: 50,
  });
  await expect(createRemoteOperations(client as any)({ op: "transcript", taskId: "id", offset: -1 })).rejects.toThrow(
    "offset",
  );
  await expect(
    createRemoteOperations(client as any)({ op: "launch", repoPath: "/repo", prompt: "p", host: "bad" } as any),
  ).resolves.toBeDefined();
});

test("remote presentation escapes terminal and bidi control text", () => {
  const text = renderRemote({ text: "\x1b[2J\x9b31m\u202efile\nnext" });
  expect(text).not.toContain("\x1b");
  expect(text).not.toContain("\x9b");
  expect(text).not.toContain("\u202e");
  expect(text).toContain("\\u009b");
  expect(text).toContain("\\u202e");
  expect(text).toContain("\\nnext");
});

test("stale targeted or missing-text remote answers never fall through to a different question", async () => {
  let command: any;
  const messages: any[] = [];
  const replies: any[] = [];
  const task = {
    taskId: "task_one",
    events: [],
    task: {
      state: "running",
      questions: [{ id: "q_current", owner: { sessionId: "s", branchId: "b" }, version: 2, status: "pending" }],
    },
  };
  remoteExtension(
    {
      on() {},
      registerCommand(_name: string, value: any) {
        command = value;
      },
      sendMessage(value: any) {
        messages.push(value);
      },
    } as any,
    {
      path: "/nonexistent/remote-test/state.json",
      status: async () => ({ tasks: { task_one: task } }),
      answer: async (...args: any[]) => {
        replies.push(args);
        return task;
      },
    } as any,
  );
  await command.handler("answer task_one q_old yes", {});
  await command.handler("answer q_old yes", {});
  await command.handler("answer task_one q_current", {});
  await command.handler("answer", {});
  expect(replies).toHaveLength(0);
  expect(messages.every((m) => JSON.parse(m.content).error)).toBe(true);
  await command.handler("answer no thanks", {});
  expect(replies[0][0]).toBe("task_one");
  expect(replies[0][1]).toMatchObject({ id: "q_current", version: 2, text: "no thanks" });
});

test("no-args inbox binds selected choice to freshly synced owner/version, Escape never submits", async () => {
  let command: any;
  let version = 3;
  const answers: any[] = [];
  const task = () => ({
    taskId: "task-one",
    prompt: "Ship docs",
    host: "host",
    ownerId: "owner",
    epoch: "epoch",
    outcome: "accepted",
    events: [],
    cursor: 0,
    task: {
      state: "running",
      questions: [
        {
          id: "q-one",
          status: "pending",
          text: "Which style?",
          choices: ["Compact", "Extended"],
          owner: { sessionId: "s", branchId: "b" },
          version,
        },
      ],
    },
  });
  const client = {
    status: async () => ({
      connection: { host: "host", hello: { ownerId: "owner", epoch: "epoch" } },
      tasks: { "task-one": task() },
    }),
    sync: async () => task(),
    answer: async (...a: any[]) => {
      answers.push(a);
      return task();
    },
  };
  const pi = {
    on() {},
    registerCommand(_name: string, c: any) {
      command = c;
    },
    sendMessage() {},
  };
  remoteExtension(pi as any, client as any);
  const keys = {
    matches: (data: string, name: string) =>
      data === (name === "tui.select.confirm" ? "enter" : name === "tui.select.cancel" ? "esc" : "never"),
  };
  const selections = ["enter", "enter", "esc"];
  const ctx = {
    hasUI: true,
    ui: {
      custom: async (factory: any) => {
        let result: string | undefined;
        const component = factory(
          { terminal: { rows: 32 }, requestRender() {} },
          { fg: (_color: string, text: string) => text },
          keys,
          (v: string | undefined) => {
            result = v;
          },
        );
        component.handleInput(selections.shift() ?? "esc");
        return result;
      },
      editor: async () => undefined,
      notify() {},
    },
  };
  await command.handler("", ctx);
  expect(answers).toHaveLength(1);
  expect(answers[0][1]).toMatchObject({
    id: "q-one",
    text: "Compact",
    version: 3,
    owner: { sessionId: "s", branchId: "b" },
  });
  answers.length = 0;
  selections.push("enter", "esc", "esc");
  await command.handler("", ctx);
  expect(answers).toHaveLength(0);
});

test("connect editor Escape never connects, even after entering a host", async () => {
  let command: any;
  const connects: unknown[] = [];
  remoteExtension(
    {
      on() {},
      registerCommand(_n: string, c: any) {
        command = c;
      },
      sendMessage() {},
    } as any,
    { status: async () => ({ tasks: {} }), connect: async (...args: any[]) => connects.push(args) } as any,
  );
  const choices = ["connect", undefined];
  const edits = ["fixture-host", undefined];
  const ctx = {
    hasUI: true,
    ui: {
      custom: async (factory: any) => {
        let result: string | undefined;
        factory(
          { terminal: { rows: 30 }, requestRender() {} },
          { fg: (_c: string, t: string) => t },
          {},
          (v: string | undefined) => {
            result = v;
          },
        );
        return choices.shift();
      },
      editor: async () => edits.shift(),
      notify() {},
    },
  };
  await command.handler("", ctx);
  expect(connects).toEqual([]);
});

for (const change of ["offline", "changed-owner"] as const) {
  test("cancel confirmation open then " + change + " refuses dispatch", async () => {
    let command: any;
    let phase = 0;
    let cancels = 0;
    const task = {
      taskId: "id",
      prompt: "work",
      host: "host",
      ownerId: "owner",
      epoch: "epoch",
      outcome: "accepted",
      events: [],
      cursor: 0,
      task: { state: "running" },
    };
    const client = {
      status: async () => ({
        connection: {
          host: "host",
          hello: { ownerId: phase && change === "changed-owner" ? "other" : "owner", epoch: "epoch" },
        },
        tasks: { id: phase && change === "offline" ? { ...task, lastError: "offline" } : task },
      }),
      cancel: async () => {
        cancels++;
        return task;
      },
    };
    const messages: any[] = [];
    remoteExtension(
      {
        on() {},
        registerCommand(_n: string, c: any) {
          command = c;
        },
        sendMessage(m: any) {
          messages.push(m);
        },
      } as any,
      client as any,
    );
    const choices = ["task:id", "cancel"];
    await command.handler("", {
      hasUI: true,
      ui: {
        custom: async () => choices.shift(),
        editor: async () => undefined,
        confirm: async () => {
          phase = 1;
          return true;
        },
        notify() {},
      },
    });
    expect(cancels).toBe(0);
    expect(messages.some((m) => JSON.stringify(m).includes("no cancel sent"))).toBe(true);
  });
}

test("remote refresher projects only this parent's jobs and does not duplicate terminal/artifact UI messages", async () => {
  const handlers = new Map<string, Function>(),
    messages: any[] = [];
  const a = "/fixture/session-owned-a",
    b = "/fixture/session-owned-b";
  const task = (taskId: string, jobSessionFile: string) => ({
    taskId,
    jobSessionFile,
    ownerId: "owner",
    epoch: "epoch",
    host: "host",
    repoPath: "/repo",
    prompt: "p",
    cursor: 0,
    events: [],
    outcome: "accepted",
    task: { taskId, state: "done" },
  });
  const state = { tasks: { a: task("a", a), b: task("b", b) } };
  remoteExtension(
    {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      registerCommand() {},
      sendMessage: (m: any) => messages.push(m),
    } as any,
    { path: "/nonexistent/fixture/state.json", syncActive: async () => {}, status: async () => state } as any,
  );
  try {
    await handlers.get("session_start")!({}, { sessionManager: { getSessionFile: () => a } });
    await Bun.sleep(10);
    expect(
      remoteJobEvents(a)
        .snapshot()
        .map((t) => t.taskId),
    ).toEqual(["a"]);
    expect(remoteJobEvents(b).snapshot()).toEqual([]);
    expect(messages).toEqual([]);
    await handlers.get("session_shutdown")!();
    await handlers.get("session_start")!({}, { sessionManager: { getSessionFile: () => b } });
    await Bun.sleep(10);
    expect(
      remoteJobEvents(b)
        .snapshot()
        .map((t) => t.taskId),
    ).toEqual(["b"]);
    expect(messages).toEqual([]);
  } finally {
    await handlers.get("session_shutdown")!();
    clearRemoteJobEvents(a);
    clearRemoteJobEvents(b);
  }
});
