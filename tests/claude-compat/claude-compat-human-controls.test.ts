import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerQuestionRuntime } from "../../src/questions/runtime";
import { createClaudeCompatHumanControls } from "../../src/claude-compat/human-controls";
import { QuestionService } from "../../src/questions/service";
import { PassThrough } from "node:stream";
import { ClaudeCompatTransport } from "../../src/claude-compat/transport";
import type { HumanControlOptions } from "../../src/claude-compat/human-controls";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function nativeDialogs({ honorAbort = true } = {}) {
  const calls: Array<{
    request: any;
    signal?: AbortSignal;
    resolve: (response: Record<string, unknown>) => void;
    allow: (answer: string) => void;
  }> = [];
  const request: HumanControlOptions["request"] = (request, options) =>
    new Promise((resolve, reject) => {
      calls.push({
        request,
        signal: options?.signal,
        resolve,
        allow(answer) {
          resolve({
            behavior: "allow",
            toolUseID: request.tool_use_id,
            updatedInput: { answers: { [(request.input as any).questions[0].question]: answer } },
          });
        },
      });
      if (honorAbort) {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason ?? new Error("Disconnected")), {
          once: true,
        });
      }
    });
  return { calls, request };
}

function fixture({
  sessionFile,
  request,
  askUserQuestion = true,
}: {
  sessionFile?: string;
  request?: HumanControlOptions["request"];
  askUserQuestion?: boolean;
} = {}) {
  const dir = sessionFile ? undefined : mkdtempSync(join(tmpdir(), "bruv-native-questions-"));
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  const bus = new Map<string, Set<(value: unknown) => void>>();
  const sent: any[] = [];
  let idle = false,
    leaf = "root";
  const ctx: any = {
    sessionManager: {
      getSessionFile: () => sessionFile ?? join(dir!, "session.jsonl"),
      getSessionId: () => "session",
      getLeafId: () => leaf,
      getBranch: () => [{ id: leaf }],
    },
    isIdle: () => idle,
  };
  const pi: any = {
    on(name: string, fn: any) {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
    },
    sendMessage(message: any) {
      sent.push(message);
    },
    events: {
      on(name: string, fn: any) {
        const set = bus.get(name) ?? new Set();
        set.add(fn);
        bus.set(name, set);
        return () => set.delete(fn);
      },
      emit(name: string, value: unknown) {
        for (const fn of bus.get(name) ?? []) fn(value);
      },
    },
  };
  const runtime = registerQuestionRuntime(pi, { supported: () => false, nativeSupported: () => true });
  const dialogs = nativeDialogs();
  const controls = createClaudeCompatHumanControls({
    askUserQuestion,
    request: request ?? dialogs.request,
  });
  controls.factory(pi);
  const emit = async (name: string, event: any = {}) => {
    for (const fn of handlers.get(name) ?? []) await fn(event, ctx);
  };
  return {
    ctx,
    runtime,
    controls,
    calls: dialogs.calls,
    sent,
    emit,
    idle: () => {
      idle = true;
    },
    branch: (id: string) => {
      leaf = id;
    },
    cleanup: () => {
      controls.dispose();
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("native saved answer delivers once and can be marked used only once", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", {
      text: "Which?",
      dedupKey: "choice",
      choices: ["A", "B"],
      allowFreeText: false,
    });
    await tick();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.request.tool_name).toBe("AskUserQuestion");
    h.calls[0]!.allow("A");
    await tick();
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("A");
    expect(h.sent).toHaveLength(0); // no old execute stack or in-place child resumed
    h.idle();
    await h.emit("agent_settled");
    await tick();
    expect(h.sent).toHaveLength(1);
    await h.emit("agent_settled");
    await tick();
    expect(h.sent).toHaveLength(1);
    await h.controls.openQuestion(q.id);
    expect(h.calls).toHaveLength(1); // an answered dialog never manufactures another reply
    const current = h.runtime.service.get(h.ctx, q.id);
    const used: any = await h.runtime.handle(h.ctx, "questions.resolve", {
      id: current.id,
      owner: current.owner,
      version: current.version,
      reason: "Used saved answer",
    });
    await expect(
      h.runtime.handle(h.ctx, "questions.resolve", {
        id: used.id,
        owner: used.owner,
        version: used.version,
        reason: "Use twice",
      }),
    ).rejects.toThrow("already resolved");
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("resolved");
  } finally {
    h.cleanup();
  }
});

test("denial leaves pending; repeat and explicit reopen use the same ledger question", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Continue?", dedupKey: "same" });
    await tick();
    h.calls[0]!.resolve({ behavior: "deny", interrupt: true, message: "Not now" });
    await tick();
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("pending");
    const repeated: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Continue?", dedupKey: "same" });
    expect(repeated.id).toBe(q.id);
    expect(h.calls).toHaveLength(1);
    const reopen = h.controls.openQuestion(q.id);
    await tick();
    expect(h.calls[1]!.request.tool_use_id).toBe(h.calls[0]!.request.tool_use_id);
    h.calls[1]!.allow("Yes");
    await reopen;
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("Yes");
  } finally {
    h.cleanup();
  }
});

