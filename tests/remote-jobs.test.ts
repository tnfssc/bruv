import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobService } from "../src/tasks/job-service";
import { TaskManager } from "../src/tasks/task-manager";
import { RemoteClient } from "../src/remote/client";
import { createRemoteJobsAdapter, sshJobId, sshTaskId } from "../src/remote/jobs";
const dirs: string[] = [];
afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });
const hello = { protocol: 1, ownerId: "owner", epoch: "epoch", version: "1", platform: "linux", profile: { name: "normal", model: "test", auth: "configured" } };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "remote-jobs-")); dirs.push(dir);
  let offline = false;
  const client = new RemoteClient(join(dir, "state.json"), async (_host, _die, req) => {
    if (req.op === "hello") { if (offline) throw new Error("offline"); return hello; }
    if (req.op === "launch") return { task: { taskId: req.taskId, state: "accepted" } };
    if (req.op === "cancel") return { task: { taskId: req.taskId, state: "running" } };
    throw Error("unexpected remote request");
  });
  await client.connect("box");
  return { client, adapter: createRemoteJobsAdapter(client), setOffline: (value: boolean) => { offline = value; } };
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
  await import("node:fs/promises").then(({ writeFile }) => writeFile(client.path, JSON.stringify(state)));
  const id = sshJobId("task_2");
  const page = await adapter.inspect("session-A", id, 0, 30);
  expect(Buffer.byteLength(page.output)).toBeLessThanOrEqual(30);
  expect(page.hasMore).toBe(true);
  expect(page.stale).toBe(true);
  setOffline(true);
  expect((await adapter.stopWork("session-A")).outcome).toBe("partial");
  const next = await client.read(); next.tasks.task_2!.task!.state = "done";
  await import("node:fs/promises").then(({ writeFile }) => writeFile(client.path, JSON.stringify(next)));
  expect((await adapter.list("session-A"))[0]?.status).toBe("completed");
  expect((await adapter.stopWork("session-A")).jobs).toEqual([]);
});

test("JobService paginates local then SSH without duplicates, rejects unsupported SSH methods", async () => {
  const { client, adapter } = await fixture();
  for (let i = 0; i < 4; i++) await client.launch("/repo", "prompt" + i, "id" + i, undefined, "session-A");
  const manager = new TaskManager(() => {});
  const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined, {}, undefined, undefined, adapter);
  const ctx = { cwd: process.cwd(), sessionManager: { getSessionFile: () => "session-A" } } as any;
  const signal = new AbortController().signal;
  try {
    const local = await service.handle("shell", { command: "printf local", waitSeconds: 1 }, ctx, signal) as { id: string };
    let cursor: string | number | undefined;
    const ids: string[] = [];
    do {
      const page = await service.handle("jobs.list", { count: 2, ...(cursor !== undefined ? { cursor } : {}) }, ctx, signal) as { jobs: Array<{ id: string }>; nextCursor?: string | number; total: number };
      expect(page.total).toBe(5);
      ids.push(...page.jobs.map((job) => job.id)); cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(ids).toEqual([local.id, ...[0, 1, 2, 3].map((i) => sshJobId("id" + i))]);
    for (const method of ["jobs.input", "jobs.closeInput", "jobs.snooze", "jobs.setWatch"])
      await expect(service.handle(method, { id: sshJobId("id0"), data: "x", minutes: 1, enabled: false }, ctx, signal)).rejects.toThrow();
  } finally { await manager.shutdown(); }
});

