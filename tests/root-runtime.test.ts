import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerQuestionRuntime } from "../src/questions/runtime";
import { QuestionService } from "../src/questions/service";
import {
  dispatchRootFacet,
  registerRootRuntime,
  rootFacetRequest,
  RootFacetAcknowledgedError,
  type RootJobs,
} from "../src/remote/root-runtime";
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "root-ipc-"));
  const events = new Map<string, Array<(...args: any[]) => any>>(),
    messages: unknown[] = [],
    commands: string[] = [];
  const ctx = {
    sessionManager: {
      getSessionId: () => "actual-sdk-session",
      getSessionFile: () => join(directory, "session.jsonl"),
      getLeafId: () => "branch",
      getBranch: () => [{ id: "branch", parentId: null }],
      getEntries: () => [{ id: "branch", parentId: null }],
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
    abort: async () => {},
    cwd: directory,
  } as unknown as ExtensionContext;
  const pi = {
    on: (name: string, callback: (...args: any[]) => any) => {
      events.set(name, [...(events.get(name) ?? []), callback]);
    },
    sendMessage: (message: unknown) => messages.push(message),
    registerCommand: (name: string) => commands.push(name),
  } as unknown as ExtensionAPI;
  const runtime = registerQuestionRuntime(pi, { supported: () => true, hasMainToolOwner: () => false });
  return {
    questions: { service: runtime.service, sync: (ctx: ExtensionContext) => runtime.syncRemote(ctx) },
    directory,
    ctx,
    pi,
    messages,
    commands,
    async emit(event: string) {
      for (const handler of events.get(event) ?? []) await handler({}, ctx);
    },
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const jobs: Omit<RootJobs, "questions"> = {
  jobs: async (_ctx, method, params) =>
    method === "jobs.stopWork"
      ? { discoveryComplete: true, outcome: "acknowledged", jobs: [] }
      : method === "jobs.list"
        ? { jobs: [] }
        : { method, params },
};
test("private IPC exposes actual persisted questions with trusted pinned human answer, not slash/model text", async () => {
  const f = fixture(),
    socket = join(f.directory, "r.sock"),
    token = "trusted-owner-token";
  const oldSocket = process.env.BRUV_ROOT_RUNTIME_SOCKET,
    oldToken = process.env.BRUV_ROOT_RUNTIME_TOKEN,
    oldType = process.env.BRUV_SUBAGENT_TYPE,
    oldDepth = process.env.BRUV_SUBAGENT_DEPTH;
  delete process.env.BRUV_SUBAGENT_TYPE;
  delete process.env.BRUV_SUBAGENT_DEPTH;
  process.env.BRUV_ROOT_RUNTIME_SOCKET = socket;
  process.env.BRUV_ROOT_RUNTIME_TOKEN = token;
  try {
    registerRootRuntime(f.pi, { ...jobs, questions: f.questions });
    await f.emit("session_start");
    expect(f.commands).toEqual([]);
    const service = f.questions.service;
    const question = await service.ask(f.ctx, { text: "Approve this?", choices: ["yes", "no"], allowFreeText: false });
    expect(await rootFacetRequest(socket, token, { kind: "questions.list" })).toEqual(service.list(f.ctx));
    await expect(
      rootFacetRequest(socket, "model-does-not-have-human-token", {
        kind: "questions.answer",
        id: question.id,
        owner: question.owner,
        version: question.version,
        text: "yes",
        replyId: "reply",
      }),
    ).rejects.toBeInstanceOf(RootFacetAcknowledgedError);
    expect(service.get(f.ctx, question.id).status).toBe("pending");
    await expect(
      rootFacetRequest(socket, token, {
        kind: "questions.answer",
        id: question.id,
        owner: question.owner,
        version: question.version + 1,
        text: "yes",
        replyId: "reply",
      }),
    ).rejects.toThrow("Stale");
    await expect(
      rootFacetRequest(socket, token, {
        kind: "questions.answer",
        id: question.id,
        owner: { ...question.owner, branchId: "other" },
        version: question.version,
        text: "yes",
        replyId: "reply",
      }),
    ).rejects.toThrow("owner branch");
    const command = {
      kind: "questions.answer" as const,
      id: question.id,
      owner: question.owner,
      version: question.version,
      text: "yes",
      replyId: "human-reply",
    };
    await rootFacetRequest(socket, token, command);
    const answered = service.get(f.ctx, question.id);
    expect(answered.status).toBe("answered");
    expect(answered.answeredFrom).toBe("cli");
    expect(answered.replyId).toBe("human-reply");
    expect(answered.delivery).toBe("delivered");
    expect(f.messages).toHaveLength(1);
    await rootFacetRequest(socket, token, command);
    expect(f.messages).toHaveLength(1);
    expect(await rootFacetRequest(socket, token, { kind: "jobs.stop", id: "job-on-server" })).toEqual({
      method: "jobs.stop",
      params: { id: "job-on-server" },
    });
    expect(await rootFacetRequest(socket, token, { kind: "close" })).toMatchObject({ settled: true });
  } finally {
    await f.emit("session_shutdown");
    if (oldType === undefined) delete process.env.BRUV_SUBAGENT_TYPE;
    else process.env.BRUV_SUBAGENT_TYPE = oldType;
    if (oldDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
    else process.env.BRUV_SUBAGENT_DEPTH = oldDepth;
    if (oldSocket === undefined) delete process.env.BRUV_ROOT_RUNTIME_SOCKET;
    else process.env.BRUV_ROOT_RUNTIME_SOCKET = oldSocket;
    if (oldToken === undefined) delete process.env.BRUV_ROOT_RUNTIME_TOKEN;
    else process.env.BRUV_ROOT_RUNTIME_TOKEN = oldToken;
    f.cleanup();
  }
});
test("configured ordinary QuestionService owns native/SSH continuation with no backend duplicate message", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    let callbacks = 0,
      syncs = 0;
    service.onAnswered = async () => {
      callbacks++;
    };
    const question = await service.ask(f.ctx, { text: "server-native question" });
    const configured = {
      ...jobs,
      questions: {
        service,
        sync: async () => {
          syncs++;
        },
      },
    };
    await dispatchRootFacet(f.ctx, configured, {
      kind: "questions.answer",
      id: question.id,
      owner: question.owner,
      version: question.version,
      text: "human",
      replyId: "pinned-reply",
    });
    expect(callbacks).toBe(1);
    expect(syncs).toBe(1);
    expect(f.messages).toHaveLength(0);
    expect(service.get(f.ctx, question.id).replyId).toBe("pinned-reply");
  } finally {
    f.cleanup();
  }
});
test("close does not certify incomplete cancellation discovery or active children", async () => {
  const f = fixture();
  try {
    const result = await dispatchRootFacet(
      f.ctx,
      { questions: f.questions, jobs: async () => ({ discoveryComplete: false, outcome: "partial" }) },
      { kind: "close" },
    );
    expect(result).toMatchObject({ settled: false, error: "Root cancellation discovery incomplete" });
  } finally {
    f.cleanup();
  }
});

test("root facet snapshots project durable typed task rows and retain call ownership without stale regression", async () => {
  const f = fixture();
  try {
    const running = {
      id: "actual-task",
      source: "local",
      status: "running",
      terminal: false,
      title: "Run tests",
      sourceCallId: "launch-call",
    };
    const failed = { ...running, status: "failed", terminal: true, exitCode: 1 };
    f.ctx.sessionManager.getBranch = (() => [
      { type: "custom", customType: "die-task-row", data: running },
      { type: "custom", customType: "die-task-row", data: failed },
      { type: "custom", customType: "die-task-row", data: running },
      { type: "custom", customType: "unrelated", data: { ...failed, id: "not-a-task" } },
    ]) as any;
    const value = (await dispatchRootFacet(f.ctx, { ...jobs, questions: f.questions }, { kind: "snapshot" })) as any;
    expect(value.taskRows).toEqual([failed]);
    expect(value.jobs).toEqual([]);
  } finally {
    f.cleanup();
  }
});
