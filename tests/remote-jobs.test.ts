import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { RemoteClient } from "../src/remote/client";
import { createRemoteJobsAdapter, type RemoteJobsAdapter, sshJobId, sshTaskId } from "../src/remote/jobs";
import type { T3TaskAdapter } from "../src/t3/tasks/native-task";
import { JobService } from "../src/tasks/job-service";
import { TaskManager } from "../src/tasks/task-manager";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});
const hello = {
  protocol: 1,
  ownerId: "owner",
  epoch: "epoch",
  version: "1",
  platform: "linux",
  profile: { name: "normal", model: "test", auth: "configured" },
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "remote-jobs-"));
  dirs.push(dir);
  let offline = false;
  const client = new RemoteClient(join(dir, "state.json"), async (_host, _bruv, req) => {
    if (req.op === "hello") {
      if (offline) throw new Error("offline");
      return hello;
    }
    if (req.op === "launch") return { task: { taskId: req.taskId, state: "accepted" } };
    if (req.op === "cancel") return { task: { taskId: req.taskId, state: "running" } };
    throw Error("unexpected remote request");
  });
  await client.connect("box");
  return {
    client,
    adapter: createRemoteJobsAdapter(client),
    setOffline: (value: boolean) => {
      offline = value;
    },
  };
}
type JobCall = (method: string, params: unknown) => Promise<unknown>;
type JobPage = { jobs: Array<{ id: string }>; nextCursor?: string | number; total: number };

async function withSessionJobs(
  remoteJobs: RemoteJobsAdapter,
  sessionFile: string,
  nativeTaskIds: string[] | undefined,
  work: (call: JobCall) => Promise<void>,
) {
  const manager = new TaskManager(() => {});
  const native = (nativeTaskIds ?? []).map((taskId) => ({
    version: 1 as const,
    taskId,
    childThreadId: `thread-${taskId}`,
    status: "running" as const,
    profile: "normal" as const,
    depth: 1,
  }));
  const nativeFactory = (): T3TaskAdapter => ({
    list: async ({ cursor = "0", count = 20 } = {}) => {
      const offset = Number(cursor);
      const tasks = native.slice(offset, offset + count);
      return {
        tasks,
        total: native.length,
        nextCursor: offset + tasks.length < native.length ? String(offset + tasks.length) : undefined,
      };
    },
    launch: async () => {
      throw Error("unexpected native launch");
    },
    observe: async () => {
      throw Error("unexpected native observe");
    },
    cancel: async () => {
      throw Error("unexpected native cancel");
    },
    close: async () => {},
  });
  // undefined means no native bridge; [] means an authenticated bridge with no tasks.
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    undefined,
    undefined,
    undefined,
    undefined,
    nativeTaskIds !== undefined ? { T3_MCP_URL: "http://localhost:8080", T3_MCP_BEARER_TOKEN: "test" } : {},
    nativeTaskIds !== undefined ? nativeFactory : undefined,
    undefined,
    remoteJobs,
  );
  const ctx = { cwd: process.cwd(), sessionManager: { getSessionFile: () => sessionFile } } as ExtensionContext;
  const signal = new AbortController().signal;
  try {
    await work((method, params) => service.handle(method, params, ctx, signal));
  } finally {
    await manager.shutdown();
  }
}

async function collectJobIds(call: JobCall, expectedTotal: number) {
  const ids: string[] = [];
  let cursor: string | number | undefined;
  let pages = 0;
  do {
    const page = (await call("jobs.list", { count: 2, ...(cursor !== undefined ? { cursor } : {}) })) as JobPage;
    expect(page.total).toBe(expectedTotal);
    expect(page.jobs.length).toBeLessThanOrEqual(2);
    ids.push(...page.jobs.map((job) => job.id));
    cursor = page.nextCursor;
    expect(++pages).toBeLessThan(10);
  } while (cursor !== undefined);
  return ids;
}

