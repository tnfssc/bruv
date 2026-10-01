import { clearRemoteJobEvents, remoteJobEvents } from "../src/remote/job-events";
import { createRemoteOperations } from "../src/remote/operations";
import { expect, test } from "bun:test";
import remoteExtension, { parseRemoteLaunch, renderRemote } from "../src/remote/extension";
import { RemoteAttention, remoteStatus, renderHuman } from "../src/remote/human-rendering";

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
  expect(messages[0].content).toContain("No saved tasks");
  expect(messages[0].content).not.toContain('"cached"');
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
  expect(messages.every((m) => m.content.startsWith("Remote error:"))).toBe(true);
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

test("connect host editor Escape never connects", async () => {
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
  const edits = [undefined];
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

test("many polls do not append routine progress; transitions and reconnect are semantic", () => {
  const attention = new RemoteAttention();
  const t: any = { taskId: "t", outcome: "accepted", events: [], cursor: 1, task: { state: "running", questions: [] } };
  const poll = () => attention.update({ tasks: { t } } as any).join("\n");
  expect(poll()).toBe("");
  for (let i = 0; i < 100; i++) {
    t.cursor++;
    t.events.push({ seq: i, event: { type: "tool_update" } });
    expect(poll()).toBe("");
  }
  t.task.questions = [
    { status: "pending", id: "q", version: 1, owner: { sessionId: "s", branchId: "b" }, text: "Which?" },
  ];
  expect(poll()).toContain("Which?");
  expect(poll()).toBe("");
  t.lastError = "SSH unavailable";
  expect(poll()).toContain("offline");
  expect(poll()).toBe("");
  delete t.lastError;
  expect(poll()).toContain("recovered");
  expect(poll()).toBe("");
  t.task.questions.push({
    status: "pending",
    id: "new",
    version: 1,
    owner: { sessionId: "s", branchId: "b" },
    text: "New question",
  });
  expect(poll()).toContain("New question");
  t.task.questions = [];
  expect(poll()).toBe("");
  t.task.state = "done";
  t.events.push({
    seq: 101,
    event: {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Finished work" },
          { type: "toolCall", text: "hidden" },
        ],
      },
    },
  });
  expect(poll()).toContain("Finished work");
  expect(poll()).toBe("");
});

test("human transcript preserves every event and offset while task summary extracts final assistant", () => {
  const events = [
    { seq: 1, event: { type: "tool_result", data: "all details" } },
    {
      seq: 2,
      event: {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Readable result" }] },
      },
    },
  ];
  const task: any = { taskId: "t", task: { state: "done" }, outcome: "accepted", events };
  expect(renderHuman(task)).toContain("Readable result");
  expect(renderHuman(task)).not.toContain("message_end");
  const transcript = renderHuman({ ...task, offset: 0, nextOffset: 2 }, "transcript");
  expect(transcript).toContain("all details");
  expect(transcript).toContain("Readable result");
  expect(transcript).toContain("/remote transcript t 2");
});

