import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteClient, openRemoteLockDatabase, type RemoteState, type Transport } from "../src/remote/client";
import type { RemoteRequest } from "../src/remote/protocol";
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function fixture(transport: Transport) {
  const dir = await mkdtemp(join(tmpdir(), "remote-client-"));
  dirs.push(dir);
  return new RemoteClient(join(dir, "remote", "state.json"), transport);
}
const h = (epoch = "one") => ({
  protocol: 1,
  taskPlacement: 1,
  ownerId: "owner",
  epoch,
  version: "1",
  platform: "linux",
  profile: { name: "normal", model: "provider/model", auth: "configured" },
});
test("pins intent before first network POST; uncertain retry uses identical ID only", async () => {
  let fail = true;
  const posts: { request: Extract<RemoteRequest, { op: "launch" }>; saved: unknown }[] = [];
  const client = await fixture(async (_host, _path, r) => {
    if (r.op === "hello") return h();
    if (r.op !== "launch") throw Error("unexpected request: " + r.op);
    const request = r as Extract<RemoteRequest, { op: "launch" }>;
    const state: RemoteState = JSON.parse(await readFile(client.path, "utf8"));
    posts.push({ request, saved: state.tasks[request.taskId]! });
    if (fail) {
      fail = false;
      throw new Error("lost reply");
    }
    return { task: { taskId: r.taskId, state: "accepted" } };
  });
  await client.connect("configured-host");
  await expect(client.launch("/repo", "work", "id1")).rejects.toThrow("lost reply");
  const saved = await client.transcript("id1");
  expect(saved.outcome).toBe("unknown");
  expect(saved.ownerId).toBe("owner");
  expect(saved.repoPath).toBe("/repo");
  expect(posts[0]!.saved).toMatchObject({
    taskId: posts[0]!.request.taskId,
    ownerId: posts[0]!.request.ownerId,
    epoch: posts[0]!.request.epoch,
    repoPath: posts[0]!.request.repoPath,
    prompt: posts[0]!.request.prompt,
    outcome: "unknown",
  });
  await expect(client.launch("/other", "work", "id1")).rejects.toThrow("different owner or intent");
  expect((await client.launch("/repo", "work", "id1")).outcome).toBe("accepted");
  expect(posts.map(({ request }) => request.taskId)).toEqual(["id1", "id1"]);
  await client.launch("/repo", "work", "id1");
  expect(posts).toHaveLength(2);
  expect((await stat(client.path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(client.path, ".."))).mode & 0o777).toBe(0o700);
  expect(JSON.parse(await readFile(client.path, "utf8")).tasks.id1.prompt).toBe("work");
});
test("changed owner prevents retry and sync; cache remains available offline", async () => {
  let epoch = "one";
  let posts = 0;
  const c = await fixture(async (_host, _path, r) => {
    if (r.op === "hello") return h(epoch);
    if (r.op === "launch") {
      posts++;
      throw Error("timeout");
    }
    throw Error("offline");
  });
  await c.connect("myhost");
  await expect(c.launch("/repo", "p", "id1")).rejects.toThrow("timeout");
  epoch = "two";
  await expect(c.launch("/repo", "p", "id1")).rejects.toThrow("owner changed");
  await c.connect("myhost");
  await expect(c.launch("/repo", "p", "id1")).rejects.toThrow("different owner or intent");
  await expect(c.sync("id1")).rejects.toThrow("another remote owner");
  expect((await c.transcript("id1")).outcome).toBe("unknown");
  expect(posts).toBe(1);
});
test("paginated sync persists contiguous pages and does not clobber accepted task after offline", async () => {
  let offline = false;
  const cursors: number[] = [];
  const c = await fixture(async (_host, _path, r) => {
    if (r.op === "hello") {
      if (offline) throw Error("offline");
      return h();
    }
    if (r.op === "launch") return { task: { taskId: r.taskId, state: "accepted" } };
    cursors.push(r.cursor as number);
    if (r.cursor === 0)
      return {
        task: { taskId: r.taskId, state: "running" },
        events: [{ seq: 1, event: "first" }],
        cursor: 1,
        hasMore: true,
      };
    return {
      task: { taskId: r.taskId, state: "done" },
      events: [{ seq: 2, event: "done" }],
      cursor: 2,
      hasMore: false,
    };
  });
  await c.connect("box");
  await c.launch("/repo", "p", "id1");
  expect((await c.sync("id1")).events.map((e) => e.seq)).toEqual([1, 2]);
  expect(cursors).toEqual([0, 1]);
  offline = true;
  await expect(c.sync("id1")).rejects.toThrow("offline");
  expect((await c.transcript("id1")).task?.state).toBe("done");
});
test("rejects gaps without persisting bad transcript and never accepts hostile host", async () => {
  const c = await fixture(async (_host, _path, r) =>
    r.op === "hello"
      ? h()
      : r.op === "launch"
        ? { task: { taskId: r.taskId, state: "accepted" } }
        : {
            task: { taskId: r.taskId, state: "running" },
            events: [{ seq: 2, event: "gap" }],
            cursor: 2,
            hasMore: false,
          },
  );
  await expect(c.connect("-oProxyCommand=evil")).rejects.toThrow("Invalid SSH alias");
  await c.connect("box");
  await c.launch("/repo", "p", "id1");
  await expect(c.sync("id1")).rejects.toThrow("Noncontiguous");
  expect((await c.transcript("id1")).events).toEqual([]);
});

