import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  bindInstructionContinuitySession,
  type ClassicSession,
  scopeInstructionContinuity,
  setCurrentInstructionFrame,
} from "../src/agent/instruction-continuity";
import { INSTRUCTION_MODE_ENTRY, registerInstructionMode } from "../src/agent/instruction-mode";
import { inspectDiagnostics } from "../src/diagnostics";
import { mainAgentGuidance, replaceMainAgentGuidance } from "../src/prompts";

type ModeHistory = {
  getBranch(): unknown[];
  getEntries(): unknown[];
  getSessionId(): string;
};

function modeEntry(mode: unknown) {
  return { type: "custom", customType: INSTRUCTION_MODE_ENTRY, data: { mode } };
}

function startModeSession({
  root = true,
  branch = [],
  entries = branch,
  manager = { getBranch: () => branch, getEntries: () => entries, getSessionId: () => "session" },
  appendError,
}: {
  root?: boolean;
  branch?: unknown[];
  entries?: unknown[];
  manager?: ModeHistory;
  appendError?: Error;
} = {}) {
  let command: Parameters<ExtensionAPI["registerCommand"]>[1] | undefined;
  const appended: { type: string; data: unknown }[] = [];
  const notices: { message: string; kind: string }[] = [];
  const statuses: { key: string; value: string | undefined }[] = [];
  const pi = {
    registerCommand(name, value) {
      if (name === "mode") command = value;
    },
    appendEntry(type, data) {
      if (appendError) throw appendError;
      appended.push({ type, data });
    },
  } satisfies Pick<ExtensionAPI, "registerCommand" | "appendEntry">;
  const ctx = {
    sessionManager: manager,
    ui: {
      notify: (message: string, kind: string) => notices.push({ message, kind }),
      setStatus: (key: string, value: string | undefined) => statuses.push({ key, value }),
    },
  } as unknown as ExtensionCommandContext;
  const mode = registerInstructionMode(pi as ExtensionAPI, () => root);
  expect(command).toBeDefined();
  mode.sessionStart(ctx);
  return { mode, runMode: (args: string) => command!.handler(args, ctx), appended, notices, statuses, ctx };
}

function prepareFrame(ctx: ExtensionCommandContext, prompt: string) {
  const session = {
    sessionManager: ctx.sessionManager,
    _baseSystemPromptOptions: {},
    _runSystemPromptOptions: { forceSystemPrompt: undefined as string | undefined },
  };
  bindInstructionContinuitySession(session as unknown as ClassicSession);
  scopeInstructionContinuity(ctx.sessionManager);
  expect(setCurrentInstructionFrame(ctx.sessionManager, prompt)).toBe(true);
  return session;
}

describe("prepared instruction frames", () => {
  test("mode changes rewrite the owned region and can restore it without losing surrounding instructions", async () => {
    const { mode, ctx, runMode } = startModeSession();
    const initial = "BEFORE\n" + mode.guidance(ctx) + "\nAFTER";
    const session = prepareFrame(ctx, initial);

    await runMode("fast");
    expect(session._runSystemPromptOptions.forceSystemPrompt).toBe("BEFORE\n" + mode.guidance(ctx) + "\nAFTER");
    expect(session._runSystemPromptOptions.forceSystemPrompt).not.toContain(
      "Delegating independent code or PR work? Give it a worktree.",
    );

    await runMode("orchestrator");
    expect(session._runSystemPromptOptions.forceSystemPrompt).toBe(initial);
  });

  test("mode changes leave explicit custom instructions and another owner's region untouched", async () => {
    const { mode, ctx, runMode } = startModeSession();
    const prompt = "EXPLICIT CUSTOM\n" + mainAgentGuidance("orchestrator", "another-owner");
    const session = prepareFrame(ctx, prompt);

    await runMode("fast");
    expect(mode.get()).toBe("fast");
    expect(session._runSystemPromptOptions.forceSystemPrompt).toBe(prompt);
  });

  test("owned regions derive from the current session, not prior framing or lifecycle calls", () => {
    const { mode, ctx } = startModeSession();
    const first = mode.guidance(ctx);
    ctx.sessionManager.getSessionId = () => "another-session";
    const second = mode.guidance(ctx);
    expect(second).not.toBe(first);

    mode.shutdown();
    mode.sessionStart(ctx);
    expect(mode.guidance(ctx)).toBe(second);

    ctx.sessionManager.getSessionId = () => "session";
    expect(mode.guidance(ctx)).toBe(first);
  });

  test("bounded replacement preserves framing and never claims an explicit custom prompt", () => {
    const owner = "owned-test-region";
    const frame = "CUSTOM BEFORE\n" + mainAgentGuidance("orchestrator", owner) + "\nCUSTOM AFTER";
    const switched = replaceMainAgentGuidance(frame, "normal", owner);
    expect(switched).toStartWith("CUSTOM BEFORE");
    expect(switched).toEndWith("CUSTOM AFTER");
    expect(switched).toContain("<!-- bruv:main-agent-mode:owned-test-region:start -->\n\n");
    expect(switched).not.toContain("You build and fix code.");
    expect(switched).not.toContain("Delegating independent code or PR work? Give it a worktree.");

    const restored = replaceMainAgentGuidance(switched, "orchestrator", owner);
    expect(restored).toStartWith("CUSTOM BEFORE");
    expect(restored).toEndWith("CUSTOM AFTER");
    expect(restored).toContain("Delegating independent code or PR work? Give it a worktree.");
    expect(replaceMainAgentGuidance("EXPLICIT CUSTOM", "fast", owner)).toBe("EXPLICIT CUSTOM");
  });
});

