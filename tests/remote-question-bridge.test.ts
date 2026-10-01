import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuestionService, type Question } from "../src/questions/service";
import { RemoteQuestionBridge, publishRemoteQuestionState } from "../src/remote/question-bridge";
import { registerQuestionRuntime } from "../src/questions/runtime";
import remoteExtension from "../src/remote/extension";
import { clearRemoteJobEvents } from "../src/remote/job-events";
import { RemoteClient, type RemoteState } from "../src/remote/client";

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "bruv-remote-question-"));
  let leaf = "root";
  const entries: Array<{ id: string; parentId: string | null }> = [{ id: "root", parentId: null }];
  const ctx: any = {
    sessionManager: {
      getSessionId: () => "parent",
      getSessionFile: () => join(dir, "parent.jsonl"),
      getLeafId: () => leaf,
      getBranch: () => [{ id: "root" }, ...(leaf === "root" ? [] : [{ id: leaf }])],
      getEntries: () => entries,
    },
    isIdle: () => true,
  };
  const native = {
    id: "q_11111111-1111-1111-1111-111111111111",
    owner: { sessionId: "child", branchId: "child-root" },
    version: 3,
    text: "Real human decision?",
    status: "pending",
    choices: ["Yes", "No"],
    allowFreeText: false,
  };
  const state: RemoteState = {
    connection: { host: "pinned", bruvPath: "bruv", hello: { ownerId: "owner", epoch: "epoch", protocol: 1 } as any },
    tasks: {
      t: {
        taskId: "t",
        jobSessionFile: ctx.sessionManager.getSessionFile(),
        host: "pinned",
        ownerId: "owner",
        epoch: "epoch",
        repoPath: "/repo",
        prompt: "work",
        cursor: 0,
        events: [],
        outcome: "accepted",
        task: { taskId: "t", state: "running", questions: [native] },
      },
    },
  };
  const calls: Array<{ request: any; expected: any }> = [];
  let fail = false,
    lost = false;
  const client = {
    read: async () => structuredClone(state),
    control: async (request: any, expected: any) => {
      calls.push({ request, expected });
      if (fail) throw new Error("offline");
      if (lost) {
        state.tasks.t!.task!.reply = { replyId: request.replyId, status: "delivered" };
        throw new Error("response lost");
      }
      return { task: { taskId: "t", reply: { replyId: request.replyId, status: "delivered" } } };
    },
  };
  const service = new QuestionService(),
    bridge = new RemoteQuestionBridge(service, client);
  const mutation = (q: Question) => ({ id: q.id, owner: q.owner, version: q.version });
  return {
    ctx,
    native,
    state,
    client,
    calls,
    service,
    bridge,
    mutation,
    fail: () => {
      fail = true;
    },
    lost: () => {
      lost = true;
    },
    leaf: (v: string) => {
      if (!entries.some((e) => e.id === v)) entries.push({ id: v, parentId: "root" });
      leaf = v;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("real human question mirrors durably once, preserving remote provenance and parent ownership", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    await h.bridge.sync(h.ctx);
    const [q] = new QuestionService().list(h.ctx);
    expect(h.service.list(h.ctx)).toHaveLength(1);
    expect(q!.owner).toEqual({ sessionId: "parent", branchId: "root" });
    expect(q!.remote).toMatchObject({
      taskId: "t",
      host: "pinned",
      ownerId: "owner",
      epoch: "epoch",
      id: h.native.id,
      owner: h.native.owner,
      version: 3,
    });
    expect(h.calls).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});

test("agent ask/get/resolve/cancel/block cannot acquire remote human answer authority", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    const q = h.service.list(h.ctx)[0]!;
    expect(await h.service.handle("questions.get", { id: q.id }, h.ctx)).toEqual(q);
    for (const method of ["resolve", "cancel", "block"]) {
      await expect(
        h.service.handle(
          "questions." + method,
          { ...h.mutation(q), reason: "guess", checkpoint: "guess", foreground: true },
          h.ctx,
        ),
      ).rejects.toThrow("ledger-owned");
    }
    expect(() => h.service.handle("questions.answer", { ...h.mutation(q), text: "Yes" }, h.ctx)).toThrow(
      "UI reply only",
    );
    const ordinary = await h.service.ask(h.ctx, { text: q.text, dedupKey: q.id });
    expect(ordinary.id).not.toBe(q.id);
    expect(ordinary.remote).toBeUndefined();
    expect(h.service.get(h.ctx, q.id).status).toBe("pending");
    expect(h.calls).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});

