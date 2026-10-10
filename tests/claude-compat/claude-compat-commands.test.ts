import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeCompatCommands } from "../../src/claude-compat/commands";
import { registerQuestions } from "../../src/questions/extension";
import { registerQuestionRuntime } from "../../src/questions/runtime";
import { registerInstructionMode, INSTRUCTION_MODE_ENTRY } from "../../src/agent/instruction-mode";
import { registerGoalMode } from "../../src/goals/extension";
import type { UserMessage } from "../../src/claude-compat/transport";

function commandFixture(sessionFile?: string) {
  const registered = new Map<string, any>();
  const entries: any[] = [{ id: "root", parentId: null }];
  const notices: string[] = [];
  let originalNotifications = 0;
  const ctx: any = {
    mode: "rpc",
    hasUI: false,
    isIdle: () => false,
    abort() {},
    sessionManager: {
      getSessionId: () => "session",
      getSessionFile: () => sessionFile,
      getLeafId: () => entries.at(-1).id,
      getBranch: () => entries,
      getEntries: () => entries,
    },
    ui: {
      notify: () => {
        originalNotifications++;
      },
      setStatus() {},
    },
  };
  const session: any = {
    sessionId: "session",
    isStreaming: false,
    model: { provider: "local", id: "fixture" },
    getSessionStats: () => ({ cost: 1, toolCalls: 2 }),
    resourceLoader: {
      getSkills: () => ({ skills: [{ name: "real", filePath: "/real/skill.md" }] }),
      getPrompts: () => ({ prompts: [{ name: "review", filePath: "/real/prompt.md" }] }),
      getAgentsFiles: () => ({ agentsFiles: [{ path: "/real/AGENTS.md", content: "private" }] }),
    },
    extensionRunner: {
      getCommand: (name: string) => registered.get(name),
      createCommandContext: () => ctx,
      getRegisteredCommands: () => [...registered.keys()].map((invocationName) => ({ invocationName })),
    },
  };
  const adapter = createClaudeCompatCommands({
    session,
    notify(text) {
      notices.push(text);
    },
  });
  const message = (text: string): UserMessage => ({
    type: "user",
    session_id: "session",
    parent_tool_use_id: null,
    message: { role: "user", content: text },
  });
  return {
    adapter,
    registered,
    ctx,
    entries,
    notices,
    message,
    session,
    originalNotifications: () => originalNotifications,
  };
}

test("namespaced commands call real goal, mode and question handlers with no phantom UI", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bruv-native-commands-"));
  const h = commandFixture(join(dir, "session.jsonl"));
  try {
    const pi: any = {
      on() {},
      registerCommand(name: string, command: any) {
        h.registered.set(name, command);
      },
      appendEntry(customType: string, data: any) {
        h.entries.push({
          id: "entry" + h.entries.length,
          parentId: h.entries.at(-1).id,
          type: "custom",
          customType,
          data,
        });
      },
      sendMessage() {},
    };
    const runtime = registerQuestionRuntime(pi, { supported: () => true });
    registerQuestions(pi, (context) => runtime.commands(context));
    registerInstructionMode(pi, () => true);
    registerGoalMode(
      pi,
      { runningIds: () => new Set(), status: () => "finished" },
      { hasBlockingQuestions: () => true },
    );

    expect(h.adapter.catalog().map((c) => c.name)).toContain("bruv:goal");
    await h.adapter.dispatchUserCommand(h.message("/bruv mode fast"));
    expect(h.entries.some((e) => e.customType === INSTRUCTION_MODE_ENTRY && e.data.mode === "fast")).toBe(true);
    expect(h.notices.at(-1)).toContain("fast");
    await h.adapter.dispatchUserCommand(
      h.message("/bruv:goal set Ship adapter --criteria Tests pass --constraints No release"),
    );
    expect(h.notices.at(-1)).toContain("Ship adapter");
    await h.adapter.dispatchUserCommand(h.message("/bruv goal pause Human pause"));
    expect(h.notices.at(-1)).toContain("paused");
    const q: any = await runtime.handle(h.ctx, "questions.ask", { text: "Which target?" });
    await h.adapter.dispatchUserCommand(h.message("/bruv questions"));
    expect(h.notices.at(-1)).toContain("Which target?");
    const answer = "Keep  both spaces\n\n    and this indented second paragraph.";
    await h.adapter.dispatchUserCommand(h.message("/bruv questions answer " + q.id + " " + answer));
    expect(runtime.service.get(h.ctx, q.id).answer).toBe(answer);
    expect(h.ctx.hasUI).toBe(false);
    expect(h.ctx.mode).toBe("rpc");
    expect(h.originalNotifications()).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status and resources use actual owning session data; no native TUI status no-op", async () => {
  const h = commandFixture();
  h.registered.set("questions", { handler() {} });
  await h.adapter.dispatchUserCommand(h.message("/bruv status"));
  expect(JSON.parse(h.notices.at(-1)!).stats).toEqual({ cost: 1, toolCalls: 2 });
  await h.adapter.dispatchUserCommand(h.message("/bruv:resources"));
  const resources = JSON.parse(h.notices.at(-1)!);
  expect(resources.skills).toEqual([{ name: "real", path: "/real/skill.md" }]);
  expect(resources.commands).toContain("questions");
  expect(h.notices.at(-1)).not.toContain("private");
});