test("poll UI is compact, cleanup clears status, and open picker receives no chat interruption", async () => {
  const handlers = new Map<string, any>(),
    messages: any[] = [],
    statuses: any[] = [];
  let command: any, release!: () => void;
  const task: any = {
    taskId: "id",
    prompt: "work",
    outcome: "accepted",
    cursor: 1,
    events: [],
    task: { state: "running" },
  };
  remoteExtension(
    {
      on: (name: string, fn: any) => handlers.set(name, fn),
      registerCommand: (_: string, c: any) => (command = c),
      sendMessage: (m: any) => messages.push(m),
    } as any,
    { status: async () => ({ tasks: { id: task } }), syncActive: async () => {}, sync: async () => task } as any,
  );
  const ctx: any = {
    hasUI: true,
    ui: {
      setStatus: (...args: any[]) => statuses.push(args),
      custom: async () => new Promise((resolve) => (release = () => resolve(undefined))),
    },
  };
  await handlers.get("session_start")({}, ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(statuses.at(-1)).toEqual(["die-remote", "remote: 1 active"]);
  expect(messages).toHaveLength(0);
  const menu = command.handler("", ctx);
  task.task.questions = [{ id: "q", version: 1, status: "pending", text: "Open menu question" }];
  await handlers.get("session_start")({}, ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(messages).toHaveLength(0);
  release();
  await menu;
  await handlers.get("session_start")({}, ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(messages.filter((m) => m.content.includes("Open menu question"))).toHaveLength(1);
  await handlers.get("session_shutdown")();
  expect(statuses.at(-1)).toEqual(["die-remote", undefined]);
});

test("capability, delivery uncertainty, blocked, failure and integration review get single notices", () => {
  const a = new RemoteAttention(),
    t: any = { taskId: "x", task: { state: "running" }, outcome: "accepted", events: [] };
  const poll = () => a.update({ tasks: { x: t } } as any).join("\n");
  t.task.capabilityNeeds = [{ kind: "repo.read", input: "src" }];
  expect(poll()).toContain("capability request");
  expect(poll()).toBe("");
  t.replyDelivery = { q: { replyId: "reply-1", status: "uncertain" } };
  expect(poll()).toContain("delivery uncertain");
  expect(poll()).toBe("");
  t.task.state = "unknown";
  expect(poll()).toContain("unknown");
  expect(poll()).toBe("");
  t.task.error = "model failed";
  expect(poll()).toContain("model failed");
  expect(poll()).toBe("");
  t.integrationError = "conflicts need review";
  expect(poll()).toContain("conflicts need review");
  expect(poll()).toBe("");
});

test("sync command renders final assistant text from full client task, not stripped RPC summary", async () => {
  let command: any;
  const messages: any[] = [];
  remoteExtension(
    {
      on() {},
      registerCommand(_name: string, c: any) {
        command = c;
      },
      sendMessage(m: any) {
        messages.push(m);
      },
    } as any,
    {
      sync: async () => ({
        taskId: "task",
        outcome: "accepted",
        task: { state: "done" },
        events: [
          {
            seq: 1,
            event: {
              type: "message_end",
              message: { role: "assistant", content: [{ type: "text", text: "Human conclusion" }] },
            },
          },
        ],
      }),
    } as any,
  );
  await command.handler("sync task", {});
  expect(messages[0].content).toContain("Human conclusion");
  expect(messages[0].content).not.toContain("message_end");
});

test("attention deduplicates hundreds of polls, reconnects and volatile diagnostics while reporting new identities", () => {
  const attention = new RemoteAttention();
  const task: any = {
    taskId: "t",
    outcome: "accepted",
    events: [],
    task: {
      state: "running",
      questions: [{ id: "q", version: 1, owner: { sessionId: "s" }, status: "pending", text: "Decide" }],
      capabilityNeeds: [{ id: "need", kind: "repo.read", input: "src", timestamp: 1 }],
    },
    lastError: "ssh: timeout 1",
  };
  const state = { tasks: { t: task } } as any;
  const keys: string[] = [];
  expect(attention.update(state, (key) => keys.push(key)).join(" ")).toContain("question q");
  for (let i = 0; i < 500; i++) {
    task.lastError = "ssh: timeout " + i;
    task.task.capabilityNeeds[0].timestamp = i;
    expect(attention.update(state, (key) => keys.push(key))).toEqual([]);
  }
  task.lastError = undefined;
  expect(attention.update(state).join(" ")).toContain("recovered");
  task.lastError = "ssh: reconnect timeout";
  expect(attention.update(state).join(" ")).toContain("offline");
  expect(attention.update(state)).toEqual([]);
  task.task.questions[0].status = "resolved";
  expect(attention.update(state)).toEqual([]);
  task.task.questions[0].status = "pending";
  expect(attention.update(state)).toEqual([]);
  task.task.questions[0].version = 2;
  expect(attention.update(state, (key) => keys.push(key)).join(" ")).toContain("question q");
  task.task.state = "failed";
  expect(attention.update(state).join(" ")).toContain("failed");
  task.task.error = "model failed";
  expect(attention.update(state).join(" ")).toContain("model failed");
  const restored = new RemoteAttention();
  restored.restore(keys);
  expect(restored.update(state).join(" ")).not.toContain("question q");
});

test("compact status retains unresolved attention after active tasks end and clears resolved questions", () => {
  const task: any = { taskId: "t", task: { state: "done", questions: [{ id: "q", status: "pending" }] } };
  const state = { tasks: { t: task } } as any;
  expect(remoteStatus(state)).toContain("1 question(s)");
  task.task.questions[0].status = "resolved";
  expect(remoteStatus(state)).toContain("not connected");
  task.integrationError = "conflict";
  expect(remoteStatus(state)).toContain("review");
  task.integrationError = undefined;
  task.repository = { status: "review", reason: "index changed", artifact: "/tmp/patch" };
  expect(remoteStatus(state)).toContain("review");
  expect(renderHuman(task)).toContain("index changed");
  task.repository = undefined;
  task.task.state = "blocked";
  expect(remoteStatus(state)).toContain("review");
  task.task.state = "done";
  task.lastError = "ssh failed";
  expect(remoteStatus(state)).toContain("offline (cached)");
  task.lastError = undefined;
  expect(remoteStatus(state, true)).toContain("offline (cached)");
  expect(remoteStatus(state)).toContain("not connected");
});

test("session branch attention rehydrates on reload without poll spam", async () => {
  const entries: any[] = [],
    messages: any[] = [],
    handlers = new Map<string, Function>();
  const task: any = {
    taskId: "t",
    task: { state: "running", questions: [{ id: "q", status: "pending", version: 1, text: "Review?" }] },
    events: [],
  };
  const client: any = { syncActive: async () => {}, status: async () => ({ tasks: { t: task } }) };
  const make = () => {
    const h = new Map<string, Function>();
    remoteExtension(
      {
        on: (name: string, fn: Function) => h.set(name, fn),
        registerCommand() {},
        sendMessage: (m: any) => messages.push(m),
        appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
      } as any,
      client,
    );
    return h;
  };
  const ctx = { hasUI: false, sessionManager: { getBranch: () => entries } };
  const first = make();
  await first.get("session_start")!({}, ctx);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(messages.filter((m) => m.content.includes("Review?"))).toHaveLength(1);
  await first.get("session_shutdown")!();
  const second = make();
  await second.get("session_start")!({}, ctx);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(messages.filter((m) => m.content.includes("Review?"))).toHaveLength(1);
  task.task.questions[0].version = 2;
  await second.get("session_start")!({}, ctx);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(messages.filter((m) => m.content.includes("Review?"))).toHaveLength(2);
  await second.get("session_shutdown")!();
});

test("each genuine outage and recovery is noticed once, including recovery after session reload", () => {
  const saved: string[] = [];
  const a = new RemoteAttention();
  const remember = (key: string) => saved.push(key);
  expect(a.connection("owner", true, "unreachable", remember)).toHaveLength(1);
  for (let i = 0; i < 300; i++) expect(a.connection("owner", true, "diagnostic " + i, remember)).toEqual([]);
  const restored = new RemoteAttention();
  restored.restore(saved);
  expect(restored.connection("owner", true, "different diagnostic", remember)).toEqual([]);
  expect(restored.connection("owner", false, undefined, remember)[0]).toContain("recovered");
  expect(restored.connection("owner", false, undefined, remember)).toEqual([]);
  expect(restored.connection("owner", true, "new outage", remember)[0]).toContain("new outage");
  expect(restored.connection("owner", false, undefined, remember)[0]).toContain("recovered");
  expect(saved).toHaveLength(4);
});

test("failure is one useful notice and explicit delivery responses distinguish request from outcome", () => {
  const task: any = { taskId: "t", events: [], task: { state: "failed", error: "Provider rejected request" } };
  const attention = new RemoteAttention();
  expect(attention.update({ tasks: { t: task } } as any)).toEqual(["Remote t · failed: Provider rejected request"]);
  expect(attention.update({ tasks: { t: task } } as any)).toEqual([]);
  task.replyDelivery = { q: { replyId: "reply", status: "delivered" } };
  task.cancelDelivery = { status: "confirmed" };
  const rendered = renderHuman(task);
  expect(rendered).toContain("delivered to owner (not proof it was used)");
  expect(rendered).toContain("request acknowledged; observed task state: failed");
  expect(renderHuman(new Error("Readable transport error"))).toContain("Readable transport error");
});

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

test("session-owned completion stays in jobs while human footer retains actionable state", async () => {
  const handlers = new Map<string, Function>();
  const messages: any[] = [];
  const statuses: any[] = [];
  const session = "/fixture/owned-human-footer";
  const task: any = {
    taskId: "owned",
    jobSessionFile: session,
    ownerId: "owner",
    epoch: "epoch",
    host: "host",
    repoPath: "/repo",
    prompt: "Review output",
    cursor: 1,
    events: [],
    outcome: "accepted",
    task: { taskId: "owned", state: "done", questions: [{ id: "q", version: 1, status: "pending", text: "Review?" }] },
  };
  remoteExtension(
    {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      registerCommand() {},
      sendMessage: (m: any) => messages.push(m),
    } as any,
    {
      path: "/nonexistent/fixture/state.json",
      syncActive: async () => {},
      status: async () => ({ tasks: { owned: task } }),
    } as any,
  );
  try {
    await handlers.get("session_start")!(
      {},
      {
        hasUI: true,
        ui: { setStatus: (...args: any[]) => statuses.push(args) },
        sessionManager: { getSessionFile: () => session },
      },
    );
    await Bun.sleep(10);
    expect(messages).toEqual([]);
    expect(statuses.at(-1)[1]).toContain("1 question(s)");
    expect(statuses.at(-1)[1]).toBe("remote: 1 question(s)");
    expect(
      remoteJobEvents(session)
        .snapshot()
        .map((t) => t.taskId),
    ).toEqual(["owned"]);
  } finally {
    await handlers.get("session_shutdown")!();
    clearRemoteJobEvents(session);
  }
  expect(statuses.at(-1)).toEqual(["die-remote", undefined]);
});

test("human direct launch binds the command's parent session without exposing JSON", async () => {
  let command: any;
  const calls: any[] = [],
    messages: any[] = [];
  remoteExtension(
    {
      on() {},
      registerCommand: (_: string, value: any) => {
        command = value;
      },
      sendMessage: (m: any) => messages.push(m),
    } as any,
    {
      path: "/nonexistent/fixture/state.json",
      launch: async (...args: any[]) => {
        calls.push(args);
        return { taskId: "owned", events: [], outcome: "accepted", task: { state: "running" } };
      },
      syncActive: async () => {},
      status: async () => ({ tasks: {} }),
    } as any,
  );
  await command.handler('launch "/repo with spaces" do useful work', {
    sessionManager: { getSessionFile: () => "/fixture/human-parent" },
  });
  expect(calls).toEqual([["/repo with spaces", "do useful work", undefined, undefined, "/fixture/human-parent"]]);
  expect(messages[0].content).toContain("running");
  expect(messages[0].content).not.toContain('"taskId"');
});

test("fresh sessions baseline legacy unowned results, but live transitions and reloads keep their own history", async () => {
  const entries: any[] = [],
    messages: any[] = [];
  const task = (taskId: string, state: string, jobSessionFile?: string): any => ({
    taskId,
    jobSessionFile,
    ownerId: "owner",
    epoch: "epoch",
    events: [],
    outcome: "accepted",
    task: {
      state,
      questions: taskId === "legacy" ? [{ id: "q", version: 1, status: "pending", text: "Review?" }] : [],
    },
  });
  const state: any = {
    tasks: {
      legacy: task("legacy", "done"),
      other: task("other", "done", "/other-session"),
      live: task("live", "running"),
    },
  };
  const make = () => {
    const handlers = new Map<string, Function>();
    let command: any;
    remoteExtension(
      {
        on: (name: string, fn: Function) => handlers.set(name, fn),
        registerCommand: (_: string, value: any) => {
          command = value;
        },
        sendMessage: (m: any) => messages.push(m),
        appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
      } as any,
      {
        path: "/nonexistent/fixture/state.json",
        syncActive: async () => {},
        status: async () => state,
      } as any,
    );
    return { handlers, command };
  };
  const start = async (instance: ReturnType<typeof make>, branch: any[]) => {
    await instance.handlers.get("session_start")!(
      {},
      { sessionManager: { getBranch: () => branch, getSessionFile: () => "/current-session" } },
    );
    await Bun.sleep(15);
  };
  let instance = make();
  try {
    await start(instance, entries);
    expect(messages.map((m) => m.content).join(" ")).toContain("Review?");
    expect(messages.map((m) => m.content).join(" ")).not.toContain("Remote legacy · done");
    expect(messages.map((m) => m.content).join(" ")).not.toContain("Remote other · done");
    await instance.handlers.get("session_shutdown")!();
    instance = make();
    await start(instance, []); // another fresh session must not replay the cached result
    expect(messages.map((m) => m.content).join(" ")).not.toContain("Remote legacy · done");
    state.tasks.live.task.state = "done";
    await instance.command.handler("status", { hasUI: false }); // explicit status is still accessible
    await Bun.sleep(10);
    expect(messages.map((m) => m.content).filter((text: string) => text.includes("Remote live · done"))).toHaveLength(
      1,
    );
    await instance.handlers.get("session_shutdown")!();
    instance = make();
    await start(instance, entries); // reload: previously delivered completion not replayed
    expect(messages.map((m) => m.content).filter((text: string) => text.includes("Remote live · done"))).toHaveLength(
      1,
    );
    expect(messages.map((m) => m.content).some((text: string) => text.includes("legacy"))).toBe(true);
  } finally {
    await instance.handlers.get("session_shutdown")!();
  }
});

test("unowned task active before shutdown completes during restart and is delivered only to that session", async () => {
  const entries: any[] = [],
    messages: any[] = [];
  const task: any = { taskId: "restart", events: [], task: { state: "running" } };
  const make = () => {
    const handlers = new Map<string, Function>();
    remoteExtension(
      {
        on: (n: string, f: Function) => handlers.set(n, f),
        registerCommand() {},
        appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
        sendMessage: (m: any) => messages.push(m),
      } as any,
      { syncActive: async () => {}, status: async () => ({ tasks: { restart: task } }) } as any,
    );
    return handlers;
  };
  const start = async (h: Map<string, Function>, branch: any[]) => {
    await h.get("session_start")!({}, { sessionManager: { getBranch: () => branch } });
    await Bun.sleep(15);
  };
  let handlers = make();
  try {
    await start(handlers, entries);
    await handlers.get("session_shutdown")!();
    task.task.state = "done";
    handlers = make();
    await start(handlers, entries);
    expect(messages.filter((m) => m.content.includes("Remote restart · done"))).toHaveLength(1);
    await handlers.get("session_shutdown")!();
    handlers = make();
    await start(handlers, []);
    expect(messages.filter((m) => m.content.includes("Remote restart · done"))).toHaveLength(1);
  } finally {
    await handlers.get("session_shutdown")!();
  }
});

test("completion first seen during startup sync is not mistaken for historical cache", async () => {
  const handlers = new Map<string, Function>();
  const messages: any[] = [];
  const task: any = { taskId: "during-sync", events: [], task: { state: "running" } };
  remoteExtension(
    {
      on: (n: string, f: Function) => handlers.set(n, f),
      registerCommand() {},
      sendMessage: (m: any) => messages.push(m),
    } as any,
    {
      syncActive: async () => {
        task.task.state = "done";
      },
      status: async () => ({ tasks: { "during-sync": task } }),
    } as any,
  );
  try {
    await handlers.get("session_start")!({}, { sessionManager: { getBranch: () => [] } });
    await Bun.sleep(15);
    expect(messages.filter((m) => m.content.includes("Remote during-sync · done"))).toHaveLength(1);
  } finally {
    await handlers.get("session_shutdown")!();
  }
});

test("review action exposes cached conflict artifact and leaves picker without contacting owner", async () => {
  let command: any;
  const messages: any[] = [];
  let picks = 0;
  const task = {
    taskId: "review",
    prompt: "Dirty snapshot",
    events: [],
    task: { state: "done" },
    repository: { status: "review", reason: "local conflict", artifact: "/safe/return.patch" },
  };
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
    { status: async () => ({ tasks: { review: task } }) } as any,
  );
  await command.handler("", { hasUI: true, ui: { custom: async () => ["task:review", "details"][picks++] } });
  expect(picks).toBe(2);
  expect(messages.at(-1).content).toContain("/safe/return.patch");
  expect(messages.at(-1).content).toContain("Inspect local worktree before applying");
});

test("menu repository launch asks about untracked files before snapshot or transfer", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "remote-menu-untracked-"));
  try {
    Bun.spawnSync(["git", "init", dir]);
    await writeFile(join(dir, "new-file.txt"), "private local draft");
    let command: any;
    const confirmations: string[] = [];
    const picks = ["launch", undefined];
    remoteExtension(
      {
        on() {},
        registerCommand(_n: string, c: any) {
          command = c;
        },
        sendMessage() {},
      } as any,
      {
        path: join(dir, "cache/state.json"),
        status: async () => ({
          tasks: {},
          connection: { host: "fixture-host", hello: { ownerId: "owner", epoch: "epoch" } },
        }),
      } as any,
    );
    await command.handler("", {
      cwd: dir,
      hasUI: true,
      ui: {
        custom: async () => picks.shift(),
        editor: async () => "Review local draft",
        confirm: async (title: string, body: string) => {
          confirmations.push(title + "\n" + body);
          throw Error("Stop before any snapshot");
        },
      },
    });
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toContain("new-file.txt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("capability menu shows remote request details and refuses changed owner after HUMAN confirmation", async () => {
  let command: any;
  let owner = "owner";
  let picks = 0;
  const messages: any[] = [];
  const task: any = {
    taskId: "task1",
    host: "host",
    ownerId: "owner",
    epoch: "epoch",
    prompt: "Investigate",
    events: [],
    task: {
      state: "running",
      capabilityNeeds: [{ id: "req1", kind: "tool:git-status", input: "Check working tree before proceeding" }],
    },
  };
  const client: any = {
    path: "/tmp/remote-capability-menu-test/state.json",
    status: async () => ({
      connection: { host: "host", hello: { ownerId: owner, epoch: "epoch" } },
      tasks: { task1: task },
    }),
    sync: async () => task,
    control: async () => {
      throw Error("must not dispatch");
    },
  };
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
    client,
  );
  await command.handler("", {
    hasUI: true,
    cwd: process.cwd(),
    ui: {
      setStatus() {},
      custom: async () => ["task:task1", "capabilities", "need:0", undefined][picks++],
      confirm: async (title: string, details: string) => {
        expect(title).toContain("HUMAN authorization");
        expect(details).toContain("Check working tree before proceeding");
        expect(details).toContain("Local repository:");
        expect(details).toContain("entire named kind");
        owner = "different";
        return true;
      },
    },
  });
  expect(messages.at(-1).content).toContain("no grant sent");
});