test("page acceptance resumes after rejection, preserving terminal truth and correlating reply receipts", async () => {
  const owner = { sessionId: "s", branchId: "b" };
  const question = { id: "q1", owner, version: 1, status: "pending" };
  let replyId = "";
  let invalidCursor = true;
  const cursors: number[] = [];
  const transport: Transport = async (_host, _path, r) => {
    if (r.op === "hello") return h();
    if (r.op === "launch") return { task: { taskId: r.taskId, state: "running", questions: [question] } };
    if (r.op === "answer") throw Error("lost answer acknowledgement");
    cursors.push(r.cursor as number);
    if (r.cursor === 0)
      return {
        task: {
          taskId: r.taskId,
          state: "done",
          result: "terminal",
          reply: { replyId: "unrelated", status: "delivered" },
        },
        events: [{ seq: 1, event: "first" }],
        cursor: 1,
        hasMore: true,
      };
    return {
      task: { taskId: r.taskId, state: "running", reply: { replyId, status: "delivered" } },
      events: [{ seq: 2, event: "second" }],
      cursor: invalidCursor ? 3 : 2,
      hasMore: false,
    };
  };
  const client = await fixture(transport);
  await client.connect("box");
  await client.launch("/repo", "work", "pages");
  await expect(client.answer("pages", { id: "q1", owner, version: 1, text: "yes" })).rejects.toThrow("uncertain");
  replyId = (await client.transcript("pages")).replies!.q1!.replyId;

  await expect(client.sync("pages")).rejects.toThrow("Invalid sync cursor");
  const partial = await client.transcript("pages");
  expect(partial.events).toEqual([{ seq: 1, event: "first" }]);
  expect(partial.cursor).toBe(1);
  expect(partial.transcriptComplete).toBe(false);
  expect(partial.task).toMatchObject({ state: "done", result: "terminal" });
  expect(partial.replyDelivery!.q1!.status).toBe("uncertain");

  invalidCursor = false;
  const resumed = await new RemoteClient(client.path, transport).sync("pages");
  expect(cursors).toEqual([0, 1, 1]);
  expect(resumed.events.map((e) => e.seq)).toEqual([1, 2]);
  expect(resumed.cursor).toBe(2);
  expect(resumed.transcriptComplete).toBe(true);
  expect(resumed.task).toMatchObject({ state: "done", result: "terminal" });
  expect(resumed.replyDelivery!.q1).toEqual({ replyId, status: "delivered" });
  expect(resumed.lastError).toBeUndefined();
});

