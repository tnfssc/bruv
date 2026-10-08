import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeSwitchEvent,
  type SessionBeforeSwitchResult,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { prepareAgentSession } from "../../src/tasks/agent-session";
import { readSessionRole, registerResumeSafeguards } from "../../src/tasks/resume-safeguards";

// Capture only the three real extension callbacks; each test drives their lifetime.
function captureResumeHandlers() {
  type PickerContext = {
    mode: ExtensionContext["mode"];
    sessionManager?: { getSessionFile?: () => string; getSessionDir?: () => string };
  };
  type ConfirmationContext = Pick<ExtensionContext, "mode"> & {
    ui: Pick<ExtensionContext["ui"], "confirm">;
  };
  let start!: (event: unknown, context: PickerContext) => void;
  let beforeSwitch!: (
    event: Pick<SessionBeforeSwitchEvent, "reason" | "targetSessionFile">,
    context: ConfirmationContext,
  ) => Promise<SessionBeforeSwitchResult | void>;
  let shutdown!: () => void;
  registerResumeSafeguards({
    on(event: string, handler: unknown) {
      if (event === "session_start") start = handler as typeof start;
      if (event === "session_before_switch") beforeSwitch = handler as typeof beforeSwitch;
      if (event === "session_shutdown") shutdown = handler as typeof shutdown;
      return () => {};
    },
  } as ExtensionAPI);
  return { start, beforeSwitch, shutdown };
}