test("open remote menu signals snapshot freshness without rewriting the picker or transcript", async () => {
  let command: any;
  let release!: (choice?: string) => void;
  const statuses: string[] = [];
  const messages: any[] = [];
  let openings = 0;
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
    { status: async () => ({ tasks: {} }) } as any,
  );
  const run = command.handler("", {
    hasUI: true,
    ui: {
      setStatus(_key: string, value: string) {
        statuses.push(value);
      },
      custom: () => {
        openings++;
        return new Promise<string | undefined>((resolve) => {
          release = resolve;
        });
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(statuses.at(-1)).toContain("not connected");
  expect(statuses.at(-1)).not.toContain("snapshot");
  expect(statuses.at(-1)).not.toContain("Refresh");
  expect(openings).toBe(1);
  expect(messages).toHaveLength(0);
  release(undefined);
  await run;
  expect(statuses.at(-1)).toBeUndefined();
});

test("local capability revocation is pinned to its task and never sends another task's grant", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { ClientCapabilityStore } = await import("../src/remote/capability-runtime");
  const { localCapabilityGrants, revokeCapability } = await import("../src/remote/services");
  const dir = await mkdtemp(join(tmpdir(), "remote-grant-menu-"));
  const client: any = {
    path: join(dir, "state.json"),
    control: async () => {
      throw Error("wrong task dispatched");
    },
  };
  try {
    const store = new ClientCapabilityStore(join(dir, "capability-grants"));
    const grant = await store.grant("first", dir, ["repo.read"], "grant_test1");
    expect(localCapabilityGrants(client, "first").map((g) => g.id)).toEqual([grant.id]);
    expect(localCapabilityGrants(client, "second")).toEqual([]);
    expect(revokeCapability(client, "second", grant.id)).rejects.toThrow("No local grant");
    expect(localCapabilityGrants(client, "first")).toHaveLength(1);
    let attempts = 0;
    client.control = async () => {
      if (++attempts === 1) throw Error("owner reply lost");
    };
    expect(await revokeCapability(client, "first", grant.id)).toMatchObject({ revoked: true, ownerNotified: false });
    expect(localCapabilityGrants(client, "first")).toEqual([]);
    expect(await revokeCapability(client, "first", grant.id)).toMatchObject({ revoked: true, ownerNotified: true });
    expect(attempts).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("oversized untracked menu inventory permits tracked-only without bulk approval", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "remote-menu-overflow-"));
  try {
    Bun.spawnSync(["git", "init", dir]);
    for (let i = 0; i < 5000; i++) await writeFile(join(dir, String(i).padStart(5, "0") + "x".repeat(215)), "");
    let command: any;
    const notices: string[] = [];
    let confirmations = 0;
    let reachedLaunch = false;
    remoteExtension(
      {
        on() {},
        registerCommand(_n: string, c: any) {
          command = c;
        },
        sendMessage() {},
      } as any,
      {
        path: join(dir, "cache/state.json"),
        status: async () => {
          reachedLaunch = true;
          return { tasks: {} };
        },
      } as any,
    );
    await command.handler("", {
      cwd: dir,
      hasUI: true,
      ui: {
        custom: async () => "launch",
        editor: async () => "Tracked only",
        confirm: async () => {
          confirmations++;
          return true;
        },
        notify: (text: string) => notices.push(text),
      },
    });
    expect(confirmations).toBe(0);
    expect(notices.some((n) => /at least [0-9]+/.test(n) && n.includes("tracked files only"))).toBe(true);
    // Reached launchRepository (no connection), rather than failing at git inventory.
    expect(reachedLaunch).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bounded untracked preview distinguishes exact from incomplete path counts", async () => {
  const { repositoryUntracked } = await import("../src/remote/untracked-preview");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "remote-preview-"));
  try {
    Bun.spawnSync(["git", "init", dir]);
    await writeFile(join(dir, "first"), "");
    await writeFile(join(dir, "second"), "");
    const exact = await repositoryUntracked(dir, 100);
    expect(exact).toMatchObject({ paths: ["first", "second"], count: 2, incomplete: false });
    const limited = await repositoryUntracked(dir, 8);
    expect(limited).toMatchObject({ paths: [], preview: ["first"], count: 2, incomplete: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("offline terminal menu revokes only the selected local grant; Escape and denial leave authority intact", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { ClientCapabilityStore } = await import("../src/remote/capability-runtime");
  const { localCapabilityGrants } = await import("../src/remote/services");
  const dir = await mkdtemp(join(tmpdir(), "remote-offline-menu-"));
  try {
    const store = new ClientCapabilityStore(join(dir, "capability-grants"));
    const grant = await store.grant("first", dir, ["repo.read"], "grant_first");
    await store.grant("second", dir, ["repo.read"], "grant_second");
    const task: any = {
      taskId: "first",
      prompt: "Old task",
      host: "host",
      ownerId: "owner",
      epoch: "epoch",
      events: [],
      task: { state: "completed" },
    };
    const state: any = { tasks: { first: task }, connection: undefined };
    const calls: string[] = [],
      messages: any[] = [];
    const client: any = {
      path: join(dir, "state.json"),
      status: async () => state,
      sync: async () => {
        throw Error("remote unavailable");
      },
      control: async () => {
        throw Error("wrong-owner dispatch");
      },
    };
    let command: any;
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
      client,
    );
    const run = async (confirm: boolean, escapeMenu = false) => {
      let picks = 0;
      await command.handler("", {
        hasUI: true,
        ui: {
          setStatus() {},
          custom: async () => {
            const value = ["task:first", "capabilities", escapeMenu ? undefined : "revoke:0", undefined][picks++];
            calls.push("pick:" + value);
            return value;
          },
          confirm: async (_title: string, details: string) => {
            expect(details).toContain("Old task");
            expect(details).toContain(grant.id);
            calls.push("confirm");
            return confirm;
          },
        },
      });
    };
    await run(false);
    expect(localCapabilityGrants(client, "first")).toHaveLength(1);
    await run(true, true);
    expect(localCapabilityGrants(client, "first")).toHaveLength(1);
    await run(true);
    expect(localCapabilityGrants(client, "first")).toEqual([]);
    expect(localCapabilityGrants(client, "second")).toHaveLength(1);
    expect(messages.at(-1).content).toContain("Owner not notified");
    expect(calls.filter((x) => x === "confirm")).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("changed-owner accepted task loses local grant without wrong-owner dispatch", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { ClientCapabilityStore } = await import("../src/remote/capability-runtime");
  const { localCapabilityGrants } = await import("../src/remote/services");
  const dir = await mkdtemp(join(tmpdir(), "remote-owner-revoke-"));
  try {
    const client: any = {
      path: join(dir, "state.json"),
      sync: () => {
        throw Error("no remote sync");
      },
      control: () => {
        throw Error("wrong owner dispatch");
      },
    };
    const store = new ClientCapabilityStore(join(dir, "capability-grants"));
    await store.grant("one", dir, ["repo.read"], "grant_owner");
    const task: any = {
      taskId: "one",
      prompt: "Pinned task",
      host: "host",
      ownerId: "old",
      epoch: "epoch",
      task: { state: "running" },
      events: [],
    };
    const state: any = {
      tasks: { one: task },
      connection: { host: "host", hello: { ownerId: "new", epoch: "epoch" } },
    };
    client.status = async () => state;
    let cmd: any;
    const output: any[] = [];
    remoteExtension(
      {
        on() {},
        registerCommand(_n: string, c: any) {
          cmd = c;
        },
        sendMessage(m: any) {
          output.push(m);
        },
      } as any,
      client,
    );
    let picks = 0;
    await cmd.handler("", {
      hasUI: true,
      ui: {
        setStatus() {},
        custom: async (_: any) => {
          // Inspect picker options through the mock's QuestionPicker return by selecting known values.
          return ["task:one", "capabilities", "revoke:0", undefined][picks++];
        },
        confirm: async () => true,
      },
    });
    expect(localCapabilityGrants(client, "one")).toEqual([]);
    expect(output.at(-1).content).toContain("Owner not notified");
    expect(picks).toBe(5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
