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
  expect(calls).toEqual([["/repo", "do work", "id"]]);
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
  expect(remoteStatus(state)).toBeUndefined();
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
  expect(remoteStatus(state)).toBeUndefined();
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
