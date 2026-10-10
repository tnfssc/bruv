import { test, expect } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerQuestions } from "../../src/questions/extension";

type QuestionDialog = { screen: string; pick: string | undefined } | { editor: string; answer: string | undefined };

// Own the UI interaction order, not the question ledger or extension lifecycle.
function questionDialogs(script: QuestionDialog[]) {
  const remaining = [...script];
  const notices: string[] = [];
  return {
    async custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) {
      const step = remaining.shift();
      if (!step || !("pick" in step)) throw new Error("Unexpected question picker");
      const picker = await factory(
        { terminal: { rows: 24 }, requestRender() {} } as Parameters<typeof factory>[0],
        { fg: (_: string, text: string) => text } as Parameters<typeof factory>[1],
        { matches: () => false } as unknown as Parameters<typeof factory>[2],
        () => {},
      );
      expect(picker.render(80).join("\n")).toContain(step.screen);
      return step.pick;
    },
    async editor(title: string) {
      const step = remaining.shift();
      if (!step || !("editor" in step)) throw new Error("Unexpected question editor");
      expect(title).toBe(step.editor);
      return step.answer;
    },
    notify(text: string) {
      notices.push(text);
    },
    setStatus() {},
    expectComplete(expectedNotices: string[] = []) {
      expect(remaining).toEqual([]);
      // The command catches UI errors, so completion must also check its notices.
      expect(notices).toEqual(expectedNotices);
    },
  };
}