test("three-source pagination crosses native to SSH without skipping or repeating", async () => {
  const { client, adapter } = await fixture();
  for (let i = 0; i < 3; i++) await client.launch("/repo", "prompt" + i, "ssh" + i, undefined, "session-A");
  const manager = new TaskManager(() => {});
  const native = Array.from({ length: 3 }, (_, i) => ({ taskId: "native" + i, status: "running" }));
  const factory = () => ({ list: async ({ cursor, count }: { cursor: string; count: number }) => {
    const offset = Number(cursor); const page = native.slice(offset, offset + count);
    return { tasks: page, total: native.length, nextCursor: offset + page.length < native.length ? String(offset + page.length) : undefined };
  }, close: async () => {} });
  const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined,
    { T3_MCP_URL: "http://localhost:8080", T3_MCP_BEARER_TOKEN: "test" }, factory as any, undefined, adapter);
  const ctx = { cwd: process.cwd(), sessionManager: { getSessionFile: () => "session-A" } } as any;
  try {
    const ids: string[] = []; let cursor: string | number | undefined;
    do { const page = await service.handle("jobs.list", { count: 2, ...(cursor !== undefined ? { cursor } : {}) }, ctx, new AbortController().signal) as { jobs: Array<{ id: string }>; nextCursor?: string | number; total: number };
      expect(page.total).toBe(6); ids.push(...page.jobs.map((job) => job.id)); cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(ids).toEqual(["native0", "native1", "native2", sshJobId("ssh0"), sshJobId("ssh1"), sshJobId("ssh2")]);
  } finally { await manager.shutdown(); }
});


test("mixed pages pin totals across a local-only first page, bound cursors and discriminate raw SSH IDs", async () => {
  const { client, adapter } = await fixture();
  await client.launch("/repo", "prompt", "same", undefined, "session-A");
  const manager = new TaskManager(() => {});
  const factory = () => ({ list: async ({ cursor, count }: { cursor: string; count: number }) => {
    const native = [{ taskId: "native0", status: "running" }, { taskId: "native1", status: "running" }];
    const start = Number(cursor); const tasks = native.slice(start, start + count);
    return { tasks, total: 2, nextCursor: start + tasks.length < 2 ? String(start + tasks.length) : undefined };
  }, observe: async () => { throw Error("unexpected native observe"); }, cancel: async () => { throw Error("unexpected native cancel"); }, close: async () => {} });
  const service = new JobService(manager, () => ({ depth: 0 }), undefined, undefined, undefined, undefined,
    { T3_MCP_URL: "http://localhost:8080", T3_MCP_BEARER_TOKEN: "test" }, factory as any, undefined, adapter);
  const ctx = { cwd: process.cwd(), sessionManager: { getSessionFile: () => "session-A" } } as any;
  const signal = new AbortController().signal;
  try {
    const locals: string[] = [];
    for (let i = 0; i < 3; i++) locals.push((await service.handle("shell", { command: "printf local", waitSeconds: 1 }, ctx, signal) as { id: string }).id);
    let cursor: string | undefined; const ids: string[] = [];
    do {
      const page = await service.handle("jobs.list", { count: 2, ...(cursor ? { cursor } : {}) }, ctx, signal) as { jobs: Array<{ id: string }>; nextCursor?: string; total: number };
      expect(page.total).toBe(6);
      ids.push(...page.jobs.map((job) => job.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual([...locals, "native0", "native1", sshJobId("same")]);
    for (const method of ["jobs.inspect", "jobs.stop"])
      await expect(service.handle(method, { id: "same" }, ctx, signal)).rejects.toThrow("ssh: namespace");
    await expect(service.handle("jobs.inspect", { id: "missing" }, ctx, signal)).rejects.toThrow("Unknown job");
    await expect(service.handle("jobs.list", { cursor: "jobs-v2." + "x".repeat(2100) }, ctx, signal)).rejects.toThrow();
  } finally { await manager.shutdown(); }
});

test("confirmed cancelled work is terminal, and cached transcript gaps are surfaced", async () => {
  const { client, adapter } = await fixture();
  await client.launch("/repo", "prompt", "cancelled", undefined, "session-A");
  const state = await client.read();
  state.tasks.cancelled!.task = { taskId: "cancelled", state: "cancelled" };
  state.tasks.cancelled!.cancelDelivery = { status: "confirmed" };
  state.tasks.cancelled!.events = [{ seq: 2, event: "later" }, { seq: 4, event: "gap" }];
  await import("node:fs/promises").then(({ writeFile }) => writeFile(client.path, JSON.stringify(state)));
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
  await import("node:fs/promises").then(({ writeFile }) => writeFile(client.path, JSON.stringify(state)));
  setOffline(true);
  const report = await adapter.stopWork("session-A");
  expect(report.outcome).toBe("pending");
  expect(report.jobs).toMatchObject([{ id: sshJobId("confirm"), outcome: "pending", status: "running" }]);
});
