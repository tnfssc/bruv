import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerQuestionRuntime } from "../../src/questions/runtime";
import { type Question, QuestionService } from "../../src/questions/service";
import { RemoteClient, type RemoteState } from "../../src/remote/client";
import remoteExtension from "../../src/remote/extension";
import { clearRemoteJobEvents } from "../../src/remote/job-events";
import { publishRemoteQuestionState, RemoteQuestionBridge } from "../../src/remote/question-bridge";

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

// The questions runtime and remote extension share one host session. Keep every
// hook and await them in registration order, as the extension runner does.
function questionSession(h: ReturnType<typeof harness>) {
  const handlers = new Map<string, Array<(event: {}, ctx: any) => unknown>>();
  const sent: any[] = [];
  const pi: any = {
    on(name: string, handler: (event: {}, ctx: any) => unknown) {
      const existing = handlers.get(name) ?? [];
      existing.push(handler);
      handlers.set(name, existing);
    },
    registerCommand() {},
    sendMessage: (...args: any[]) => sent.push(args),
  };
  const runtime = registerQuestionRuntime(pi, { supported: () => true });
  runtime.configureRemote(h.client);
  const emit = async (name: string) => {
    for (const handler of handlers.get(name) ?? []) await handler({}, h.ctx);
  };
  return {
    pi,
    runtime,
    sent,
    start: () => emit("session_start"),
    settle: () => emit("agent_settled"),
    shutdown: async () => {
      try {
        await emit("session_shutdown");
      } finally {
        clearRemoteJobEvents(h.ctx.sessionManager.getSessionFile());
      }
    },
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

test("pending snapshots reconcile durably without recreating or renotifying a mirror", async () => {
  const h = harness();
  try {
    const asked: Question[] = [];
    h.service.onAsked = (q) => {
      expect(h.service.get(h.ctx, q.id).version).toBe(q.version);
      asked.push(q);
    };
    h.native.text = "  Initial decision  ";
    await h.bridge.sync(h.ctx);
    const initial = h.service.list(h.ctx)[0]!;
    expect(initial.text).toBe("Initial decision");
    expect(initial.version).toBe(1);
    expect(initial.choices).toEqual(["Yes", "No"]);
    await h.bridge.sync(h.ctx);
    expect(h.service.get(h.ctx, initial.id)).toEqual(initial);

    Object.assign(h.native, {
      version: 4,
      text: "  Revised decision  ",
      choices: ["Later"],
      allowFreeText: true,
      reason: "More context",
    });
    await h.bridge.sync(h.ctx);
    const revised = h.service.get(h.ctx, initial.id);
    expect(revised).toMatchObject({
      id: initial.id,
      version: 2,
      text: "Revised decision",
      choices: ["Later"],
      allowFreeText: true,
      reason: "More context",
      remote: { version: 4, observedVersion: 4, observedStatus: "pending" },
    });
    await h.bridge.sync(h.ctx);
    expect(new QuestionService().get(h.ctx, initial.id)).toEqual(revised);
    expect(asked).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});

test("saved reply freezes question details while observations, receipts and closure reconcile", async () => {
  const h = harness();
  try {
    await h.bridge.sync(h.ctx);
    let q = h.service.list(h.ctx)[0]!;
    q = await h.service.answer(h.ctx, { ...h.mutation(q), text: "Yes", replyId: "human-reply" });
    q = await h.service.claimRemoteReply(h.ctx, h.mutation(q));
    q = await h.service.finishRemoteReply(h.ctx, {
      ...h.mutation(q),
      replyId: q.replyId!,
      delivered: false,
      error: "response lost",
    });
    Object.assign(h.native, {
      version: 4,
      text: "Different question",
      choices: ["Different"],
      allowFreeText: true,
      reason: "Changed remotely",
      replyId: "another-reply",
      delivery: "delivered",
    });
    await h.bridge.sync(h.ctx);
    const observed = h.service.get(h.ctx, q.id);
    expect(observed).toMatchObject({
      status: "answered",
      text: q.text,
      choices: q.choices,
      allowFreeText: false,
      answer: "Yes",
      replyId: "human-reply",
      replyVersion: q.replyVersion,
      delivery: "dispatching",
      remote: { version: 3, observedVersion: 4, replyState: "uncertain", error: "response lost" },
    });
    expect(observed.reason).toBeUndefined();
    expect(observed.version).toBe(q.version + 1);
    await h.bridge.sync(h.ctx);
    expect(h.service.get(h.ctx, q.id)).toEqual(observed);

    // A matching delivery receipt takes precedence over a closed snapshot.
    Object.assign(h.native, { status: "resolved", replyId: "human-reply" });
    await h.bridge.sync(h.ctx);
    const delivered = h.service.get(h.ctx, q.id);
    expect(delivered.status).toBe("answered");
    expect(delivered.delivery).toBe("delivered");
    expect(delivered.remote).toMatchObject({ version: 3, observedStatus: "resolved", replyState: "delivered" });
    expect(delivered.remote!.error).toBeUndefined();

    Object.assign(h.native, { replyId: "another-reply" });
    await h.bridge.sync(h.ctx);
    const closed = new QuestionService().get(h.ctx, q.id);
    expect(closed.status).toBe("resolved");
    expect(closed.answer).toBe("Yes");
    expect(closed.remote!.version).toBe(3);
    expect(closed.delivery).toBe("delivered");
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
      ).rejects.toThrow("The remote ledger owns this human question");
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
  const session = questionSession(h);
  try {
    await session.start();
    const commands = session.runtime.commands(h.ctx);
    const q = (await commands.handle("questions.list")) as Question[];
    const result = (await commands.handle("questions.answer", {
      id: q[0]!.id,
      answer: "Yes",
      owner: q[0]!.owner,
      version: q[0]!.version,
    })) as Question;
    expect(result.remote!.replyState).toBe("delivered");
    expect(h.calls).toHaveLength(1);
    await session.settle();
    expect(session.sent).toHaveLength(0);
    const replay = (await commands.handle("questions.resume", { id: result.id })) as Question;
    expect(replay.replyId).toBe(result.replyId);
    expect(h.calls).toHaveLength(1);
  } finally {
    await session.shutdown();
    h.cleanup();
  }
});

test("existing remote poll publishes into normal questions and stops after shutdown", async () => {
  const h = harness();
  const session = questionSession(h);
  try {
    h.state.tasks.t!.task!.questions = [];
    await session.start();
    expect(session.runtime.service.list(h.ctx)).toHaveLength(0);
    h.state.tasks.t!.task!.questions = [h.native];
    await publishRemoteQuestionState(h.ctx, h.state);
    expect(session.runtime.service.list(h.ctx)).toHaveLength(1);
    await session.shutdown();
    h.native.text = "changed after shutdown";
    h.native.version++;
    await publishRemoteQuestionState(h.ctx, h.state);
    expect(session.runtime.service.list(h.ctx)[0]!.text).toBe("Real human decision?");
  } finally {
    await session.shutdown();
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
  const h = harness();
  const session = questionSession(h);
  const releasePoll = Promise.withResolvers<void>();
  h.state.tasks.t!.task!.questions = [];
  const client: any = {
    ...h.client,
    status: h.client.read,
    syncActive: async () => {
      await releasePoll.promise;
      h.state.tasks.t!.task!.questions = [h.native];
    },
  };
  remoteExtension(session.pi, client);
  try {
    await session.start();
    expect(session.runtime.service.list(h.ctx)).toHaveLength(0);
    const published = Promise.withResolvers<void>();
    const unsubscribe = session.runtime.commands(h.ctx).subscribe(() => published.resolve());
    try {
      releasePoll.resolve();
      await published.promise;
      expect(session.runtime.service.list(h.ctx)).toHaveLength(1);
      expect(session.runtime.service.list(h.ctx)[0]!.remote!.id).toBe(h.native.id);
      expect(h.calls).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  } finally {
    // Shutdown invalidates the extension's in-flight refresh before releasing
    // a held poll on an assertion failure; it cannot publish into a dead session.
    await session.shutdown();
    releasePoll.resolve();
    h.cleanup();
  }
});

test("remote extension discards a poll that finishes after its owning session shuts down", async () => {
  const h = harness();
  const session = questionSession(h);
  const pollStarted = Promise.withResolvers<void>();
  const pollFinished = Promise.withResolvers<void>();
  let statusReads = 0;
  h.state.tasks.t!.task!.questions = [];
  const client: any = {
    ...h.client,
    syncActive: () => {
      pollStarted.resolve();
      return pollFinished.promise;
    },
    status: async () => {
      statusReads++;
      return h.client.read();
    },
  };
  remoteExtension(session.pi, client);
  try {
    await session.start();
    await pollStarted.promise;
    await session.shutdown();
    h.state.tasks.t!.task!.questions = [h.native];
    pollFinished.resolve();
    // refresh() is already awaiting this promise: its generation check runs
    // before this continuation, without a timer or a second publication path.
    await pollFinished.promise;
    expect(statusReads).toBe(1); // Startup baseline only; no post-poll cache read.
    expect(session.runtime.service.list(h.ctx)).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  } finally {
    await session.shutdown();
    pollFinished.resolve();
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