test("reject stale native dialog version and stale owning branch", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Which?" });
    await tick();
    const pending = h.controls.openQuestion(q.id);
    await h.runtime.handle(h.ctx, "questions.block", {
      id: q.id,
      owner: q.owner,
      version: q.version,
      foreground: true,
      checkpoint: "Next step",
    });
    h.calls[0]!.allow("Stale answer");
    await expect(pending).rejects.toThrow("Question changed");
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("pending");
    const reopened = h.controls.openQuestion(q.id);
    await tick();
    h.branch("sibling");
    h.calls[1]!.allow("Wrong owner");
    await expect(reopened).rejects.toThrow();
    h.branch("root");
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("pending");
    const current = h.runtime.service.get(h.ctx, q.id);
    await expect(
      h.controls.questions()!.handle("questions.answer", {
        id: current.id,
        owner: { ...current.owner, sessionId: "foreign" },
        version: current.version,
        answer: "No",
      }),
    ).rejects.toThrow("Question changed");
  } finally {
    h.cleanup();
  }
});

test("process loss preserves the pending record; a fresh frontend reopens the same question", async () => {
  const h = fixture();
  let next: ReturnType<typeof fixture> | undefined;
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Saved?", dedupKey: "restart" });
    await tick();
    const pending = h.controls.openQuestion(q.id);
    await h.emit("session_shutdown");
    await expect(pending).rejects.toThrow("frontend closed");
    expect(new QuestionService().get(h.ctx, q.id).status).toBe("pending");
    next = fixture({ sessionFile: h.ctx.sessionManager.getSessionFile() });
    await next.emit("session_start");
    await tick();
    expect(next.calls).toHaveLength(1);
    const same = next.runtime.service.get(next.ctx, q.id);
    expect(same.owner).toEqual(q.owner);
    expect(same.version).toBe(q.version);
    next.calls[0]!.allow("Recovered");
    await tick();
    expect(next.runtime.service.get(next.ctx, q.id).delivery).toBe("resume-needed");
    next.idle();
    await next.emit("agent_settled");
    await tick();
    expect(next.sent).toHaveLength(0);
    await next.controls.questions()!.handle("questions.resume", { id: q.id });
    await tick();
    expect(next.sent).toHaveLength(1); // explicit human restart resume, not automatic replay
  } finally {
    next?.cleanup();
    h.cleanup();
  }
});

test("saved question projection accepts a correlated allow through the actual NDJSON transport", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const transport = new ClaudeCompatTransport({ input, output, onUser() {}, controls: {} });
  const frames: any[] = [];
  output.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n")) {
      const frame = JSON.parse(line);
      frames.push(frame);
      if (frame.type !== "control_request") continue;
      const question = frame.request.input.questions[0].question;
      input.write(
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: frame.request_id,
            response: {
              behavior: "allow",
              toolUseID: frame.request.tool_use_id,
              updatedInput: { answers: { [question]: "Human wire reply" } },
            },
          },
        }) + "\n",
      );
    }
  });
  const run = transport.run();
  const h = fixture({ request: transport.request.bind(transport) });
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Wire question?" });
    await tick();
    await tick();
    expect(frames).toHaveLength(1);
    expect(frames[0].request.tool_name).toBe("AskUserQuestion");
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("Human wire reply");
  } finally {
    h.cleanup();
    input.end();
    await run;
  }
});

test("a host without native question UI keeps the saved CLI workflow, not phantom hasUI", async () => {
  const h = fixture({ askUserQuestion: false });
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "CLI only?" });
    await tick();
    expect(h.calls).toHaveLength(0);
    expect(h.controls.capabilities.askUserQuestion).toBe(false);
    expect(h.controls.capabilities.tuiPicker).toBe(false);
    expect((await h.controls.openQuestion(q.id)).status).toBe("pending");
    await h.controls.questions()!.handle("questions.answer", { id: q.id, answer: "Typed human reply" });
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("Typed human reply");
  } finally {
    h.cleanup();
  }
});

test("session shutdown and start on the owning runtime recover the same pending question", async () => {
  const h = fixture();
  try {
    expect(h.controls.capabilities.savedQuestions).toBe(false);
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Reopen owner?" });
    await tick();
    const first = h.controls.openQuestion(q.id);
    await h.emit("session_shutdown");
    await expect(first).rejects.toThrow("frontend closed");
    expect(h.controls.capabilities.askUserQuestion).toBe(false);
    await h.emit("session_start");
    await tick();
    expect(h.controls.capabilities.savedQuestions).toBe(true);
    expect(h.calls).toHaveLength(2);
    const second = h.controls.openQuestion(q.id);
    h.calls[1]!.allow("Still same owner");
    await second;
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("Still same owner");
  } finally {
    h.cleanup();
  }
});