test("sync releases the cache lock before servicing and returns persisted integration outcomes", async () => {
  let artifactError: string | undefined = "fixture artifact unavailable";
  const client = await fixture(async (_host, _path, r) => {
    if (r.op === "hello") return h();
    if (r.op === "launch") return { task: { taskId: r.taskId, state: "running" } };
    return { task: { taskId: r.taskId, state: "done", artifactError }, events: [], cursor: 0, hasMore: false };
  });
  await client.connect("box");
  await client.launch("/repo", "work", "servicing");
  const failedIntegration = await client.sync("servicing");
  expect(failedIntegration.task?.state).toBe("done");
  expect(failedIntegration.transcriptComplete).toBe(true);
  expect(failedIntegration.integrationError).toBe("Error: Offline text artifacts: Error: fixture artifact unavailable");
  expect((await client.transcript("servicing")).integrationError).toBe(failedIntegration.integrationError);

  artifactError = undefined;
  const recovered = await client.sync("servicing");
  expect(recovered.task?.state).toBe("done");
  expect(recovered.integrationError).toBeUndefined();
  expect((await client.transcript("servicing")).integrationError).toBeUndefined();
});

test("lost launch reply blocks automatic fresh-ID repeat of the same intent", async () => {
  let posts = 0;
  const c = await fixture(async (_h, _p, r) => {
    if (r.op === "hello") return h();
    posts++;
    throw Error("lost");
  });
  await c.connect("box");
  await expect(c.launch("/repo", "p")).rejects.toThrow("lost");
  await expect(c.launch("/repo", "p")).rejects.toThrow("identical launch has unknown outcome");
  expect(posts).toBe(1);
});
test("connection is model-neutral; missing destination default fails without copying a local model", async () => {
  const c = await fixture(async (_host, _path, request) => {
    if (request.op === "hello") return { ...h(), profile: { name: "normal", auth: "missing" } };
    if (!request.model) return { error: "Configure remote normal profile model", code: "missing_model" };
    return { task: { taskId: request.taskId, state: "accepted", profile: { name: "normal", model: request.model } } };
  });
  expect((await c.connect("box")).profile.model).toBe("");
  await expect(c.launch("/repo", "default work", "no_default")).rejects.toThrow(
    "Configure remote normal profile model",
  );
  expect((await c.launch("/repo", "override work", "override", { model: "supported/explicit" })).task).toMatchObject({
    profile: { name: "normal", model: "supported/explicit" },
  });
});
test("independent client instances serialize local state writes", async () => {
  const transport: Transport = async (_h, _p, r) =>
    r.op === "hello" ? h() : { task: { taskId: r.taskId, state: "accepted" } };
  const first = await fixture(transport),
    second = new RemoteClient(first.path, transport);
  await first.connect("box");
  await Promise.all([first.launch("/repo", "one", "one"), second.launch("/repo", "two", "two")]);
  expect(Object.keys((await first.status()).tasks).sort()).toEqual(["one", "two"]);
});

test("opening a second lock connection does not release the first SQLite lock", async () => {
  let probed = false;
  const c = await fixture(async () => {
    const second = openRemoteLockDatabase(c.path + ".lock.sqlite");
    second.close();
    const source = `
      import { Database } from "bun:sqlite";
      const db = new Database(${JSON.stringify(c.path + ".lock.sqlite")});
      db.exec("PRAGMA busy_timeout=0");
      try {
        db.exec("BEGIN EXCLUSIVE");
        console.log("acquired");
        db.exec("COMMIT");
      } catch (error) {
        console.log(error.code);
      } finally {
        db.close();
      }
    `;
    const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
    try {
      const exit = await child.exited;
      const output = await new Response(child.stdout as ReadableStream).text();
      const error = await new Response(child.stderr as ReadableStream).text();
      expect(exit).toBe(0);
      expect(error).toBe("");
      expect(output.trim()).toBe("SQLITE_BUSY");
      probed = true;
    } finally {
      child.kill();
      await child.exited;
    }
    return h();
  });
  await c.connect("box");
  expect(probed).toBe(true);
  expect((await c.status()).connection?.host).toBe("box");
  expect((await stat(c.path + ".lock.sqlite")).mode & 0o777).toBe(0o600);
});