test("question commands keep status pinned without stealing focus or repeating notices", async () => {
  const hooks = new Map<string, (...args: any[]) => unknown>();
  let command!: { handler: (args: string, ctx: ExtensionContext) => Promise<void> };
  const statuses = new Map<string, string>();
  const notices: string[] = [];
  const questions = [{ id: "q1", text: "Choose a target?", status: "pending" }];
  let changed = () => {};
  const service = {
    subscribe: (callback: () => void) => {
      changed = callback;
      return () => {
        changed = () => {};
      };
    },
    handle: (method: string, params: Record<string, unknown> = {}) => {
      if (method === "questions.list")
        return params.status ? questions.filter((q) => q.status === params.status) : questions;
      if (method === "questions.get") return questions.find((q) => q.id === params.id);
      if (method === "questions.answer" || method === "questions.cancel") {
        const q = questions.find((q) => q.id === params.id)!;
        q.status = method === "questions.answer" ? "answered" : "cancelled";
        changed();
        return q;
      }
      throw Error(method);
    },
  };
  const pi = {
    on: (name: string, callback: (...args: any[]) => unknown) => {
      hooks.set(name, callback);
    },
    registerCommand: (_name: string, value: typeof command) => {
      command = value;
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    ui: {
      setStatus: (name: string, value: string | undefined) =>
        value ? statuses.set(name, value) : statuses.delete(name),
      notify: (text: string) => notices.push(text),
    },
  } as unknown as ExtensionContext;
  registerQuestions(pi, () => service);
  hooks.get("session_start")!({}, ctx);
  await new Promise((r) => setTimeout(r, 0));
  expect(statuses.get("bruv-questions")).toBe("1 question pending");
  hooks.get("agent_end")!({}, ctx);
  await new Promise((r) => setTimeout(r, 0));
  expect(notices).toEqual([]);
  await command.handler("detail q1", ctx);
  expect(notices.pop()).toContain("Choose a target?");
  await command.handler("list", ctx);
  expect(notices.pop()).toContain("q1");
  await command.handler("answer q1 deploy now", ctx);
  expect(notices.pop()).toBe("Answer saved for q1");
  expect(statuses.get("bruv-questions")).toBe("1 question · 1 saved");
  hooks.get("session_shutdown")!({}, ctx);
  expect(statuses.has("bruv-questions")).toBe(false);
});

test("CLI binds the ID without flattening free-text spacing", async () => {
  let command: any;
  let received: any;
  const pi = {
    on: () => {},
    registerCommand: (_name: string, value: any) => {
      command = value;
    },
  };
  const service = {
    handle: (method: string, params: any) => {
      if (method === "questions.answer") received = params;
      return [];
    },
  };
  const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
  registerQuestions(pi as any, () => service);
  await command.handler("answer q_one keep  these   spaces\nnext line", ctx);
  expect(received).toEqual({ id: "q_one", answer: "keep  these   spaces\nnext line" });
});

test("CLI lists actionable short IDs and resolves them without guessing ambiguous prefixes", async () => {
  let command: any;
  const notices: string[] = [];
  const id = "q_12345678-aaaa-bbbb-cccc-111111111111";
  const questions = [{ id, text: "Which target?", status: "pending" }];
  const calls: Array<{ method: string; params: any }> = [];
  const service = {
    handle: (method: string, params: any) => {
      calls.push({ method, params });
      if (method === "questions.list") return questions;
      if (method === "questions.get") return questions.find((q) => q.id === params.id);
      if (method === "questions.answer") return questions[0];
    },
  };
  const ctx = { ui: { notify: (text: string) => notices.push(text), setStatus: () => {} } };
  registerQuestions(
    {
      on: () => {},
      registerCommand: (_name: string, value: any) => {
        command = value;
      },
    } as any,
    () => service,
  );
  await command.handler("list", ctx);
  expect(notices.pop()).toContain("q_12345678 [pending] Which target?");
  await command.handler("answer q_12345678 Playback", ctx);
  expect(calls.find((call) => call.method === "questions.answer")).toEqual({
    method: "questions.answer",
    params: { id, answer: "Playback" },
  });
  questions.push({ id: "q_12345678-other", text: "Another?", status: "pending" });
  await command.handler("list", ctx);
  expect(notices.pop()).toContain(id);
  await command.handler("answer q_12345678 Playback", ctx);
  expect(notices.pop()).toContain("ambiguous");
  expect(calls.at(-1)?.method).toBe("questions.list");
});

test("empty list and failed refresh remain visibly distinct", async () => {
  let command: any;
  let fail = false;
  const statuses: Array<string | undefined> = [];
  const notices: string[] = [];
  const service = {
    handle: () => {
      if (fail) throw Error("Question ledger unavailable");
      return [];
    },
  };
  const ctx = {
    ui: {
      setStatus: (_name: string, text: string | undefined) => statuses.push(text),
      notify: (text: string) => notices.push(text),
    },
  };
  const pi = {
    on: () => {},
    registerCommand: (_name: string, value: any) => {
      command = value;
    },
  };
  const { refresh } = registerQuestions(pi as any, () => service);
  await command.handler("list", ctx as any);
  expect(notices.pop()).toBe("No questions");
  fail = true;
  await refresh();
  expect(statuses.at(-1)).toBe("/questions unavailable");
  await command.handler("list", ctx as any);
  expect(notices.pop()).toBe("Question ledger unavailable");
});

test("corrupt question data has a readable command error", async () => {
  let command: any;
  const notices: string[] = [];
  registerQuestions(
    {
      on() {},
      registerCommand(_name: string, value: any) {
        command = value;
      },
    } as any,
    () => ({
      handle() {
        throw new SyntaxError("JSON Parse error: Unexpected identifier");
      },
    }),
  );
  await command.handler("list", {
    ui: {
      setStatus() {},
      notify(text: string) {
        notices.push(text);
      },
    },
  });
  expect(notices).toEqual(["Could not read saved questions: invalid data. Repair the questions file before retrying."]);
});

test("no-history sessions do not show a passive questions failure", async () => {
  const hooks = new Map<string, any>();
  let command: any;
  const notices: string[] = [];
  const statuses: unknown[] = [];
  registerQuestions(
    {
      on(name: string, fn: any) {
        hooks.set(name, fn);
      },
      registerCommand(_name: string, value: any) {
        command = value;
      },
    } as any,
    () => ({
      handle() {
        throw new Error("Questions require a persistent session file");
      },
    }),
  );
  const ctx = {
    sessionManager: {
      getSessionFile() {
        return undefined;
      },
    },
    ui: {
      setStatus(_name: string, text: unknown) {
        statuses.push(text);
      },
      notify(text: string) {
        notices.push(text);
      },
    },
  };
  hooks.get("session_start")({}, ctx);
  await Bun.sleep(0);
  expect(statuses).toEqual([undefined]);
  await command.handler("list", ctx);
  expect(notices).toEqual(["Questions require a persistent session file"]);
});

test("detail uses the same unambiguous short ID as list, including saved-answer recovery", async () => {
  let command: any;
  const notices: string[] = [];
  const id = "q_12345678-1234-4abc-8def-123456789abc";
  const question = { id, text: "Which target?", status: "answered", answer: "Playback", delivery: "saved" };
  const service = {
    handle(method: string, params: any) {
      if (method === "questions.list") return [question];
      if (method === "questions.get") return params.id === id ? question : null;
      throw Error(method);
    },
  };
  registerQuestions(
    {
      on() {},
      registerCommand(_name: string, value: any) {
        command = value;
      },
    } as any,
    () => service,
  );
  const ctx = {
    ui: {
      notify(text: string) {
        notices.push(text);
      },
      setStatus() {},
    },
  };
  await command.handler("detail " + id, ctx);
  expect(notices.at(-1)).toContain("q_12345678 [answered] Which target?");
  expect(notices.at(-1)).toContain("/questions resume q_12345678");
  expect(notices.at(-1)).not.toContain(id);
});

test("interactive inbox answers only selected choice, advances, and escape leaves data untouched", async () => {
  let command: any;
  const questions = [
    {
      id: "q_first",
      text: "Which deployment target?",
      choices: ["staging", "production"],
      allowFreeText: false,
      status: "pending",
      version: 2,
      owner: { sessionId: "s", branchId: "b" },
    },
    { id: "q_second", text: "Why?", status: "pending", version: 1, owner: { sessionId: "s", branchId: "b" } },
  ];
  const replies: any[] = [];
  const dialogs = questionDialogs([
    { screen: "Questions · 2 unanswered", pick: "q_first" },
    { screen: "Which deployment target?", pick: "1" },
    { screen: "Questions · 1 unanswered", pick: "q_second" },
    { screen: "Why?", pick: "write" },
    { editor: "Why?", answer: undefined },
    { screen: "Why?", pick: undefined },
    { screen: "Questions · 1 unanswered", pick: undefined },
  ]);
  const ctx = { mode: "tui", ui: dialogs } as unknown as ExtensionContext;
  registerQuestions(
    {
      on() {},
      registerCommand(_: string, value: any) {
        command = value;
      },
    } as any,
    () => ({
      handle(method: string, params: any) {
        if (method === "questions.list") return questions;
        if (method === "questions.answer") {
          replies.push(params);
          questions.find((q) => q.id === params.id)!.status = "answered";
        }
      },
    }),
  );
  await command.handler("", ctx);
  expect(replies).toEqual([{ id: "q_first", answer: "production", owner: questions[0].owner, version: 2 }]);
  expect(questions[1].status).toBe("pending");
  dialogs.expectComplete();
  expect((await command.getArgumentCompletions("ans"))[0].label).toBe("answer");
});

test("cancelled or empty free text retries choices; Escape from choices returns to inbox without mutation", async () => {
  let command: any;
  const question = {
    id: "q_one",
    text: "Why?",
    status: "pending",
    version: 1,
    owner: { sessionId: "s", branchId: "b" },
  };
  const answers: any[] = [];
  const dialogs = questionDialogs([
    { screen: "Questions · 1 unanswered", pick: "q_one" },
    { screen: "Why?", pick: "write" },
    { editor: "Why?", answer: undefined },
    { screen: "Why?", pick: "write" },
    { editor: "Why?", answer: "   " },
    { screen: "Why?", pick: "write" },
    { editor: "Why?", answer: "valid answer" },
  ]);
  const ctx = { mode: "tui", ui: dialogs } as unknown as ExtensionContext;
  registerQuestions(
    {
      on() {},
      registerCommand(_: string, value: any) {
        command = value;
      },
    } as any,
    () => ({
      handle(method: string, params: any) {
        if (method === "questions.list") return [question];
        if (method === "questions.answer") {
          answers.push(params);
          question.status = "answered";
        }
      },
    }),
  );
  await command.handler("", ctx);
  expect(answers).toEqual([{ id: "q_one", answer: "valid answer", owner: question.owner, version: 1 }]);
  // Answering the last question closes the inbox with a notice, not another picker.
  dialogs.expectComplete(["No unanswered questions"]);
  question.status = "pending";
  const escapeDialogs = questionDialogs([
    { screen: "Questions · 1 unanswered", pick: "q_one" },
    { screen: "Why?", pick: undefined },
    { screen: "Questions · 1 unanswered", pick: undefined },
  ]);
  await command.handler("", { mode: "tui", ui: escapeDialogs });
  escapeDialogs.expectComplete();
  expect(answers).toHaveLength(1);
  expect(question.status).toBe("pending");
});

test("inbox submits displayed owner/version even when the ledger changes during a choice", async () => {
  let command!: { handler: (args: string, ctx: ExtensionContext) => Promise<void> };
  const displayed = {
    id: "q_one",
    text: "Which target?",
    choices: ["staging"],
    allowFreeText: false,
    status: "pending",
    version: 2,
    owner: { sessionId: "s", branchId: "displayed" },
  };
  let current = displayed;
  const replies: unknown[] = [];
  const dialogs = questionDialogs([
    { screen: "Questions · 1 unanswered", pick: "q_one" },
    { screen: "Which target?", pick: "0" },
  ]);
  const ctx = {
    mode: "tui",
    ui: {
      ...dialogs,
      async custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) {
        const selected = await dialogs.custom(factory);
        if (selected === "0") {
          current = { ...displayed, version: 3, owner: { sessionId: "s", branchId: "new" } };
        }
        return selected;
      },
    },
  } as unknown as ExtensionContext;
  registerQuestions(
    {
      on() {},
      registerCommand(_: string, value: typeof command) {
        command = value;
      },
    } as unknown as ExtensionAPI,
    () => ({
      handle(method: string, params: Record<string, unknown> = {}) {
        if (method === "questions.list") return [current];
        if (method === "questions.answer") {
          replies.push(params);
          // This mock rejects the stale submission; runtime/service tests own authorization.
          throw new Error("Question changed. Reopen /questions for current version.");
        }
        throw new Error(method);
      },
    }),
  );
  await command.handler("", ctx);
  dialogs.expectComplete(["Question changed. Reopen /questions for current version."]);
  expect(replies).toEqual([{ id: displayed.id, answer: "staging", owner: displayed.owner, version: 2 }]);
  expect(current.status).toBe("pending");
});