test("ordinary CLI text is untouched; unknown namespaced input cannot become a model prompt", async () => {
  const h = commandFixture();
  for (const input of ["/questionsx answer q_foo yes", "/modefast", "/status", "User discussion of /bruv mode fast"]) {
    expect(await h.adapter.dispatchUserCommand(h.message(input))).toBe(false);
  }
  expect(await h.adapter.dispatchUserCommand({ ...h.message("/bruv mode fast"), type: "assistant" } as any)).toBe(
    false,
  );
  expect(h.notices).toHaveLength(0);
  await expect(h.adapter.dispatchUserCommand(h.message("/bruv:goal123"))).rejects.toThrow(
    "Invalid Bruv command syntax",
  );
  await expect(h.adapter.dispatchUserCommand(h.message("/bruv unsupported yes"))).rejects.toThrow("Unavailable");
  await expect(
    h.adapter.dispatchUserCommand({ ...h.message("/bruv mode fast"), session_id: "foreign" }),
  ).rejects.toThrow("session mismatch");
  await expect(
    h.adapter.dispatchUserCommand({ ...h.message("/bruv mode fast"), parent_tool_use_id: "child" }),
  ).rejects.toThrow("root session");
  const imageCommand = h.message("ignored");
  imageCommand.message.content = [
    { type: "text", text: "/bruv mode fast" },
    { type: "image", source: {} },
  ];
  await expect(h.adapter.dispatchUserCommand(imageCommand)).rejects.toThrow("text only");
});

test("goal alias is discoverable and uses the same validated command handler", async () => {
  const h = commandFixture();
  const values: string[] = [];
  h.registered.set("goal", { handler: async (value: string) => values.push(value) });
  expect(h.adapter.catalog()).toContainEqual({
    name: "goal",
    description: "Start or resume a goal; during work use /bruv goal status|pause",
    argumentHint: "objective|status|pause|resume|budget|clear|help",
  });
  for (const command of ["/goal", "/goal status", "/goal Ship it", "/bruv goal Ship it", "/bruv:goal Ship it"]) {
    expect(await h.adapter.dispatchUserCommand(h.message(command))).toBe(true);
  }
  expect(values).toEqual(["", "status", "Ship it", "Ship it", "Ship it"]);
  await expect(h.adapter.dispatchUserCommand({ ...h.message("/goal pause"), session_id: "foreign" })).rejects.toThrow(
    "session mismatch",
  );
});

test("admission resolves both spellings before dispatch and preserves their argument semantics", async () => {
  const h = commandFixture();
  const values: string[] = [];
  h.registered.set("mode", { handler: async (value: string) => values.push(value) });
  expect(await h.adapter.dispatchUserCommand(h.message("  /bruv mode   fast  now  "))).toBe(true);
  expect(await h.adapter.dispatchUserCommand(h.message("  /bruv:mode   fast  now  "))).toBe(true);
  expect(values).toEqual(["fast  now", "fast  now"]);
  const blocks = h.message("ignored");
  blocks.message.content = [
    { type: "text", text: "/bruv:mode" },
    { type: "text", text: "fast" },
  ];
  expect(await h.adapter.dispatchUserCommand(blocks)).toBe(true);
  expect(values.at(-1)).toBe("fast");
  for (const text of ["/bruv", "/bruv help", "/bruv:help"]) {
    expect(await h.adapter.dispatchUserCommand(h.message(text))).toBe(true);
    expect(h.notices.at(-1)).toContain("/questions open <id>");
  }
  await expect(h.adapter.dispatchUserCommand(h.message("/bruv status extra"))).rejects.toThrow("Usage:");
  await expect(h.adapter.dispatchUserCommand(h.message("/bruv:resources extra"))).rejects.toThrow("Usage:");
  h.registered.delete("mode");
  expect(h.adapter.catalog().map((command) => command.name)).not.toContain("bruv:mode");
  await expect(h.adapter.dispatchUserCommand(h.message("/bruv mode fast"))).rejects.toThrow("Unavailable");
});