test("killed client releases state lock and reopens the same durable ambiguous ID", async () => {
  const c = await fixture(async (_h, _p, r) =>
    r.op === "hello" ? h() : { task: { taskId: r.taskId, state: "accepted" } },
  );
  await c.connect("box");
  const marker = c.path + ".sent";
  const source = `
    import { RemoteClient } from ${JSON.stringify(new URL("../src/remote/client.ts", import.meta.url).pathname)};
    const client = new RemoteClient(${JSON.stringify(c.path)}, async (_host, _path, request) => {
      if (request.op === "hello") return ${JSON.stringify(h())};
      await Bun.write(${JSON.stringify(marker)}, "sent");
      await Bun.sleep(60000);
    });
    await client.launch("/repo", "work", "crash-id");
  `;
  const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "ignore", stderr: "pipe" });
  try {
    const until = Date.now() + 5000;
    while (!(await Bun.file(marker).exists()) && Date.now() < until) await Bun.sleep(10);
    expect(await Bun.file(marker).exists()).toBe(true);
    expect((await c.transcript("crash-id")).outcome).toBe("unknown");
    child.kill("SIGKILL");
    await child.exited;
    expect((await c.transcript("crash-id")).outcome).toBe("unknown");
    expect((await c.launch("/repo", "work", "crash-id")).outcome).toBe("accepted");
    expect(Object.keys((await c.status()).tasks)).toEqual(["crash-id"]);
  } finally {
    child.kill();
    await child.exited;
  }
});

test("unknown task snapshot carries its error and native questions rather than losing status", async () => {
  const c = await fixture(async (_h, _p, r) =>
    r.op === "hello"
      ? h()
      : r.op === "launch"
        ? { task: { taskId: r.taskId, state: "running" } }
        : {
            task: {
              taskId: r.taskId,
              state: "unknown",
              error: "Native question unresolved",
              questions: [{ text: "Answer needed" }],
            },
            events: [],
            cursor: 0,
            hasMore: false,
          },
  );
  await c.connect("box");
  await c.launch("/repo", "p", "id1");
  expect((await c.sync("id1")).task).toMatchObject({
    state: "unknown",
    error: "Native question unresolved",
    questions: [{ text: "Answer needed" }],
  });
  expect((await c.transcript("id1")).task?.state).toBe("unknown");
});

test("targeted answer pins reply ID before transport, rejects changed intent, bounded reconnect sync", async () => {
  const answerPosts: {
    request: Extract<RemoteRequest, { op: "answer" }>;
    saved: unknown;
  }[] = [];
  const syncedTasks: string[] = [];
  let fail = true;
  const owner = { sessionId: "s", branchId: "b" };
  const q = { id: "q1", owner, version: 2, status: "pending" };
  const c = await fixture(async (_host, _path, r) => {
    if (r.op === "hello") return h();
    if (r.op === "launch") return { task: { taskId: r.taskId, state: "running", questions: [q] } };
    if (r.op === "answer") {
      const request = r as Extract<RemoteRequest, { op: "answer" }>;
      const state: RemoteState = JSON.parse(await readFile(c.path, "utf8"));
      answerPosts.push({ request, saved: state.tasks[request.taskId]?.replies?.[request.id] });
      if (fail) {
        fail = false;
        throw Error("lost acknowledgement");
      }
      return { task: { taskId: r.taskId, state: "running" } };
    }
    if (r.op === "sync") {
      const request = r as Extract<RemoteRequest, { op: "sync" }>;
      syncedTasks.push(request.taskId);
      return { task: { taskId: r.taskId, state: "done" }, events: [], cursor: 0, hasMore: false };
    }
    throw Error("invalid request");
  });
  await c.connect("myhost");
  await c.launch("/repo", "prompt", "one");
  await c.launch("/repo", "another", "two");
  await expect(c.answer("one", { id: "q1", owner, version: 1, text: "yes" })).rejects.toThrow("stale");
  await expect(c.answer("one", { id: "q1", owner, version: 2, text: "yes" })).rejects.toThrow("uncertain");
  const replyId = (await c.transcript("one")).replies!.q1!.replyId;
  expect(answerPosts[0]!.saved).toEqual({ id: "q1", owner, version: 2, text: "yes", replyId });
  expect(answerPosts[0]!.request.replyId).toBe(replyId);
  await expect(c.answer("one", { id: "q1", owner, version: 2, text: "no" })).rejects.toThrow("Conflicting");
  await c.answer("one", { id: "q1", owner, version: 2, text: "yes" });
  expect(answerPosts.map(({ request }) => request.replyId)).toEqual([replyId, replyId]);
  await c.syncActive(1);
  expect(syncedTasks).toEqual(["one"]);
  expect((await c.transcript("one")).task?.state).toBe("done");
});