test("picker wraps full long labels at narrow width and filters without answering on escape", async () => {
  const { QuestionPicker } = await import("../../src/questions/picker");
  const done: Array<string | undefined> = [];
  const picker = new QuestionPicker(
    "Question\nsecond line",
    [
      { value: "a", label: "A very long first choice that must wrap cleanly across narrow terminals" },
      { value: "b", label: "Other choice" },
    ],
    { fg: (_: string, text: string) => text } as any,
    {
      matches: (data: string, action: string) =>
        (action === "tui.select.cancel" && data === "\x1b") ||
        (action === "tui.select.confirm" && data === "\r") ||
        (action === "tui.select.down" && data === "\x1b[B"),
    } as any,
    (value) => done.push(value),
    () => {},
    () => 20,
  );
  const frame = picker.render(24);
  expect(frame.join("\n")).toContain("must wrap cleanly");
  const { visibleWidth } = await import("@earendil-works/pi-tui");
  expect(frame.every((line) => visibleWidth(line) <= 24)).toBe(true);
  picker.handleInput("\x1b[B");
  expect(picker.render(24).join("\n")).toContain("Other choice");
  picker.handleInput("\x1b");
  expect(done).toEqual([undefined]);
});

test("in-flight refresh after SDK context invalidation reports no stale-context failure", async () => {
  let failRefresh!: (error: Error) => void;
  const pending = new Promise((_resolve, reject) => {
    failRefresh = reject;
  });
  let calls = 0;
  let stale = false;
  let statusCalls = 0;
  const hooks = new Map<string, any>();
  const { refresh } = registerQuestions(
    {
      on(name: string, fn: any) {
        hooks.set(name, fn);
      },
      registerCommand() {},
    } as any,
    () => ({ handle: () => (++calls === 1 ? [] : pending) }),
  );
  const ctx = {
    ui: {
      setStatus() {
        statusCalls++;
        if (stale) throw new Error("This extension ctx is stale after session replacement or reload.");
      },
    },
  };
  hooks.get("session_start")({}, ctx);
  await Promise.resolve();
  stale = true;
  const work = refresh();
  failRefresh(new Error("remote status refresh failed"));
  await expect(work).resolves.toBeUndefined();
  expect(statusCalls).toBe(2);
});

