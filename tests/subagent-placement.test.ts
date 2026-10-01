import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as agentSession from "../src/tasks/agent-session";
import { withJobRequestIdentity } from "../src/job-delivery";
import { RemoteClient } from "../src/remote/client";
import { createRemoteJobsAdapter, type SshLaunchRequest, type SshLaunchResult } from "../src/remote/jobs";
import { JobService } from "../src/tasks/job-service";
import { TaskManager } from "../src/tasks/task-manager";
import type { T3TaskAdapter } from "../src/t3/tasks/native-task";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function identity(invocation = "execute-1", callIndex = 1) {
  return withJobRequestIdentity(new AbortController().signal, { executeInvocationId: invocation, callIndex });
}
async function fixture(host = "box") {
  const dir = await mkdtemp(join(tmpdir(), "placement-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  let offline = false;
  let posts = 0;
  const cancelled = new Set<string>();
  const client = new RemoteClient(join(dir, "state.json"), async (_host, _die, req) => {
    if (offline) throw Error("offline");
    if (req.op === "hello")
      return {
        protocol: 1,
        ownerId: "owner",
        epoch: "epoch",
        version: "1",
        platform: "linux",
        profile: { name: "normal", model: "server/model", auth: "configured" },
      };
    if (req.op === "launch") {
      posts++;
      return { task: { taskId: req.taskId, state: "accepted" } };
    }
    if (req.op === "sync")
      return {
        task: { taskId: req.taskId, state: cancelled.has(String(req.taskId)) ? "cancelled" : "running" },
        events: [],
        cursor: req.cursor,
        hasMore: false,
      };
    if (req.op === "cancel") {
      cancelled.add(String(req.taskId));
      return { task: { taskId: req.taskId, state: "cancelled" } };
    }
    throw Error("unexpected transport");
  });
  await client.connect(host);
  const requests: Array<Omit<SshLaunchRequest, "target">> = [];
  const intents = new Map<string, string>();
  const adapter = createRemoteJobsAdapter(client, async (client, args) => {
    requests.push(args);
    const intent = JSON.stringify(args);
    const old = intents.get(args.taskId);
    if (old && old !== intent) throw Error("Repository launch retry intent conflict");
    intents.set(args.taskId, intent);
    // Fake repository backend: only this isolated fixture uses the legacy launch
    // to populate the durable client state. Production calls launchRepository.
    const task = await client.launch(
      "/snapshot",
      args.prompt,
      args.taskId,
      { model: args.model, thinking: args.thinking },
      args.jobSessionFile,
    );
    await client.updateTask(task.taskId, { repository: { snapshot: "snapshot-sha", history: "snapshot-only" } });
    return client.transcript(task.taskId);
  });
  const manager = new TaskManager(() => {});
  cleanup.push(() => manager.shutdown());
  const service = (
    policy = { depth: 0, type: undefined as string | undefined },
    environment = {},
    native?: T3TaskAdapter,
  ) =>
    new JobService(
      manager,
      () => policy,
      undefined,
      join(dir, "missing-profiles.json"),
      undefined,
      undefined,
      environment,
      native ? () => native : undefined,
      undefined,
      adapter,
    );
  const context = (session = "parent-A") =>
    ({
      cwd: dir,
      thinkingLevel: "high",
      model: { provider: "laptop", id: "must-not-forward" },
      sessionManager: {
        getSessionFile: () => join(dir, session + ".jsonl"),
        getSessionId: () => session,
        getSessionDir: () => dir,
      },
    }) as any;
  return {
    dir,
    client,
    adapter,
    manager,
    service,
    context,
    requests,
    posts: () => posts,
    offline: (value: boolean) => {
      offline = value;
    },
  };
}

test("SSH uses normal async launch with destination profile and honest snapshot workspace, no laptop model", async () => {
  const f = await fixture();
  for (const type of ["fast", "normal", "orchestrator"] as const) {
    const result = (await f.service().handle(
      "subagent",
      {
        target: "box",
        type,
        prompt: "work",
        workspace: { kind: "worktree", baseRef: "v1", branch: "feature" },
      },
      f.context(),
      identity(type),
    )) as SshLaunchResult;
    expect(result).toMatchObject({
      kind: "ssh",
      target: "box",
      background: true,
      output: "",
      status: "running",
      workspace: {
        kind: "worktree",
        path: "/snapshot",
        source: "snapshot",
        history: "snapshot-only",
        requestedBaseRef: "v1",
        requestedBranch: "feature",
      },
      provenance: { snapshot: "snapshot-sha" },
    });
    expect(f.requests.at(-1)).toMatchObject({
      placement: { profile: type, parentDepth: 0, workspace: { kind: "worktree", baseRef: "v1", branch: "feature" } },
    });
    expect(f.requests.at(-1)?.model).toBeUndefined();
    expect(f.requests.at(-1)?.thinking).toBeUndefined();
    expect(f.requests.at(-1)).not.toHaveProperty("approvedUntracked");
  }
});

test("role/depth is validated before placement and SSH never permits child orchestrator escalation", async () => {
  const f = await fixture();
  for (const [policy, type, message] of [
    [{ depth: 2, type: "orchestrator" }, "normal", "two levels"],
    [{ depth: 1, type: "normal" }, "normal", "Only orchestrator"],
    [{ depth: 1, type: "orchestrator" }, "orchestrator", "fast/normal"],
  ] as const)
    await expect(
      f.service(policy).handle("subagent", { target: "arbitrary", prompt: "work", type }, f.context(), identity()),
    ).rejects.toThrow(message);
  expect(f.requests).toHaveLength(0);
  await f
    .service({ depth: 1, type: "orchestrator" })
    .handle("subagent", { target: "box", prompt: "work", type: "fast" }, f.context(), identity());
  expect(f.requests[0]?.placement).toMatchObject({ parentDepth: 1, parentType: "orchestrator", profile: "fast" });
});

test("SSH requires human-pinned exact target, durable request/session, async options and human untracked approval", async () => {
  const f = await fixture();
  for (const options of [
    { target: "other" },
    { target: "user@arbitrary" },
    { target: "box", waitSeconds: 1 },
    { target: "box", timeoutSeconds: 3 },
    { target: "box", approvedUntracked: ["secret"] },
  ])
    await expect(
      f.service().handle("subagent", { prompt: "work", ...options }, f.context(), identity()),
    ).rejects.toThrow();
  await expect(
    f.service().handle("subagent", { target: "box", prompt: "work" }, f.context(), new AbortController().signal),
  ).rejects.toThrow("durable execute");
  await expect(
    f
      .service()
      .handle(
        "subagent",
        { target: "box", prompt: "work" },
        { cwd: f.dir, sessionManager: { getSessionFile: () => undefined } } as any,
        identity(),
      ),
  ).rejects.toThrow("durable parent");
  expect(f.requests).toHaveLength(0);
});

test("unknown launches retain a durable task ID; retries and batches never duplicate; other sessions cannot steal", async () => {
  const f = await fixture();
  f.offline(true);
  const args = { target: "box", prompts: ["one", "two"], workspace: { kind: "inherit" } };
  const first = (await f.service().handle("subagent", args, f.context(), identity())) as SshLaunchResult[];
  expect(first).toHaveLength(2);
  expect(new Set(first.map((x) => x.id)).size).toBe(2);
  for (const result of first) expect(result).toMatchObject({ status: "unknown", outcome: "unknown", background: true });
  expect(f.posts()).toBe(0);
  f.offline(false);
  const retry = (await f.service().handle("subagent", args, f.context(), identity())) as SshLaunchResult[];
  const again = (await f.service().handle("subagent", args, f.context(), identity())) as SshLaunchResult[];
  expect(retry.map((x) => x.id)).toEqual(first.map((x) => x.id));
  expect(again.map((x) => x.id)).toEqual(first.map((x) => x.id));
  expect(f.posts()).toBe(2);
  expect(await f.adapter.list(f.context("parent-B").sessionManager.getSessionFile())).toEqual([]);
  await expect(f.adapter.launch({ ...f.requests[0]!, target: "box", jobSessionFile: "other" })).rejects.toThrow(
    "ownership conflict",
  );
  const separate = (await f.service().handle("subagent", args, f.context("parent-B"), identity())) as SshLaunchResult[];
  expect(separate[0]?.id).not.toBe(first[0]?.id);
  const stop = (await f.service().handle("jobs.stop", { id: first[0]!.id }, f.context(), identity())) as any;
  expect(stop.cancellationRequested).toBe(true);
  expect(stop.status).toBe("cancelled");
});

test("changed retry intent is rejected even while the earlier outcome is unknown", async () => {
  const f = await fixture();
  f.offline(true);
  const service = f.service();
  await service.handle("subagent", { target: "box", prompt: "one" }, f.context(), identity());
  await expect(service.handle("subagent", { target: "box", prompt: "two" }, f.context(), identity())).rejects.toThrow(
    "intent conflict",
  );
  expect(f.posts()).toBe(0);
});

test("reserved SSH host local has one authorized alias; literal local never selects SSH", async () => {
  const f = await fixture("local");
  const result = (await f
    .service()
    .handle("subagent", { target: "ssh:local", prompt: "work" }, f.context(), identity())) as SshLaunchResult;
  expect(result.target).toBe("ssh:local");
  expect(result.host).toBe("local");
});

test("scoped native keeps backend policy for omitted/local target and rejects cross-placement without escaping", async () => {
  const f = await fixture();
  let calls = 0;
  const native = {
    launch: async () => {
      calls++;
      return {
        version: 1,
        taskId: "native-child",
        childThreadId: "child",
        profile: "fast",
        depth: 2,
        status: "running",
      };
    },
    close: async () => {},
  } as unknown as T3TaskAdapter;
  const environment = { T3_MCP_URL: "http://backend.invalid/mcp", T3_MCP_BEARER_TOKEN: "fixture" };
  const service = f.service({ depth: 99, type: "normal" }, environment, native);
  for (const target of [undefined, "local"]) {
    const result = (await service.handle(
      "subagent",
      { prompt: "work", ...(target ? { target } : {}) },
      f.context(),
      identity("native-" + target),
    )) as any;
    expect(result.id).toBe("native-child");
  }
  await expect(service.handle("subagent", { prompt: "work", target: "box" }, f.context(), identity())).rejects.toThrow(
    "cross-placement",
  );
  expect(calls).toBe(2);
  expect(f.requests).toHaveLength(0);
});

test("omitted and explicit local target preserve local launch/wait/model, even with a pinned SSH host", async () => {
  const f = await fixture("local");
  const prepared = spyOn(agentSession, "prepareAgentSession").mockImplementation(async (_cwd, _dir, info) => ({
    id: "local-child",
    agent: { ...info, sessionFile: join(f.dir, "child.jsonl") },
  }));
  const launches: any[] = [];
  const waits: number[] = [];
  const task = {
    id: "local-child",
    kind: "agent",
    command: "work",
    status: "running",
    startedAt: new Date().toISOString(),
    output: "",
    background: true,
  } as any;
  const spawn = spyOn(f.manager, "spawn").mockImplementation((args) => {
    launches.push(args);
    return task;
  });
  const foreground = spyOn(f.manager, "foreground").mockImplementation(async (_id, waitMs) => {
    waits.push(waitMs!);
    return task;
  });
  try {
    for (const target of [undefined, "local"]) {
      const result = (await f
        .service()
        .handle(
          "subagent",
          { prompt: "work", ...(target ? { target } : {}) },
          f.context(),
          new AbortController().signal,
        )) as any;
      expect(result.id).toBe("local-child");
    }
    expect(waits).toEqual([1000, 1000]);
    expect(launches[0]?.args).toContain("laptop/must-not-forward");
    expect(launches[0]?.env.DIE_SUBAGENT_DEPTH).toBe("1");
    expect(f.requests).toHaveLength(0);
  } finally {
    prepared.mockRestore();
    spawn.mockRestore();
    foreground.mockRestore();
  }
});

test("adapter allowlists transfer inputs and preserves supported explicit overrides without agent untracked authority", async () => {
  const f = await fixture();
  await f.adapter.launch({
    target: "box",
    jobSessionFile: f.context().sessionManager.getSessionFile(),
    localRoot: f.dir,
    prompt: "work",
    taskId: "direct-1",
    model: "server/override",
    thinking: "low",
    approvedUntracked: ["secret"],
    placement: { profile: "fast", parentDepth: 0, workspace: { kind: "inherit" } },
  } as SshLaunchRequest);
  expect(f.requests[0]?.model).toBe("server/override");
  expect(f.requests[0]?.thinking).toBe("low");
  expect(f.requests[0]).not.toHaveProperty("approvedUntracked");
});

test("unconfirmed repository preparation exposes the same reserved identity on retry", async () => {
  const f = await fixture();
  const ids: string[] = [];
  const adapter = createRemoteJobsAdapter(f.client, async (_client, args) => {
    ids.push(args.taskId);
    throw Error("Remote repository preparation unconfirmed");
  });
  const service = new JobService(
    f.manager,
    () => ({ depth: 0 }),
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    undefined,
    undefined,
    adapter,
  );
  let previous = "";
  for (let i = 0; i < 2; i++) {
    try {
      await service.handle("subagent", { target: "box", prompt: "work" }, f.context(), identity());
      throw Error("expected unconfirmed launch");
    } catch (error) {
      const message = String(error);
      expect(message).toContain("retained task ID: ssh:");
      if (previous) expect(message).toBe(previous);
      previous = message;
    }
  }
  expect(ids[0]).toBe(ids[1]);
});
