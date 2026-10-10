import { expect, spyOn, test } from "bun:test";
import { basename } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerGoal } from "../src/goal";
import { notify, registerNotifications } from "../src/notify";
import { sdk } from "./sdk";

const cases: { mode: ExtensionContext["mode"]; tty: boolean; ui: boolean }[] = [
  { mode: "tui", tty: true, ui: true },
  { mode: "tui", tty: false, ui: true },
  { mode: "rpc", tty: true, ui: true },
  { mode: "rpc", tty: false, ui: true },
  { mode: "json", tty: true, ui: false },
  { mode: "print", tty: true, ui: false },
  { mode: "tui", tty: true, ui: false },
];
test.each(cases)("terminal effects require an interactive TTY (%j)", async ({ mode, tty, ui }) => {
  const titles: string[] = [];
  const app = await sdk(
    [registerNotifications],
    ui
      ? {
          setTitle: (title) => {
            titles.push(title);
          },
        }
      : undefined,
    undefined,
    mode,
  );
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: tty });
  const output = spyOn(process.stdout, "write").mockReturnValue(true);
  const now = spyOn(Date, "now");
  const timers = spyOn(globalThis, "setInterval");
  const cleared = spyOn(globalThis, "clearInterval");
  try {
    const runner = app.session.extensionRunner;
    const ctx = runner.createContext();
    const allowed = mode === "tui" && tty && ui;
    titles.length = 0;
    now.mockReturnValue(1000);
    await runner.emit({ type: "agent_start" });
    const timer = timers.mock.results.at(-1)?.value;
    // A continuation shares the start time and title timer.
    await runner.emit({ type: "agent_start" });
    expect(timers.mock.calls).toHaveLength(allowed ? 1 : 0);
    await runner.emitMessageEnd({ type: "message_end", message: fauxAssistantMessage("answer\n".repeat(20)) });
    now.mockReturnValue(32001);
    await runner.emit({ type: "agent_settled", aborted: false });
    expect(output.mock.calls).toHaveLength(allowed ? 1 : 0);
    if (allowed) {
      expect(cleared.mock.calls.some(([value]) => value === timer)).toBe(true);
      expect(titles.at(-1)).toBe(basename(app.dir));
      expect(String(output.mock.calls[0][0]).includes("\n")).toBe(false);
    } else expect(titles).toEqual([]);
    await runner.emit({ type: "agent_settled", aborted: false });
    expect(output.mock.calls).toHaveLength(allowed ? 1 : 0);
    output.mockClear();
    await runner.emit({ type: "agent_start" });
    now.mockReturnValue(33000);
    await runner.emit({ type: "agent_settled", aborted: false });
    expect(output.mock.calls).toHaveLength(0);
    await runner.emit({ type: "agent_start" });
    now.mockReturnValue(100000);
    await runner.emit({ type: "agent_settled", aborted: true });
    expect(output.mock.calls).toHaveLength(0);
    notify(ctx, "fixture");
    expect(output.mock.calls).toHaveLength(allowed ? 1 : 0);
  } finally {
    now.mockRestore();
    output.mockRestore();
    timers.mockRestore();
    cleared.mockRestore();
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
    else Reflect.deleteProperty(process.stdout, "isTTY");
    await app.close();
  }
});

test.each([false, true])("notifications use the terminal protocol and a bell (kitty=%s)", async (kitty) => {
  const app = await sdk([], {}, undefined, "tui");
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const previous = process.env.KITTY_WINDOW_ID;
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  if (kitty) process.env.KITTY_WINDOW_ID = "1";
  else delete process.env.KITTY_WINDOW_ID;
  const output = spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    notify(app.session.extensionRunner.createContext(), "hello\x1b]0;bad\x07\nworld;\x07");
    const text = String(output.mock.calls[0][0]);
    expect(text.startsWith(kitty ? "\x1b]99;" : "\x1b]777;")).toBe(true);
    expect(text.endsWith("\x07")).toBe(true);
    expect(text.split("\x1b]")).toHaveLength(kitty ? 3 : 2);
    expect(text.includes("\n")).toBe(false);
  } finally {
    output.mockRestore();
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
    else Reflect.deleteProperty(process.stdout, "isTTY");
    if (previous === undefined) delete process.env.KITTY_WINDOW_ID;
    else process.env.KITTY_WINDOW_ID = previous;
    await app.close();
  }
});

test.each(["completed", "paused", "budget"])("goal changes notify once (%s)", async (status) => {
  const app = await sdk([registerGoal], {}, undefined, "tui");
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  const output = spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    app.session.sessionManager.appendCustomEntry("bruv-goal", {
      objective: "fixture",
      criteria: [],
      progress: [],
      tokensUsed: 0,
      tokenBudget: 1,
      status: "active",
    });
    await app.session.extensionRunner.emit({ type: "session_start", reason: "resume" });
    expect(output.mock.calls).toHaveLength(0);
    if (status === "paused") await app.session.prompt("/goal pause");
    else {
      const final = fauxAssistantMessage("done");
      if (status === "budget") final.usage.totalTokens = 1;
      app.faux.setResponses(
        status === "completed"
          ? [
              fauxAssistantMessage(
                fauxToolCall("codemode", {
                  code: 'return await tools.goal_update({status:"completed", evidence:"fixture"});',
                }),
                { stopReason: "toolUse" },
              ),
              final,
            ]
          : [final],
      );
      await app.session.prompt("go");
    }
    expect(output.mock.calls).toHaveLength(1);
    await app.session.extensionRunner.emit({ type: "agent_settled", aborted: false });
    expect(output.mock.calls).toHaveLength(1);
  } finally {
    output.mockRestore();
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
    else Reflect.deleteProperty(process.stdout, "isTTY");
    await app.close();
  }
});