test("restart automatically finishes a partially cached terminal transcript", async () => {
  let offline = false;
  const transport: Transport = async (_host, _path, r) => {
    if (r.op === "hello") return h();
    if (r.op === "launch") return { task: { taskId: r.taskId, state: "accepted" } };
    if (r.cursor === 0)
      return {
        task: { taskId: r.taskId, state: "done" },
        events: [{ seq: 1, event: { type: "message_end", text: "first" } }],
        cursor: 1,
        hasMore: true,
      };
    if (offline) throw Error("link lost after first terminal page");
    return {
      task: { taskId: r.taskId, state: "done" },
      events: [{ seq: 2, event: { type: "message_end", text: "final" } }],
      cursor: 2,
      hasMore: false,
    };
  };
  const client = await fixture(transport);
  await client.connect("fixture");
  await client.launch("/repo", "work", "partial");
  offline = true;
  await expect(client.sync("partial")).rejects.toThrow("link lost");
  expect((await client.transcript("partial")).transcriptComplete).toBe(false);
  offline = false;
  const resumed = new RemoteClient(client.path, transport);
  await resumed.syncActive();
  expect((await resumed.transcript("partial")).events).toHaveLength(2);
  expect((await resumed.transcript("partial")).transcriptComplete).toBe(true);
});

test("existing task catch-up is independent of a subsequently removed default profile", async () => {
  let removed = false;
  const client = await fixture(async (_host, _path, r) => {
    if (r.op === "hello") return removed ? { ...h(), profile: { name: "normal", auth: "missing" } } : h();
    if (r.op === "launch") return { task: { taskId: r.taskId, state: "accepted" } };
    return { task: { taskId: r.taskId, state: "done" }, events: [], cursor: 0, hasMore: false };
  });
  await client.connect("fixture");
  await client.launch("/repo", "work", "configured_once");
  removed = true;
  expect((await client.sync("configured_once")).task?.state).toBe("done");
});

for (const failure of ["changed-connection", "offline-hello", "lost-cancel"] as const) {
  test("cancel retains local intent and pinned retry after " + failure, async () => {
    let broken = false;
    const sent: string[] = [];
    const c = await fixture(async (host, _path, r) => {
      if (r.op === "hello") {
        if (broken && failure === "offline-hello") throw Error("offline");
        return h();
      }
      if (r.op === "launch") return { task: { taskId: r.taskId, state: "running" } };
      if (r.op === "cancel") {
        sent.push(host);
        if (broken && failure === "lost-cancel") throw Error("lost response");
        return { task: { taskId: r.taskId, state: "running" } };
      }
      return { task: { taskId: r.taskId, state: "running" }, events: [], cursor: 0, hasMore: false };
    });
    await c.connect("box");
    await c.launch("/repo", "work", "id");
    broken = true;
    if (failure === "changed-connection") await c.connect("other-box");
    await expect(c.cancel("id")).rejects.toThrow(failure === "lost-cancel" ? "uncertain" : "no cancel sent");
    const saved = await c.transcript("id");
    expect(saved.cancelRequested).toBe(true);
    expect(saved.cancelDelivery?.status).toBe(failure === "lost-cancel" ? "uncertain" : "requested");
    expect(saved.task?.state).toBe("running");
    expect(sent).toEqual(failure === "lost-cancel" ? ["box"] : []);
    broken = false;
    if (failure === "changed-connection") await c.connect("box");
    expect((await c.cancel("id")).cancelDelivery?.status).toBe("confirmed");
    expect(sent).toEqual(failure === "lost-cancel" ? ["box", "box"] : ["box"]);
    expect((await c.transcript("id")).task?.state).toBe("running"); // ACK is not terminal truth.
  });
}