describe("/mode command", () => {
  test("an empty argument reports the current mode without persisting a change", async () => {
    const { mode, runMode, notices, appended } = startModeSession();
    expect(mode.get()).toBe("orchestrator");

    await runMode("");
    expect(notices.at(-1)!.message).toContain("Use /mode fast|normal|orchestrator");
    expect(appended).toEqual([]);
    expect(mode.get()).toBe("orchestrator");
  });

  test("an invalid argument reports usage without changing mode", async () => {
    const { mode, runMode, notices, appended } = startModeSession();

    await runMode("turbo");
    expect(notices.at(-1)).toMatchObject({ kind: "error", message: "Usage: /mode fast|normal|orchestrator" });
    expect(appended).toEqual([]);
    expect(mode.get()).toBe("orchestrator");
  });

  test("a change persists once and updates mode/status, not model or thinking", async () => {
    const { mode, runMode, appended, statuses, notices } = startModeSession();

    await runMode("fast");
    expect(mode.get()).toBe("fast");
    expect(appended).toEqual([{ type: INSTRUCTION_MODE_ENTRY, data: { mode: "fast" } }]);
    expect(statuses.at(-1)).toEqual({ key: "bruv-mode", value: "mode: fast" });
    expect(notices.at(-1)!.message).toContain("model and thinking unchanged");

    await runMode("fast");
    expect(appended).toHaveLength(1);
  });

  test("a child ignores persisted root mode and cannot change its fixed role", async () => {
    const { mode, runMode, appended, notices } = startModeSession({ root: false, branch: [modeEntry("fast")] });
    expect(mode.get()).toBe("orchestrator");

    await runMode("normal");
    expect(mode.get()).toBe("orchestrator");
    expect(appended).toEqual([]);
    expect(notices.at(-1)!.message).toContain("fixed role and delegation depth");
  });

  test("failed persistence leaves memory, status, and the prepared frame unchanged", async () => {
    const { mode, ctx, runMode, statuses, notices, appended } = startModeSession({
      appendError: new Error("disk full"),
    });
    const initial = mode.guidance(ctx);
    const session = prepareFrame(ctx, initial);

    await runMode("fast");
    expect(mode.get()).toBe("orchestrator");
    expect(appended).toEqual([]);
    expect(statuses.at(-1)).toEqual({ key: "bruv-mode", value: "mode: orchestrator" });
    expect(notices.at(-1)).toMatchObject({ kind: "error" });
    expect(notices.at(-1)!.message).toContain("disk full");
    expect(session._runSystemPromptOptions.forceSystemPrompt).toBe(initial);
  });
});

describe("session history", () => {
  test("resume uses the newest owned mode entry", () => {
    const { mode } = startModeSession({ branch: [modeEntry("normal"), modeEntry("invalid"), modeEntry("fast")] });
    expect(mode.get()).toBe("fast");
  });

  test("a corrupt newest mode is an authority boundary, not permission to revive an older mode", () => {
    const { mode, ctx } = startModeSession({ branch: [modeEntry("fast"), modeEntry("invalid")] });
    expect(mode.get()).toBe("orchestrator");
    expect(inspectDiagnostics(ctx.sessionManager).records).toContainEqual({
      version: 1,
      generated: expect.any(String),
      component: "settings",
      code: "settings_invalid",
      outcome: "fallback",
    });
  });

  test("refresh reads late-attached active-branch entries, not abandoned history", () => {
    const abandoned = modeEntry("fast");
    const active = modeEntry("normal");
    const branch: ReturnType<typeof modeEntry>[] = [];
    const { mode, ctx } = startModeSession({ branch, entries: [active, abandoned] });
    expect(mode.get()).toBe("orchestrator");

    // SDK embedders can attach resumed entries after session_start; the turn hook refreshes them.
    branch.push(active);
    mode.refresh(ctx);
    expect(mode.get()).toBe("normal");
  });

  test("a real SessionManager branch ignores mode entries on the abandoned branch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-mode-branch-"));
    try {
      const manager = SessionManager.create(dir, dir);
      const activeMode = manager.appendCustomEntry(INSTRUCTION_MODE_ENTRY, { mode: "normal" });
      manager.appendCustomEntry(INSTRUCTION_MODE_ENTRY, { mode: "fast" });
      manager.branch(activeMode);
      manager.appendCustomEntry("active-tip", {});

      const { mode } = startModeSession({ manager });
      expect(mode.get()).toBe("normal");
      expect(
        manager
          .getEntries()
          .some(
            (entry) =>
              entry.type === "custom" &&
              entry.customType === INSTRUCTION_MODE_ENTRY &&
              (entry.data as { mode: unknown }).mode === "fast",
          ),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a real disk reopen produces a byte-identical mode prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-mode-reopen-"));
    try {
      const created = SessionManager.create(dir, dir);
      const file = created.getSessionFile()!;
      // Seed the header so open() appends to a real file rather than an unflushed in-memory session.
      await Bun.write(file, JSON.stringify(created.getHeader()) + "\n");
      const writable = SessionManager.open(file);
      writable.appendCustomEntry(INSTRUCTION_MODE_ENTRY, { mode: "normal" });

      const running = startModeSession({ manager: writable });
      const beforeRestart = "base\n\n" + running.mode.guidance(running.ctx);
      const reopened = startModeSession({ manager: SessionManager.open(file) });
      const afterRestart = "base\n\n" + reopened.mode.guidance(reopened.ctx);
      expect(afterRestart).toBe(beforeRestart);
      expect(afterRestart).toContain("<!-- bruv:main-agent-mode:");
      expect(afterRestart).not.toContain("You build and fix code.");
      expect(afterRestart).not.toContain("Delegating independent code or PR work? Give it a worktree.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