test("SSH namespace reverses safely, session ownership is durable before launch and retries cannot steal", async () => {
  const { client, adapter, setOffline } = await fixture();
  expect(sshTaskId(sshJobId("task_1"))).toBe("task_1");
  expect(() => sshTaskId("ssh:@@@")).toThrow();
  setOffline(true);
  await expect(client.launch("/repo", "prompt", "task_1", undefined, "session-A")).rejects.toThrow("outcome unknown");
  expect((await client.transcript("task_1")).jobSessionFile).toBe("session-A");
  await expect(client.launch("/repo", "prompt", "task_1", undefined, "session-B")).rejects.toThrow("refusal to steal");
  expect(await adapter.list("session-B")).toEqual([]);
  expect((await adapter.list("session-A"))[0]?.status).toBe("unknown");
  await expect(adapter.stop("session-B", sshJobId("task_1"))).rejects.toThrow("Unknown SSH job");
  const partial = await adapter.stopWork("session-A");
  expect(partial.outcome).toBe("partial");
  expect(partial.jobs[0]?.outcome).toBe("error");
  expect((await client.transcript("task_1")).cancelDelivery?.status).toBe("requested");
});
test("cached inspect is bounded, offline stopWork is partial and completed jobs remain visible", async () => {
  const { client, adapter, setOffline } = await fixture();
  await client.launch("/repo", "prompt", "task_2", undefined, "session-A");
  const state = await client.read();
  state.tasks.task_2!.events = [{ seq: 1, event: "é".repeat(10000) }];
  state.tasks.task_2!.task = { taskId: "task_2", state: "running" };
  await writeFile(client.path, JSON.stringify(state));
  const id = sshJobId("task_2");
  const page = await adapter.inspect("session-A", id, 0, 30);
  expect(Buffer.byteLength(page.output)).toBeLessThanOrEqual(30);
  expect(page.hasMore).toBe(true);
  expect(page.stale).toBe(true);
  setOffline(true);
  expect((await adapter.stopWork("session-A")).outcome).toBe("partial");
  const next = await client.read();
  next.tasks.task_2!.task!.state = "done";
  await writeFile(client.path, JSON.stringify(next));
  expect((await adapter.list("session-A"))[0]?.status).toBe("completed");
  expect((await adapter.stopWork("session-A")).jobs).toEqual([]);
});

test("JobService paginates local then SSH without duplicates, rejects unsupported SSH methods", async () => {
  const { client, adapter } = await fixture();
  for (let i = 0; i < 4; i++) await client.launch("/repo", "prompt" + i, "id" + i, undefined, "session-A");
  await withSessionJobs(adapter, "session-A", undefined, async (call) => {
    const local = (await call("shell", { command: "printf local", waitSeconds: 1 })) as { id: string };
    expect(await collectJobIds(call, 5)).toEqual([local.id, ...[0, 1, 2, 3].map((i) => sshJobId("id" + i))]);
    const id = sshJobId("id0");
    await expect(call("jobs.input", { id, data: "x" })).rejects.toThrow("unsupported for SSH jobs");
    await expect(call("jobs.closeInput", { id })).rejects.toThrow("unsupported for SSH jobs");
    await expect(call("jobs.snooze", { id, minutes: 1 })).rejects.toThrow("unsupported for SSH jobs");
    await expect(call("jobs.setWatch", { id, enabled: false })).rejects.toThrow("unsupported for SSH jobs");
  });
});

test("three-source pagination crosses native to SSH without skipping or repeating", async () => {
  const { client, adapter } = await fixture();
  for (let i = 0; i < 3; i++) await client.launch("/repo", "prompt" + i, "ssh" + i, undefined, "session-A");
  await withSessionJobs(adapter, "session-A", ["native0", "native1", "native2"], async (call) => {
    expect(await collectJobIds(call, 6)).toEqual([
      "native0",
      "native1",
      "native2",
      sshJobId("ssh0"),
      sshJobId("ssh1"),
      sshJobId("ssh2"),
    ]);
  });
});

for (const [localCount, nativeCount, sshCount] of [
  [3, 0, 0],
  [2, 0, 0],
  [2, 0, 2],
  [3, 0, 2],
  [0, 3, 0],
  [0, 0, 3],
  [3, 3, 0],
  [0, 0, 0],
])
  test(`native pagination preserves every phase (local=${localCount}, native=${nativeCount}, SSH=${sshCount})`, async () => {
    const { client, adapter } = await fixture();
    for (let i = 0; i < sshCount; i++) await client.launch("/repo", "prompt", "ssh" + i, undefined, "session-A");
    const nativeIds = Array.from({ length: nativeCount }, (_, i) => "native" + i);
    await withSessionJobs(adapter, "session-A", nativeIds, async (call) => {
      const locals: string[] = [];
      for (let i = 0; i < localCount; i++)
        locals.push(((await call("shell", { command: "printf local", waitSeconds: 1 })) as { id: string }).id);
      expect(await collectJobIds(call, localCount + nativeCount + sshCount)).toEqual([
        ...locals,
        ...nativeIds,
        ...Array.from({ length: sshCount }, (_, i) => sshJobId("ssh" + i)),
      ]);
    });
  });