test("uncertain cancel stays uncertain across changed owner and only terminal sync proves cancellation", async () => {
  let epoch = "one",
    fail = true,
    terminal = false,
    posts = 0;
  const c = await fixture(async (_host, _path, r) => {
    if (r.op === "hello") return h(epoch);
    if (r.op === "launch") return { task: { taskId: r.taskId, state: "running" } };
    if (r.op === "cancel") {
      posts++;
      if (fail) throw Error("lost response");
      return { task: { taskId: r.taskId, state: "running" } };
    }
    return {
      task: { taskId: r.taskId, state: terminal ? "cancelled" : "running" },
      events: [],
      cursor: 0,
      hasMore: false,
    };
  });
  await c.connect("box");
  await c.launch("/repo", "work", "id");
  await expect(c.cancel("id")).rejects.toThrow("uncertain");
  epoch = "two";
  await expect(c.cancel("id")).rejects.toThrow("no cancel sent");
  expect((await c.transcript("id")).cancelDelivery?.status).toBe("uncertain");
  expect(posts).toBe(1);
  epoch = "one";
  fail = false;
  expect((await c.cancel("id")).task?.state).toBe("running");
  terminal = true;
  expect((await c.sync("id")).task?.state).toBe("cancelled");
  await c.cancel("id");
  expect(posts).toBe(2); // Confirmed request is not resent; terminal observation is retained.
});

test("new lock database is private before transport runs and stays private on reuse", async () => {
  let calls = 0;
  const c = await fixture(async () => {
    calls++;
    expect((await stat(c.path + ".lock.sqlite")).mode & 0o777).toBe(0o600);
    return h();
  });
  await c.connect("box");
  await c.connect("box");
  expect(calls).toBe(2);
});

test("placement role/depth/workspace is durable before POST and cannot change on uncertain retry", async () => {
  const requests: any[] = [];
  let lost = true;
  const client = await fixture(async (_host, _path, request) => {
    if (request.op === "hello") return h();
    requests.push(request);
    const saved = JSON.parse(await readFile(client.path, "utf8"));
    expect(saved.tasks.placed.placement).toEqual(request.placement);
    if (lost) throw Error("lost response");
    return {
      task: {
        taskId: request.taskId,
        state: "accepted",
        profile: { name: "orchestrator" },
        placement: request.placement,
      },
    };
  });
  await client.connect("configured-host");
  const placement = {
    profile: "orchestrator" as const,
    parentDepth: 0,
    workspace: { kind: "worktree" as const, branch: "task/one" },
  };
  await expect(client.launch("/repo", "placed work", "placed", undefined, "/parent", placement)).rejects.toThrow(
    "lost response",
  );
  await expect(
    client.launch("/repo", "placed work", "placed", undefined, "/parent", { ...placement, profile: "normal" }),
  ).rejects.toThrow("different owner or intent");
  await expect(client.launch("/repo", "placed work", undefined, undefined, "/parent", placement)).rejects.toThrow(
    "unknown outcome",
  );
  lost = false;
  await client.launch("/repo", "placed work", "placed", undefined, "/parent", placement);
  expect(requests.map((r) => r.taskId)).toEqual(["placed", "placed"]);
  expect(requests[0].placement).toEqual(requests[1].placement);
  await expect(
    client.launch("/repo", "new", "forbidden", undefined, "/parent", {
      ...placement,
      parentDepth: 1,
      parentType: "normal",
    }),
  ).rejects.toThrow("orchestrator");
  expect(requests).toHaveLength(2);
});

test("older destinations cannot silently downgrade a placed task to legacy normal", async () => {
  let posts = 0;
  const client = await fixture(async (_host, _path, request) => {
    if (request.op === "hello") return { ...h(), taskPlacement: undefined };
    posts++;
    return { task: { taskId: request.taskId, state: "accepted" } };
  });
  await client.connect("box");
  await expect(
    client.launch("/repo", "work", "placed", undefined, "/parent", {
      profile: "orchestrator",
      parentDepth: 0,
      workspace: { kind: "inherit" },
    }),
  ).rejects.toThrow("does not support task placement");
  expect(posts).toBe(0);
});

test("a destination role mismatch is uncertain, not silently accepted", async () => {
  const client = await fixture(async (_host, _path, request) =>
    request.op === "hello"
      ? h()
      : {
          task: {
            taskId: request.taskId,
            state: "accepted",
            profile: { name: "normal" },
            placement: request.placement,
          },
        },
  );
  await client.connect("box");
  await expect(
    client.launch("/repo", "work", "placed", undefined, "/parent", {
      profile: "fast",
      parentDepth: 0,
      workspace: { kind: "inherit" },
    }),
  ).rejects.toThrow("different task role or placement");
  expect((await client.transcript("placed")).outcome).toBe("unknown");
});