test("human reply uses pinned control and durable reply identity; acknowledged reply is not duplicated", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    let q = h.service.list(h.ctx)[0]!;
    q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "Yes" });
    const delivered = await h.bridge.dispatch(h.ctx, q.id);
    expect(h.calls[0]).toEqual({
      expected: { ownerId: "owner", epoch: "epoch" },
      request: {
        op: "answer",
        taskId: "t",
        id: h.native.id,
        owner: h.native.owner,
        version: 3,
        text: "Yes",
        replyId: q.replyId,
      },
    });
    expect(delivered.remote!.replyState).toBe("delivered");
    await h.bridge.dispatch(h.ctx, q.id);
    expect(h.calls).toHaveLength(1);
  } finally {
    h.cleanup();
  }
});

test("restart/offline uncertainty never creates another answer; authoritative receipt reconciles loss", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    let q = h.service.list(h.ctx)[0]!;
    q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "No" });
    h.lost();
    await expect(h.bridge.dispatch(h.ctx, q.id)).rejects.toThrow("uncertain");
    const fresh = new RemoteQuestionBridge(new QuestionService(), h.client);
    const result = await fresh.dispatch(h.ctx, q.id);
    expect(result.replyId).toBe(q.replyId);
    expect(result.remote!.replyState).toBe("delivered");
    expect(h.calls).toHaveLength(1);
  } finally {
    h.cleanup();
  }
});

test("unknown without receipt remains uncertain across restart and explicit resume", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    let q = h.service.list(h.ctx)[0]!;
    q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "Yes" });
    h.fail();
    await expect(h.bridge.dispatch(h.ctx, q.id)).rejects.toThrow("uncertain");
    const fresh = new RemoteQuestionBridge(new QuestionService(), h.client);
    await expect(fresh.dispatch(h.ctx, q.id)).rejects.toThrow("No duplicate answer");
    expect(h.calls).toHaveLength(1);
    expect(h.service.get(h.ctx, q.id).remote!.replyState).toBe("uncertain");
  } finally {
    h.cleanup();
  }
});

test("remote version changes invalidate stale modal and never retarget a saved human reply", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    const old = h.service.list(h.ctx)[0]!;
    h.native.version++;
    await h.bridge.sync(h.ctx);
    await expect(h.service.answer(h.ctx, { ...h.mutation(old), text: "Yes" })).rejects.toThrow("Stale");
    let q = h.service.get(h.ctx, old.id);
    q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "Yes" });
    h.native.version++;
    await expect(h.bridge.dispatch(h.ctx, q.id)).rejects.toThrow("not retargeted");
    expect(h.service.get(h.ctx, q.id).remote!.version).toBe(4);
    expect(h.calls).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});

test("changed owner epoch or parent attribution cannot send saved reply", async () => {
  for (const field of ["epoch", "host", "jobSessionFile"] as const) {
    const h = harness();
    try {
      await h.bridge.sync(h.ctx);
      let q = h.service.list(h.ctx)[0]!;
      q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "Yes" });
      h.state.tasks.t![field] = "other";
      await expect(h.bridge.dispatch(h.ctx, q.id)).rejects.toThrow("unavailable");
      expect(h.calls).toHaveLength(0);
    } finally {
      h.cleanup();
    }
  }
});

test("remote closure is authoritative, malformed questions and unrelated sessions do not mirror", async () => {
  const h = harness();
  try {
    h.state.tasks.t!.jobSessionFile = "other";
    await h.bridge.sync(h.ctx);
    expect(h.service.list(h.ctx)).toHaveLength(0);
    h.state.tasks.t!.jobSessionFile = h.ctx.sessionManager.getSessionFile();
    (h.state.tasks.t!.task!.questions as any[]).push({ text: "child clarification", status: "pending" });
    await h.bridge.sync(h.ctx);
    const q = h.service.list(h.ctx)[0]!;
    h.native.status = "cancelled";
    h.native.version++;
    await h.bridge.sync(h.ctx);
    expect(h.service.get(h.ctx, q.id).status).toBe("cancelled");
    expect(h.service.list(h.ctx)).toHaveLength(1);
  } finally {
    h.cleanup();
  }
});