test("durable agent metadata drives picker labels and deliberate child confirmation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resume-role-"));
  const handlers = captureResumeHandlers();
  try {
    const prepared = await prepareAgentSession(dir, dir, {
      type: "normal",
      model: "p/model",
      depth: 1,
      parentSessionFile: "/parent.jsonl",
    });
    const file = prepared.agent.sessionFile,
      role = await readSessionRole(file);
    expect(role).toEqual({ kind: "worker", type: "normal", taskId: prepared.id });
    const originalList = SessionManager.list,
      originalListAll = SessionManager.listAll;
    await handlers.start({}, { mode: "tui", sessionManager: { getSessionFile: () => file } });
    const picker = await SessionManager.list(dir, dir);
    expect(picker[0]?.name).toContain("◇ worker · normal");
    let prompt = "";
    const denied = await handlers.beforeSwitch(
      { reason: "resume", targetSessionFile: file },
      {
        mode: "tui",
        ui: {
          confirm: async (title: string, message: string) => {
            prompt = title + "\n" + message;
            return false;
          },
        },
      },
    );
    expect(denied).toEqual({ cancel: true });
    expect(prompt).toContain("worker child (normal)");
    expect(prompt).toContain(prepared.id);
    await handlers.shutdown();
    expect(SessionManager.list).toBe(originalList);
    expect(SessionManager.listAll).toBe(originalListAll);
  } finally {
    await handlers.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("root sessions are not confirmation-gated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resume-root-")),
    file = join(dir, "root.jsonl");
  const handlers = captureResumeHandlers();
  try {
    await writeFile(file, '{"type":"session"}\n');
    let confirms = 0;
    await handlers.start({}, { mode: "tui", sessionManager: { getSessionFile: () => file } });
    expect(
      await handlers.beforeSwitch(
        { reason: "resume", targetSessionFile: file },
        {
          mode: "tui",
          ui: {
            confirm: async () => {
              confirms++;
              return false;
            },
          },
        },
      ),
    ).toBeUndefined();
    expect(confirms).toBe(0);
    await handlers.shutdown();
  } finally {
    await handlers.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("picker adapter decorates only the active bruv directory and non-TUI resumes do not prompt", async () => {
  const bruvDir = await mkdtemp(join(tmpdir(), "bruv-picker-scope-")),
    otherDir = await mkdtemp(join(tmpdir(), "other-picker-scope-"));
  const handlers = captureResumeHandlers();
  try {
    const child = await prepareAgentSession(bruvDir, bruvDir, {
      type: "fast",
      model: "p/model",
      depth: 1,
      parentSessionFile: "/parent.jsonl",
    });
    await prepareAgentSession(otherDir, otherDir, {
      type: "normal",
      model: "p/model",
      depth: 1,
      parentSessionFile: "/other.jsonl",
    });
    await handlers.start({}, { mode: "tui", sessionManager: { getSessionFile: () => child.agent.sessionFile } });
    expect((await SessionManager.list(bruvDir, bruvDir))[0]?.name).toContain("◇ worker · fast");
    expect((await SessionManager.list(otherDir, otherDir))[0]?.name).not.toContain("◇ worker");
    let confirms = 0;
    expect(
      await handlers.beforeSwitch(
        { reason: "resume", targetSessionFile: child.agent.sessionFile },
        {
          mode: "print",
          ui: {
            confirm: async () => {
              confirms++;
              return false;
            },
          },
        },
      ),
    ).toBeUndefined();
    expect(confirms).toBe(0);
    await handlers.shutdown();
  } finally {
    await handlers.shutdown();
    await rm(bruvDir, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});

test("unreadable session metadata remains unknown rather than labeled root", async () => {
  expect((await readSessionRole(join(tmpdir(), "missing-bruv-session-" + Date.now()))).kind).toBe("unknown");
});

test("picker adapters remain callable through foreign wrappers after shutdown and reinstall", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-picker-compose-"));
  const nativeList = SessionManager.list,
    nativeListAll = SessionManager.listAll;
  const handlers = captureResumeHandlers();
  try {
    const child = await prepareAgentSession(dir, dir, {
      type: "fast",
      model: "p/model",
      depth: 1,
      parentSessionFile: "/parent.jsonl",
    });
    const session = { ...(await SessionManager.list(dir, dir))[0]!, name: "child" };
    SessionManager.list = async () => [session];
    SessionManager.listAll = async () => [session];
    const context = {
      mode: "tui" as const,
      sessionManager: { getSessionFile: () => child.agent.sessionFile, getSessionDir: () => dir },
    };
    await handlers.start({}, context);
    const installedList = SessionManager.list,
      installedListAll = SessionManager.listAll;
    const foreignList: typeof SessionManager.list = (...args) => Reflect.apply(installedList, SessionManager, args);
    const foreignListAll: typeof SessionManager.listAll = (...args) =>
      Reflect.apply(installedListAll, SessionManager, args);
    SessionManager.list = foreignList;
    SessionManager.listAll = foreignListAll;

    await handlers.shutdown();
    expect(SessionManager.list).toBe(foreignList);
    expect(SessionManager.listAll).toBe(foreignListAll);
    expect((await SessionManager.list(dir, dir))[0]?.name).toBe("child");
    expect((await SessionManager.listAll(dir))[0]?.name).toBe("child");

    await handlers.start({}, context);
    expect((await SessionManager.list(dir, dir))[0]?.name).toBe("◇ worker · fast · child");
    expect((await SessionManager.listAll(dir))[0]?.name).toBe("◇ worker · fast · child");
    await handlers.shutdown();
    expect((await SessionManager.list(dir, dir))[0]?.name).toBe("child");
    expect((await SessionManager.listAll(dir))[0]?.name).toBe("child");
  } finally {
    await handlers.shutdown();
    SessionManager.list = nativeList;
    SessionManager.listAll = nativeListAll;
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed roles stay unknown and task IDs are safe and bounded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resume-metadata-"));
  try {
    const unknown = join(dir, "unknown.jsonl"),
      missing = join(dir, "missing.jsonl"),
      broken = join(dir, "broken.jsonl"),
      safe = join(dir, "safe.jsonl");
    await writeFile(
      unknown,
      JSON.stringify({ type: "custom", customType: "bruv-agent", data: { type: "admin", taskId: "task_bad" } }) + "\n",
    );
    await writeFile(
      missing,
      JSON.stringify({ type: "custom", customType: "bruv-agent", data: { taskId: "task_bad" } }) + "\n",
    );
    await writeFile(broken, '{"type":"custom","customType":"bruv-agent","data":');
    const unsafeId = "task_ok\n\x1b]52;c;owned\x07" + "x".repeat(100);
    await writeFile(
      safe,
      JSON.stringify({ type: "custom", customType: "bruv-agent", data: { type: "orchestrator", taskId: unsafeId } }) +
        "\n",
    );
    expect(await readSessionRole(unknown)).toEqual({ kind: "unknown" });
    expect(await readSessionRole(missing)).toEqual({ kind: "unknown" });
    expect(await readSessionRole(broken)).toEqual({ kind: "unknown" });
    const unknownHandlers = captureResumeHandlers();
    let unknownPrompt = "";
    expect(
      await unknownHandlers.beforeSwitch(
        { reason: "resume", targetSessionFile: broken },
        {
          mode: "tui",
          ui: {
            confirm: async (title: string, detail: string) => {
              unknownPrompt = title + "\n" + detail;
              return false;
            },
          },
        },
      ),
    ).toEqual({ cancel: true });
    expect(unknownPrompt).toContain("unverified session");
    expect(unknownPrompt).toContain("root privileges cannot be established");
    const role = await readSessionRole(safe);
    expect(role.kind).toBe("orchestrator");
    expect(role.taskId?.length).toBeLessThanOrEqual(80);
    expect(role.taskId).not.toMatch(/[\s\x00-\x1f\x7f-\x9f]/);
    expect(role.taskId).not.toContain("owned");
    const handlers = captureResumeHandlers();
    let prompt = "";
    await handlers.beforeSwitch(
      { reason: "resume", targetSessionFile: safe },
      {
        mode: "tui",
        ui: {
          confirm: async (title: string, detail: string) => {
            prompt = title + "\n" + detail;
            return false;
          },
        },
      },
    );
    expect(prompt).toContain(role.taskId!);
    expect(prompt).not.toContain("owned");
    expect(prompt).not.toContain("\x1b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("picker lifetime follows all active roots, including shared registrations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-picker-shared-"));
  const otherDir = await mkdtemp(join(tmpdir(), "bruv-picker-other-"));
  const originalList = SessionManager.list,
    originalListAll = SessionManager.listAll;
  const first = captureResumeHandlers(),
    shared = captureResumeHandlers(),
    other = captureResumeHandlers();
  try {
    await prepareAgentSession(dir, dir, {
      type: "fast",
      model: "p/model",
      depth: 1,
      parentSessionFile: "/parent.jsonl",
    });
    await prepareAgentSession(otherDir, otherDir, {
      type: "normal",
      model: "p/model",
      depth: 1,
      parentSessionFile: "/parent.jsonl",
    });
    const context = { mode: "tui" as const, sessionManager: { getSessionDir: () => dir } };
    await first.start({}, context);
    const installedList = SessionManager.list,
      installedListAll = SessionManager.listAll;
    await shared.start({}, context);
    await other.start({}, { mode: "tui", sessionManager: { getSessionDir: () => otherDir } });
    expect(SessionManager.list).toBe(installedList);
    expect(SessionManager.listAll).toBe(installedListAll);

    await first.shutdown();
    await first.shutdown();
    expect((await SessionManager.list(dir, dir))[0]?.name).toContain("◇ worker · fast");
    expect((await SessionManager.listAll(dir))[0]?.name).toContain("◇ worker · fast");

    // Restarting one session must release its old root without removing another owner's root.
    await shared.start({}, { mode: "print" });
    expect((await SessionManager.list(dir, dir))[0]?.name).not.toContain("◇ worker");
    expect((await SessionManager.listAll(dir))[0]?.name).not.toContain("◇ worker");
    expect((await SessionManager.list(otherDir, otherDir))[0]?.name).toContain("◇ worker · normal");
    expect((await SessionManager.listAll(otherDir))[0]?.name).toContain("◇ worker · normal");
    expect(SessionManager.list).toBe(installedList);
    expect(SessionManager.listAll).toBe(installedListAll);

    await other.shutdown();
    expect(SessionManager.list).toBe(originalList);
    expect(SessionManager.listAll).toBe(originalListAll);
  } finally {
    for (const handlers of [first, shared, other]) await handlers.shutdown();
    await rm(dir, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});