test("refresh completing after session shutdown does not touch the disposed context", async () => {
  const hooks = new Map<string, any>();
  let failRefresh!: (error: Error) => void;
  const pending = new Promise((_resolve, reject) => {
    failRefresh = reject;
  });
  let calls = 0;
  let stale = false;
  let statusCalls = 0;
  const { refresh } = registerQuestions(
    {
      on(name: string, fn: any) {
        hooks.set(name, fn);
      },
      registerCommand() {},
    } as any,
    () => ({ handle: () => (++calls === 1 ? [] : pending) }),
  );
  const ctx = {
    ui: {
      setStatus() {
        if (stale) throw new Error("This extension ctx is stale after session replacement or reload.");
        statusCalls++;
      },
    },
  };
  hooks.get("session_start")({}, ctx);
  await Promise.resolve();
  const work = refresh();
  hooks.get("session_shutdown")();
  stale = true;
  failRefresh(new Error("remote status refresh failed"));
  await expect(work).resolves.toBeUndefined();
  expect(statusCalls).toBe(2);
});

test("refresh still propagates non-lifecycle status errors", async () => {
  let calls = 0;
  const hooks = new Map<string, any>();
  let statusCalls = 0;
  const { refresh } = registerQuestions(
    {
      on(name: string, fn: any) {
        hooks.set(name, fn);
      },
      registerCommand() {},
    } as any,
    () => ({ handle: () => (++calls === 1 ? [] : Promise.reject(new Error("refresh failed"))) }),
  );
  hooks.get("session_start")(
    {},
    {
      ui: {
        setStatus() {
          if (++statusCalls > 1) throw new Error("status failure");
        },
      },
    },
  );
  await Promise.resolve();
  await expect(refresh()).rejects.toThrow("status failure");
});