test("extension execution keeps the real context and awaits ordered notification delivery", async () => {
  const h = commandFixture();
  const firstDelivery = Promise.withResolvers<void>();
  const deliveryStarted = Promise.withResolvers<void>();
  const events: string[] = [];
  let completed = false;
  const originalNotify = h.ctx.ui.notify;
  try {
    h.registered.set("mode", {
      handler: async (_value: string, context: any) => {
        expect(context.hasUI).toBe(false);
        expect(context.mode).toBe("rpc");
        expect(context.sessionManager).toBe(h.ctx.sessionManager);
        expect(context.ui.setStatus).toBe(h.ctx.ui.setStatus);
        context.ui.notify("first", "warning");
        context.ui.notify("second");
        events.push("handler returned");
      },
    });
    const adapter = createClaudeCompatCommands({
      session: h.session,
      async notify(text, level) {
        events.push(text + " started " + level);
        if (text === "first") {
          deliveryStarted.resolve();
          await firstDelivery.promise;
        }
        events.push(text + " delivered");
      },
    });
    const dispatch = adapter.dispatchUserCommand(h.message("/bruv mode fast")).then((result) => {
      completed = true;
      return result;
    });
    await deliveryStarted.promise;
    expect(completed).toBe(false);
    expect(events).toEqual(["handler returned", "first started warning"]);
    firstDelivery.resolve();
    expect(await dispatch).toBe(true);
    expect(events).toEqual([
      "handler returned",
      "first started warning",
      "first delivered",
      "second started info",
      "second delivered",
    ]);
    expect(h.originalNotifications()).toBe(0);
    expect(h.ctx.ui.notify).toBe(originalNotify);
  } finally {
    firstDelivery.resolve();
  }
});

test("questions open uses native human controls, not the extension handler", async () => {
  const h = commandFixture();
  const opened: string[] = [];
  h.registered.set("questions", {
    handler: () => {
      throw new Error("must not reach extension");
    },
  });
  const adapter = createClaudeCompatCommands({
    session: h.session,
    notify(text) {
      h.notices.push(text);
    },
    humanControls: {
      async openQuestion(id) {
        opened.push(id);
        return { id, status: "pending", text: "Which target?" } as any;
      },
    },
  });
  expect(await adapter.dispatchUserCommand(h.message("/bruv:questions open q_full"))).toBe(true);
  expect(opened).toEqual(["q_full"]);
  expect(h.notices.at(-1)).toBe("q_full [pending] Which target?");
  await expect(adapter.dispatchUserCommand(h.message("/bruv questions open"))).rejects.toThrow("Usage:");
  await expect(adapter.dispatchUserCommand(h.message("/bruv questions open q_full extra"))).rejects.toThrow("Usage:");
  await expect(h.adapter.dispatchUserCommand(h.message("/bruv questions open q_full"))).rejects.toThrow("unavailable");
  expect(opened).toEqual(["q_full"]);
});

test.each(["questions", "mode"])("%s alias is discoverable and preserves native ownership validation", async (name) => {
  const h = commandFixture();
  const values: string[] = [];
  h.registered.set(name, { handler: async (value: string) => values.push(value) });
  expect(h.adapter.catalog().map((command) => command.name)).toContain(name);
  for (const prefix of ["/" + name, "/bruv " + name, "/bruv:" + name]) {
    expect(await h.adapter.dispatchUserCommand(h.message(prefix + " argument  with\nnewlines"))).toBe(true);
  }
  expect(values).toEqual(Array(3).fill("argument  with\nnewlines"));
  await expect(h.adapter.dispatchUserCommand({ ...h.message("/" + name), session_id: "foreign" })).rejects.toThrow(
    "session mismatch",
  );
  await expect(
    h.adapter.dispatchUserCommand({ ...h.message("/" + name), parent_tool_use_id: "child" }),
  ).rejects.toThrow("root session");
  h.registered.delete(name);
  expect(h.adapter.catalog().map((command) => command.name)).not.toContain(name);
  await expect(h.adapter.dispatchUserCommand(h.message("/" + name))).rejects.toThrow("Unavailable");
});