test("mixed pages pin totals across a local-only first page, bound cursors and discriminate raw SSH IDs", async () => {
  const { client, adapter } = await fixture();
  await client.launch("/repo", "prompt", "same", undefined, "session-A");
  await withSessionJobs(adapter, "session-A", ["native0", "native1"], async (call) => {
    const locals: string[] = [];
    for (let i = 0; i < 3; i++)
      locals.push(((await call("shell", { command: "printf local", waitSeconds: 1 })) as { id: string }).id);
    expect(await collectJobIds(call, 6)).toEqual([...locals, "native0", "native1", sshJobId("same")]);
    for (const method of ["jobs.inspect", "jobs.stop"])
      await expect(call(method, { id: "same" })).rejects.toThrow("ssh: namespace");
    await expect(call("jobs.inspect", { id: "missing" })).rejects.toThrow("Unknown job");
    await expect(call("jobs.list", { cursor: "jobs-v2." + "x".repeat(2100) })).rejects.toThrow();
  });
});

test("confirmed cancelled work is terminal, and cached transcript gaps are surfaced", async () => {
  const { client, adapter } = await fixture();
  await client.launch("/repo", "prompt", "cancelled", undefined, "session-A");
  const state = await client.read();
  state.tasks.cancelled!.task = { taskId: "cancelled", state: "cancelled" };
  state.tasks.cancelled!.cancelDelivery = { status: "confirmed" };
  state.tasks.cancelled!.events = [
    { seq: 2, event: "later" },
    { seq: 4, event: "gap" },
  ];
  await writeFile(client.path, JSON.stringify(state));
  expect((await adapter.stopWork("session-A")).jobs).toEqual([]);
  const page = await adapter.inspect("session-A", sshJobId("cancelled"));
  expect(page.status).toBe("cancelled");
  expect(page.outputLost).toBe(true);
  expect(page.transcriptGap).toBe(true);
  expect(page.cancelDelivery).toBe("confirmed");
});

test("confirmed cancellation without a terminal observation remains pending offline", async () => {
  const { client, adapter, setOffline } = await fixture();
  await client.launch("/repo", "prompt", "confirm", undefined, "session-A");
  const state = await client.read();
  state.tasks.confirm!.cancelDelivery = { status: "confirmed" };
  state.tasks.confirm!.task = { taskId: "confirm", state: "running" };
  await writeFile(client.path, JSON.stringify(state));
  setOffline(true);
  const report = await adapter.stopWork("session-A");
  expect(report.outcome).toBe("pending");
  expect(report.jobs).toMatchObject([{ id: sshJobId("confirm"), outcome: "pending", status: "running" }]);
});

test("new SSH launches cannot shift a paginated snapshot even when their IDs sort earlier", async () => {
  const { client, adapter } = await fixture();
  await client.launch("/repo", "one", "z-first", undefined, "session");
  await client.launch("/repo", "two", "y-second", undefined, "session");
  await withSessionJobs(adapter, "session", undefined, async (call) => {
    const first = (await call("jobs.list", { count: 1 })) as JobPage;
    expect(first.jobs[0]!.id).toBe(sshJobId("z-first"));
    await client.launch("/repo", "three", "a-new", undefined, "session");
    const second = (await call("jobs.list", { count: 1, cursor: first.nextCursor })) as JobPage;
    expect(second.jobs[0]!.id).toBe(sshJobId("y-second"));
    expect(second.nextCursor).toBeUndefined();
    expect((await adapter.list("session")).map((j) => j.id)).toEqual(["z-first", "y-second", "a-new"].map(sshJobId));
  });
});

test("the SSH journal starts at sequence one, not a lost-output gap", async () => {
  const { client, adapter } = await fixture();
  await client.launch("/repo", "one", "one", undefined, "session");
  const state = await client.read();
  state.tasks.one!.events = [{ seq: 1, event: { text: "complete first event" } }];
  await writeFile(client.path, JSON.stringify(state));
  const page = await adapter.inspect("session", sshJobId("one"), 0, 5000);
  expect(page.outputLost).toBe(false);
  expect(page.transcriptGap).toBeUndefined();
});