test("sibling branch sees history only and cannot duplicate the mirror or answer", async () => {
  const h = harness();
  try {
    h.leaf("first");
    await h.bridge.sync(h.ctx);
    const q = h.service.list(h.ctx)[0]!;
    h.leaf("sibling");
    await h.bridge.sync(h.ctx);
    expect(h.service.list(h.ctx)).toHaveLength(0);
    await expect(h.service.answer(h.ctx, { ...h.mutation(q), text: "Yes" })).rejects.toThrow("owner branch");
    h.leaf("first");
    expect(h.service.list(h.ctx)).toHaveLength(1);
  } finally {
    h.cleanup();
  }
});

test("ordinary /questions command routes remote human answer without a parent answer turn", async () => {
  const h = harness();
  const handlers = new Map<string, any>(),
    sent: any[] = [];
  const runtime = registerQuestionRuntime(
    { on: (name: string, fn: any) => handlers.set(name, fn), sendMessage: (...args: any[]) => sent.push(args) } as any,
    { supported: () => true },
  );
  runtime.configureRemote(h.client);
  try {
    await handlers.get("session_start")({}, h.ctx);
    const commands = runtime.commands(h.ctx);
    const q = (await commands.handle("questions.list")) as Question[];
    const result = (await commands.handle("questions.answer", {
      id: q[0]!.id,
      answer: "Yes",
      owner: q[0]!.owner,
      version: q[0]!.version,
    })) as Question;
    expect(result.remote!.replyState).toBe("delivered");
    expect(h.calls).toHaveLength(1);
    await handlers.get("agent_settled")({}, h.ctx);
    expect(sent).toHaveLength(0);
    const replay = (await commands.handle("questions.resume", { id: result.id })) as Question;
    expect(replay.replyId).toBe(result.replyId);
    expect(h.calls).toHaveLength(1);
  } finally {
    handlers.get("session_shutdown")({}, h.ctx);
    h.cleanup();
  }
});

test("existing remote poll publishes into normal questions and stops after shutdown", async () => {
  const h = harness(),
    handlers = new Map<string, any>();
  const runtime = registerQuestionRuntime(
    { on: (n: string, fn: any) => handlers.set(n, fn), sendMessage() {} } as any,
    { supported: () => true },
  );
  runtime.configureRemote(h.client);
  try {
    h.state.tasks.t!.task!.questions = [];
    await handlers.get("session_start")({}, h.ctx);
    expect(runtime.service.list(h.ctx)).toHaveLength(0);
    h.state.tasks.t!.task!.questions = [h.native];
    await publishRemoteQuestionState(h.ctx, h.state);
    expect(runtime.service.list(h.ctx)).toHaveLength(1);
    await handlers.get("session_shutdown")({}, h.ctx);
    h.native.text = "changed after shutdown";
    h.native.version++;
    await publishRemoteQuestionState(h.ctx, h.state);
    expect(runtime.service.list(h.ctx)[0]!.text).toBe("Real human decision?");
  } finally {
    h.cleanup();
  }
});

test("explicit human retry keeps identical immutable reply identity and intent", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    let q = h.service.list(h.ctx)[0]!;
    q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "Yes" });
    h.fail();
    await expect(h.bridge.dispatch(h.ctx, q.id)).rejects.toThrow("uncertain");
    // No automatic retry; only the trusted /questions resume route can request this.
    await expect(h.bridge.dispatch(h.ctx, q.id, { retry: true })).rejects.toThrow("uncertain");
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual(h.calls[0]);
    expect(h.service.get(h.ctx, q.id).replyId).toBe(q.replyId);
  } finally {
    h.cleanup();
  }
});

test("concurrent reply dispatch claims human intent only once", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    let q = h.service.list(h.ctx)[0]!;
    q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "No" });
    const results = await Promise.allSettled([h.bridge.dispatch(h.ctx, q.id), h.bridge.dispatch(h.ctx, q.id)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(h.calls).toHaveLength(1);
  } finally {
    h.cleanup();
  }
});

