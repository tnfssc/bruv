import { QuestionService } from "../../src/questions/service";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRemoteRuntime } from "../../src/remote/runtime";

test("owner completion checkpoint reads actual paged jobs and pending-message state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-runtime-"));
  const previous = process.env.BRUV_REMOTE_RUNTIME_STATE;
  process.env.BRUV_REMOTE_RUNTIME_STATE = join(dir, "runtime.json");
  try {
    const handlers = new Map<string, Function>();
    let pages = 0;
    registerRemoteRuntime({
      registerCommand() {},
      on: (event: string, fn: Function) => handlers.set(event, fn),
      events: {
        emit: (_name: string, request: any) =>
          request.accept({
            list: async () =>
              ++pages === 1 ? { jobs: [{ status: "completed" }], nextCursor: 1 } : { jobs: [{ status: "running" }] },
          }),
      },
    } as any);
    await handlers.get("agent_start")!();
    expect(JSON.parse(readFileSync(process.env.BRUV_REMOTE_RUNTIME_STATE!, "utf8"))).toEqual({ settled: false });
    await handlers.get("agent_settled")!(
      {},
      { hasPendingMessages: () => true, sessionManager: { getLeafId: () => null, getSessionFile: () => "/session" } },
    );
    expect(JSON.parse(readFileSync(process.env.BRUV_REMOTE_RUNTIME_STATE!, "utf8"))).toMatchObject({
      settled: true,
      activeJobs: 1,
      pendingMessages: true,
      questions: [],
    });
    expect(pages).toBe(2);
  } finally {
    if (previous === undefined) delete process.env.BRUV_REMOTE_RUNTIME_STATE;
    else process.env.BRUV_REMOTE_RUNTIME_STATE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turn checkpoint waits for terminal text capture and retains gaps across job pages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-runtime-capture-"));
  const previous = process.env.BRUV_REMOTE_RUNTIME_STATE;
  const path = join(dir, "runtime.json");
  process.env.BRUV_REMOTE_RUNTIME_STATE = path;
  let releaseCapture!: () => void;
  const captureGate = new Promise<void>((resolve) => {
    releaseCapture = resolve;
  });
  let captureStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    captureStarted = resolve;
  });
  let settlement: Promise<void> | undefined;
  const artifact = (id: string) => join(dir, "session.jsonl.artifacts", "execute-job-" + id, "stdout.log");
  try {
    const handlers = new Map<string, Function>();
    const cursors: unknown[] = [];
    registerRemoteRuntime({
      registerCommand() {},
      on: (event: string, fn: Function) => handlers.set(event, fn),
      events: {
        emit: (_name: string, request: any) =>
          request.accept({
            list: async ({ cursor }: { cursor?: number }) => {
              cursors.push(cursor);
              return cursor === undefined
                ? { jobs: [{ id: "first", status: "completed" }], nextCursor: 1 }
                : { jobs: [{ id: "second", status: "failed" }, { status: "running" }, { status: "killed" }] };
            },
            inspect: async (id: string) => {
              if (id === "first") {
                captureStarted();
                await captureGate;
                return { output: "retained first text", outputLost: true };
              }
              return { output: "second text" };
            },
          }),
      },
    } as any);
    await handlers.get("agent_start")!();
    settlement = handlers.get("agent_settled")!(
      {},
      {
        hasPendingMessages: () => false,
        sessionManager: { getLeafId: () => null, getSessionFile: () => "/session" },
      },
    );
    await started;
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ settled: false });
    expect(cursors).toEqual([undefined]);
    releaseCapture();
    await settlement;
    expect(readFileSync(artifact("first"), "utf8")).toBe("retained first text");
    expect(readFileSync(artifact("second"), "utf8")).toBe("second text");
    expect(cursors).toEqual([undefined, 1]);
    // Turn settlement deliberately keeps killed jobs active; cancellation uses different evidence.
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      settled: true,
      activeJobs: 2,
      textOutputGap: "Native job output retention gap: first",
      pendingMessages: false,
      questions: [],
      sessionFile: "/session",
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).sort()).toEqual(["runtime.json", "session.jsonl.artifacts"]);
  } finally {
    releaseCapture();
    try {
      await settlement;
    } finally {
      if (previous === undefined) delete process.env.BRUV_REMOTE_RUNTIME_STATE;
      else process.env.BRUV_REMOTE_RUNTIME_STATE = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("incomplete job pagination publishes an error checkpoint, not completion evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-runtime-cursor-"));
  const previous = process.env.BRUV_REMOTE_RUNTIME_STATE;
  const path = join(dir, "runtime.json");
  process.env.BRUV_REMOTE_RUNTIME_STATE = path;
  try {
    const handlers = new Map<string, Function>();
    let pages = 0;
    registerRemoteRuntime({
      registerCommand() {},
      on: (event: string, fn: Function) => handlers.set(event, fn),
      events: {
        emit: (_name: string, request: any) =>
          request.accept({
            list: async () => {
              pages++;
              return { jobs: [], nextCursor: 1 };
            },
          }),
      },
    } as any);
    await handlers.get("agent_start")!();
    await handlers.get("agent_settled")!(
      {},
      {
        hasPendingMessages: () => false,
        sessionManager: { getLeafId: () => null, getSessionFile: () => "/session" },
      },
    );
    expect(pages).toBe(2);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      settled: true,
      error: "Error: Remote job cursor repeated",
    });
  } finally {
    if (previous === undefined) delete process.env.BRUV_REMOTE_RUNTIME_STATE;
    else process.env.BRUV_REMOTE_RUNTIME_STATE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saved remote reply starts one new parent turn, without replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-runtime-answer-"));
  const previous = process.env.BRUV_REMOTE_RUNTIME_STATE;
  process.env.BRUV_REMOTE_RUNTIME_STATE = join(dir, "runtime.json");
  try {
    const entries = [{ id: "root", parentId: null }];
    const ctx = {
      sessionManager: {
        getSessionId: () => "session",
        getSessionFile: () => join(dir, "session.jsonl"),
        getLeafId: () => "root",
        getBranch: () => entries,
        getEntries: () => entries,
      },
    };
    const commands = new Map<string, Function>();
    const sent: Array<{ message: any; delivery: any }> = [];
    registerRemoteRuntime({
      registerCommand: (name: string, command: any) => commands.set(name, command.handler),
      sendMessage: (message: any, delivery: any) => sent.push({ message, delivery }),
      on() {},
    } as any);
    const service = new QuestionService();
    const question = await service.ask(ctx, { text: "Pick a path" });
    const input = {
      id: question.id,
      owner: question.owner,
      version: question.version,
      text: "Use the saved path",
      replyId: "reply-1",
    };
    const encoded = Buffer.from(JSON.stringify(input)).toString("base64url");
    const answer = commands.get("remote-native-answer")!;
    await answer(encoded, ctx);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.delivery).toEqual({ triggerTurn: true, deliverAs: "followUp" });
    expect(sent[0]!.message.customType).toBe("question-answer");
    expect(sent[0]!.message.display).toBe(false);
    expect(sent[0]!.message.content).toContain("Saved answer for " + question.id);
    expect(sent[0]!.message.content).toContain(input.text);
    expect(sent[0]!.message.content).toContain(
      "Saved reply starts a new parent turn. Past tool calls stay past. Native children do not resume in place.",
    );
    expect(service.get(ctx, question.id).delivery).toBe("delivered");
    await answer(encoded, ctx);
    expect(sent).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.BRUV_REMOTE_RUNTIME_STATE;
    else process.env.BRUV_REMOTE_RUNTIME_STATE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