test("detail separates local delivery, remote observations and uncertain human replies", async () => {
  let command: any;
  const notices: string[] = [];
  const question: any = { id: "q_saved", text: "Choose target?", status: "answered", answer: "staging" };
  const ctx: any = { ui: { notify: (text: string) => notices.push(text), setStatus() {} } };
  registerQuestions(
    {
      on() {},
      registerCommand(_: string, value: any) {
        command = value;
      },
    } as any,
    () => ({
      handle(method: string) {
        if (method === "questions.list") return [question];
        if (method === "questions.get") return question;
        throw new Error("Detail must not mutate: " + method);
      },
    }),
  );
  const detail = async () => {
    await command.handler("detail q_saved", ctx);
    return notices.pop()!;
  };
  expect(await detail()).toBe(
    "q_saved [answered] Choose target?\nAnswer: staging\nAnswer saved · /questions resume q_saved",
  );
  question.delivery = "queued";
  expect(await detail()).toContain("Answer saved · waiting for parent");
  question.delivery = "dispatching";
  expect(await detail()).toContain("Answer saved · delivery uncertain; check parent chat");
  question.delivery = "delivered";
  expect(await detail()).toContain("Answer sent to parent");

  question.remote = { host: "pinned", taskId: "task", id: "remote-q", version: 4 };
  question.answer = undefined;
  expect(await detail()).toBe(
    "q_saved [answered] Choose target?\nRemote ledger: pinned · task · remote-q v4\nRemote ledger says answered; no local human reply inferred.",
  );
  question.answer = "staging";
  expect(await detail()).toContain("Human answer delivered to pinned remote owner");
  question.delivery = "dispatching";
  expect(await detail()).toContain(
    "Human answer saved · remote delivery uncertain; reconnect to reconcile. No duplicate answer will be sent.",
  );
  question.status = "cancelled";
  question.blocked = { foreground: true, taskIds: ["child"], checkpoint: "choose a different plan" };
  expect(await detail()).toBe(
    "q_saved [cancelled] Choose target?\nRemote ledger: pinned · task · remote-q v4\nBlocked follow-up: parent, child — choose a different plan\nAnswer: staging\nCancelled; follow-up needs a new plan, not a guessed answer.",
  );
});