test("a durable launch branch anchor cannot be stolen by a late sibling observation", async () => {
  const h = harness();
  try {
    (h.state.tasks.t as any).jobQuestionOwner = { sessionId: "parent", branchId: "first" };
    h.leaf("first");
    h.leaf("sibling");
    await h.bridge.sync(h.ctx);
    expect(h.service.list(h.ctx)).toHaveLength(0);
    h.leaf("first");
    await h.bridge.sync(h.ctx);
    expect(h.service.list(h.ctx)[0]!.owner.branchId).toBe("first");
  } finally {
    h.cleanup();
  }
});

test("pinned real client control reconciles explicit same-ID retry against owner receipt without duplicate dispatch", async () => {
  const h = harness();
  const file = h.ctx.sessionManager.getSessionFile() + ".remote.json";
  const hello = {
    protocol: 1,
    ownerId: "owner",
    epoch: "epoch",
    version: "1",
    platform: "linux",
    profile: { name: "normal", model: "example/model", auth: "configured" },
  };
  h.state.connection!.hello = hello as any;
  await Bun.write(file, JSON.stringify(h.state));
  const replies = new Map<string, any>(),
    attempts: any[] = [];
  let dispatches = 0;
  const client = new RemoteClient(file, async (host, _path, request) => {
    expect(host).toBe("pinned");
    if (request.op === "hello") return hello;
    expect(request.op).toBe("answer");
    attempts.push(request);
    const prior = replies.get(String(request.replyId));
    if (!prior) {
      replies.set(String(request.replyId), request);
      dispatches++;
      throw new Error("lost after owner accepted human reply");
    }
    expect(request).toEqual(prior);
    return { task: { taskId: "t", reply: { replyId: request.replyId, status: "delivered" } } };
  });
  const bridge = new RemoteQuestionBridge(h.service, client);
  try {
    await bridge.sync(h.ctx);
    let q = h.service.list(h.ctx)[0]!;
    q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "Yes" });
    await expect(bridge.dispatch(h.ctx, q.id)).rejects.toThrow("uncertain");
    const restarted = new RemoteQuestionBridge(new QuestionService(), new RemoteClient(file, client.transport));
    await expect(restarted.dispatch(h.ctx, q.id)).rejects.toThrow("No duplicate answer");
    const result = await restarted.dispatch(h.ctx, q.id, { retry: true });
    expect(result.remote!.replyState).toBe("delivered");
    expect(result.replyId).toBe(q.replyId);
    expect(attempts).toHaveLength(2);
    expect(dispatches).toBe(1);
    expect(attempts[0]).toMatchObject({ ownerId: "owner", epoch: "epoch", version: 3 });
  } finally {
    h.cleanup();
  }
});

test("remote extension polling feeds the owning normal questions runtime, not a second inbox", async () => {
  const h = harness(),
    handlers = new Map<string, Array<(...args: any[]) => any>>();
  const pi: any = {
    on: (name: string, fn: any) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    registerCommand() {},
    sendMessage() {},
  };
  const runtime = registerQuestionRuntime(pi, { supported: () => true });
  runtime.configureRemote(h.client);
  h.state.tasks.t!.task!.questions = [];
  const client: any = {
    ...h.client,
    status: h.client.read,
    syncActive: async () => {
      h.state.tasks.t!.task!.questions = [h.native];
    },
  };
  remoteExtension(pi, client);
  try {
    for (const fn of handlers.get("session_start")!) await fn({}, h.ctx);
    await Bun.sleep(10);
    expect(runtime.service.list(h.ctx)).toHaveLength(1);
    expect(runtime.service.list(h.ctx)[0]!.remote!.id).toBe(h.native.id);
    expect(h.calls).toHaveLength(0);
  } finally {
    for (const fn of handlers.get("session_shutdown")!) await fn({}, h.ctx);
    clearRemoteJobEvents(h.ctx.sessionManager.getSessionFile());
    h.cleanup();
  }
});

test("terminal task leaves native ledger status intact but makes its question history-only", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    const q = h.service.list(h.ctx)[0]!;
    h.state.tasks.t!.task!.state = "cancelled";
    await h.bridge.sync(h.ctx);
    const history = h.service.get(h.ctx, q.id);
    expect(history.status).toBe("pending");
    expect(history.readOnly).toBe(true);
    await expect(h.service.answer(h.ctx, { ...h.mutation(history), text: "Yes" })).rejects.toThrow("terminal");
    expect(h.calls).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});