test.each([{ type: "text" }, { type: "text", text: 42 }, { type: "text", text: null }])(
  "malformed native text blocks cannot partially admit a human command: %j",
  async (malformed) => {
    const h = commandFixture();
    let calls = 0;
    h.registered.set("mode", { handler: () => calls++ });
    const message = h.message("ignored");
    message.message.content = [{ type: "text", text: "/mode fast" }, malformed];
    await expect(h.adapter.dispatchUserCommand(message)).rejects.toThrow("text only");
    expect(calls).toBe(0);
    expect(h.notices).toHaveLength(0);
  },
);

test("forwarded command context keeps live guarded getters through reload and model changes", async () => {
  const h = commandFixture();
  let reads = 0;
  let currentModel = "initial";
  let stale = false;
  let theme = "initial-theme";
  Object.defineProperty(h.ctx, "model", {
    enumerable: true,
    configurable: true,
    get() {
      reads++;
      if (stale) throw new Error("Stale extension context");
      return currentModel;
    },
  });
  Object.defineProperty(h.ctx.ui, "theme", {
    enumerable: true,
    configurable: true,
    get: () => theme,
  });
  h.registered.set("mode", {
    handler: async (_value: string, context: any) => {
      expect(reads).toBe(0);
      expect(context.model).toBe("initial");
      expect(context.ui.theme).toBe("initial-theme");
      await Promise.resolve();
      currentModel = "changed";
      theme = "changed-theme";
      expect(context.model).toBe("changed");
      expect(context.ui.theme).toBe("changed-theme");
      stale = true;
      expect(() => context.model).toThrow("Stale extension context");
    },
  });
  await h.adapter.dispatchUserCommand(h.message("/mode"));
  expect(reads).toBe(3);
});

test("a failed command waits for its queued notifications before rejecting", async () => {
  const h = commandFixture();
  const deliveryStarted = Promise.withResolvers<void>();
  const releaseDelivery = Promise.withResolvers<void>();
  const failure = new Error("Command failed after notification");
  const events: string[] = [];
  h.registered.set("mode", {
    handler: async (_value: string, context: any) => {
      context.ui.notify("Before failure", "warning");
      throw failure;
    },
  });
  const adapter = createClaudeCompatCommands({
    session: h.session,
    async notify(text) {
      events.push(text + " started");
      deliveryStarted.resolve();
      await releaseDelivery.promise;
      events.push(text + " delivered");
    },
  });
  const completion = adapter.dispatchUserCommand(h.message("/mode")).then(
    () => {
      throw new Error("Expected failed command");
    },
    (error) => {
      events.push("command rejected");
      return error;
    },
  );
  try {
    await deliveryStarted.promise;
    expect(events).toEqual(["Before failure started"]);
    releaseDelivery.resolve();
    expect(await completion).toBe(failure);
    expect(events).toEqual(["Before failure started", "Before failure delivered", "command rejected"]);
  } finally {
    releaseDelivery.resolve();
    await completion;
  }
});

test("native question dialogs resolve displayed prefixes and reject ambiguity before opening", async () => {
  const h = commandFixture();
  h.registered.set("questions", { handler() {} });
  const opened: string[] = [];
  let ids = ["q_12345678_first"];
  const adapter = createClaudeCompatCommands({
    session: h.session,
    notify: (text) => {
      h.notices.push(text);
    },
    humanControls: {
      questions: () => ({
        handle: async () => ids.map((id) => ({ id })),
      }),
      openQuestion: async (id) => {
        opened.push(id);
        return { id, status: "pending", text: "Saved question" } as any;
      },
    },
  });
  await adapter.dispatchUserCommand(h.message("/questions open q_12345678"));
  expect(opened).toEqual(["q_12345678_first"]);
  ids = ["q_12345678_first", "q_12345678_second"];
  await expect(adapter.dispatchUserCommand(h.message("/bruv questions open q_12345678"))).rejects.toThrow("ambiguous");
  expect(opened).toHaveLength(1);
  ids.push("q_12345678");
  await adapter.dispatchUserCommand(h.message("/bruv:questions open q_12345678"));
  expect(opened.at(-1)).toBe("q_12345678");
});
