import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeCompatCommands } from "../src/claude-compat/commands";
import { registerQuestions } from "../src/questions/extension";
import { registerQuestionRuntime } from "../src/questions/runtime";
import { registerInstructionMode, INSTRUCTION_MODE_ENTRY } from "../src/agent/instruction-mode";
import { registerGoalMode } from "../src/goals/extension";
import type { UserMessage } from "../src/claude-compat/transport";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bruv-native-commands-"));
  const registered = new Map<string, any>(),
    handlers = new Map<string, any[]>();
  const entries: any[] = [{ id: "root", parentId: null }];
  const notices: string[] = [];
  let originalNotifications = 0;
  const ctx: any = {
    mode: "rpc",
    hasUI: false,
    isIdle: () => false,
    sessionManager: {
      getSessionId: () => "session",
      getSessionFile: () => join(dir, "session.jsonl"),
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
  const pi: any = {
    on(name: string, fn: any) {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
    },
    registerCommand(name: string, command: any) {
      registered.set(name, command);
    },
    appendEntry(customType: string, data: any) {
      entries.push({ id: "entry" + entries.length, parentId: entries.at(-1).id, type: "custom", customType, data });
    },
    sendMessage() {},
  };
  const runtime = registerQuestionRuntime(pi, { supported: () => true });
  registerQuestions(pi, (context) => runtime.commands(context));
  registerInstructionMode(pi, () => true);
  registerGoalMode(pi, { runningIds: () => new Set(), status: () => "finished" }, { hasBlockingQuestions: () => true });
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
    runtime,
    ctx,
    entries,
    notices,
    message,
    session,
    originalNotifications: () => originalNotifications,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("namespaced commands call real goal, mode and question handlers with no phantom UI", async () => {
  const h = fixture();
  try {
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
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Which target?" });
    await h.adapter.dispatchUserCommand(h.message("/bruv questions"));
    expect(h.notices.at(-1)).toContain("Which target?");
    await h.adapter.dispatchUserCommand(h.message("/bruv:questions answer " + q.id + " Human authored answer"));
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("Human authored answer");
    expect(h.ctx.hasUI).toBe(false);
    expect(h.ctx.mode).toBe("rpc");
    expect(h.originalNotifications()).toBe(0);
  } finally {
    h.cleanup();
  }
});

test("status and resources use actual owning session data; no native TUI status no-op", async () => {
  const h = fixture();
  try {
    await h.adapter.dispatchUserCommand(h.message("/bruv status"));
    expect(JSON.parse(h.notices.at(-1)!).stats).toEqual({ cost: 1, toolCalls: 2 });
    await h.adapter.dispatchUserCommand(h.message("/bruv:resources"));
    const resources = JSON.parse(h.notices.at(-1)!);
    expect(resources.skills).toEqual([{ name: "real", path: "/real/skill.md" }]);
    expect(resources.commands).toContain("questions");
    expect(h.notices.at(-1)).not.toContain("private");
  } finally {
    h.cleanup();
  }
});

test("ordinary CLI text is untouched; unknown namespaced input cannot become a model prompt", async () => {
  const h = fixture();
  try {
    for (const input of [
      "/goal status",
      "/questions answer q_foo yes",
      "/mode fast",
      "User discussion of /bruv mode fast",
    ]) {
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
  } finally {
    h.cleanup();
  }
});

test("admission resolves both spellings before dispatch and preserves their argument semantics", async () => {
  const h = fixture();
  try {
    const values: string[] = [];
    h.registered.set("mode", { handler: async (value: string) => values.push(value) });
    expect(await h.adapter.dispatchUserCommand(h.message("  /bruv mode   fast  now  "))).toBe(true);
    expect(await h.adapter.dispatchUserCommand(h.message("  /bruv:mode   fast  now  "))).toBe(true);
    expect(values).toEqual(["fast now", "fast  now"]);
    const blocks = h.message("ignored");
    blocks.message.content = [
      { type: "text", text: "/bruv:mode" },
      { type: "text", text: "fast" },
    ];
    expect(await h.adapter.dispatchUserCommand(blocks)).toBe(true);
    expect(values.at(-1)).toBe("fast");
    for (const text of ["/bruv", "/bruv help", "/bruv:help"]) {
      expect(await h.adapter.dispatchUserCommand(h.message(text))).toBe(true);
      expect(h.notices.at(-1)).toContain("/bruv questions open <id>");
    }
    await expect(h.adapter.dispatchUserCommand(h.message("/bruv status extra"))).rejects.toThrow("Usage:");
    await expect(h.adapter.dispatchUserCommand(h.message("/bruv:resources extra"))).rejects.toThrow("Usage:");
    h.registered.delete("mode");
    expect(h.adapter.catalog().map((command) => command.name)).not.toContain("bruv:mode");
    await expect(h.adapter.dispatchUserCommand(h.message("/bruv mode fast"))).rejects.toThrow("Unavailable");
  } finally {
    h.cleanup();
  }
});

test("extension execution keeps the real context and awaits ordered notification delivery", async () => {
  const h = fixture();
  let release!: () => void;
  const firstDelivery = new Promise<void>((resolve) => {
    release = resolve;
  });
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
    let deliveryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    const adapter = createClaudeCompatCommands({
      session: h.session,
      async notify(text, level) {
        events.push(text + " started " + level);
        if (text === "first") {
          deliveryStarted();
          await firstDelivery;
        }
        events.push(text + " delivered");
      },
    });
    const dispatch = adapter.dispatchUserCommand(h.message("/bruv mode fast")).then((result) => {
      completed = true;
      return result;
    });
    await started;
    expect(completed).toBe(false);
    expect(events).toEqual(["handler returned", "first started warning"]);
    release();
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
    release();
    h.cleanup();
  }
});

test("questions open uses native human controls, not the extension handler", async () => {
  const h = fixture();
  try {
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
    await expect(h.adapter.dispatchUserCommand(h.message("/bruv questions open q_full"))).rejects.toThrow(
      "unavailable",
    );
    expect(opened).toEqual(["q_full"]);
  } finally {
    h.cleanup();
  }
});