test("ask then block refreshes the native dialog to the current saved version", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Pick before next step" });
    await tick();
    const blocked: any = await h.runtime.handle(h.ctx, "questions.block", {
      id: q.id,
      owner: q.owner,
      version: q.version,
      foreground: true,
      checkpoint: "Next operation needs this answer",
    });
    await tick();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.request.tool_use_id).toBe("bruv-question:" + q.id + ":" + blocked.version);
    h.calls[1]!.allow("Current reply");
    await tick();
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("Current reply");
    expect(h.runtime.service.get(h.ctx, q.id).blocked?.checkpoint).toBe("Next operation needs this answer");
  } finally {
    h.cleanup();
  }
});

test("permission allow alone is not a saved human answer", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Need explicit reply" });
    await tick();
    const pending = h.controls.openQuestion(q.id);
    h.calls[0]!.resolve({ behavior: "allow", updatedInput: { answer: "Uncorrelated invented value" } });
    await expect(pending).rejects.toThrow("No explicit human answer");
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("pending");
    expect(h.sent).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});

test("explicit human cancel uses the owning ledger and withdraws the live projection", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Human cancellation" });
    await tick();
    const pending = h.controls.openQuestion(q.id);
    await h.controls.questions()!.handle("questions.cancel", { id: q.id });
    await expect(pending).rejects.toThrow("no longer pending");
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("cancelled");
    expect(h.sent).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});

test("native terminal consent drain waits for the real callback; interrupt preserves question and binding", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", {
      text: "Pending native consent",
      choices: ["A", "B"],
    });
    await tick();
    let drained = false;
    const wait = h.controls.flush().then(() => {
      drained = true;
    });
    await tick();
    expect(drained).toBe(false);
    h.controls.interrupt();
    await wait;
    expect(drained).toBe(true);
    expect(h.calls[0]!.signal?.aborted).toBe(true);
    expect(h.controls.capabilities.savedQuestions).toBe(true);
    const pending = h.runtime.service.get(h.ctx, q.id);
    expect(pending.status).toBe("pending");
    expect(pending.version).toBe(q.version);
    expect(pending.owner).toEqual(q.owner);
    const reopened = h.controls.openQuestion(q.id);
    await tick();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.request.tool_use_id).toBe(h.calls[0]!.request.tool_use_id);
    h.calls[1]!.resolve({ behavior: "deny" });
    await reopened;
    await h.controls.flush();
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBeUndefined();
  } finally {
    h.cleanup();
  }
});

test("official live native question offers explicit defer without minting an answer", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Choose later?", choices: ["A", "B"] });
    await tick();
    expect(h.calls[0]!.request.input.questions[0].options.at(-1).label).toBe("Keep pending (do not answer)");
    h.calls[0]!.allow("Keep pending (do not answer)");
    await h.controls.flush();
    const same = h.runtime.service.get(h.ctx, q.id);
    expect(same.status).toBe("pending");
    expect(same.version).toBe(q.version);
    expect(same.owner).toEqual(q.owner);
    expect(same.answer).toBeUndefined();
    expect(h.sent).toHaveLength(0);
    const reopen = h.controls.openQuestion(q.id);
    await tick();
    expect(h.calls[1]!.request.tool_use_id).toBe(h.calls[0]!.request.tool_use_id);
    h.calls[1]!.allow("A");
    await reopen;
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("A");
  } finally {
    h.cleanup();
  }
});

test("native defer label cannot consume a real ledger choice of the same name", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const label = "Keep pending (do not answer)";
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Real named option", choices: [label, "B"] });
    await tick();
    expect(h.calls[0]!.request.input.questions[0].options.at(-1).label).not.toBe(label);
    h.calls[0]!.allow(label);
    await h.controls.flush();
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe(label);
  } finally {
    h.cleanup();
  }
});

test("replaced frontend rejects late allow even when transport ignores abort", async () => {
  const dialogs = nativeDialogs({ honorAbort: false });
  const h = fixture({ request: dialogs.request });
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Still owned?" });
    await tick();
    const old = h.controls.openQuestion(q.id);
    await h.emit("session_tree");
    await tick();
    expect(dialogs.calls).toHaveLength(2);
    expect(dialogs.calls[0]!.signal?.aborted).toBe(true);
    const current = h.controls.openQuestion(q.id);
    dialogs.calls[0]!.allow("Stale human answer");
    await expect(old).rejects.toThrow("frontend changed");
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("pending");
    expect(h.controls.openQuestion(q.id)).toBe(current);
    dialogs.calls[1]!.allow("Current human answer");
    await current;
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("Current human answer");
  } finally {
    h.cleanup();
  }
});

test("terminal consent drain follows dialogs opened by session replacement", async () => {
  const h = fixture();
  try {
    await h.emit("session_start");
    const q: any = await h.runtime.handle(h.ctx, "questions.ask", { text: "Replace while draining?" });
    await tick();
    let drained = false;
    const drain = h.controls.flush().then(() => {
      drained = true;
    });
    await h.emit("session_tree");
    await tick();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]!.signal?.aborted).toBe(true);
    expect(drained).toBe(false);
    h.calls[1]!.allow("Answered after replacement");
    await drain;
    expect(drained).toBe(true);
    expect(h.runtime.service.get(h.ctx, q.id).answer).toBe("Answered after replacement");
  } finally {
    h.cleanup();
  }
});
