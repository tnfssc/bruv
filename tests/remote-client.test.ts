import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteClient, type Transport } from "../src/remote/client";
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function fixture(transport: Transport) { const dir = await mkdtemp(join(tmpdir(), "remote-client-")); dirs.push(dir); return new RemoteClient(join(dir, "remote", "state.json"), transport); }
const h = (epoch = "one") => ({ protocol: 1, ownerId: "owner", epoch, version: "1", platform: "linux", profile: { name: "normal", model: "provider/model", auth: "configured" } });
test("pins intent before first network POST; uncertain retry uses identical ID only", async () => {
  let fail = true; const requests: any[] = [];
  const client = await fixture(async (_host, _path, r) => { requests.push(r); if (r.op === "hello") return h(); if (fail) { fail = false; throw new Error("lost reply"); } return { task: { taskId: r.taskId, state: "accepted" } }; });
  await client.connect("configured-host");
  await expect(client.launch("/repo", "work", "id1")).rejects.toThrow("lost reply");
  const saved = await client.transcript("id1"); expect(saved.outcome).toBe("unknown");
  expect(saved.ownerId).toBe("owner"); expect(saved.repoPath).toBe("/repo");
  await expect(client.launch("/other", "work", "id1")).rejects.toThrow("different owner or intent");
  expect((await client.launch("/repo", "work", "id1")).outcome).toBe("accepted");
  expect(requests.filter((r) => r.op === "launch").map((r) => r.taskId)).toEqual(["id1", "id1"]);
  await client.launch("/repo", "work", "id1"); expect(requests.filter((r) => r.op === "launch")).toHaveLength(2);
  expect((await stat(client.path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(client.path, ".."))).mode & 0o777).toBe(0o700);
  expect(JSON.parse(await readFile(client.path, "utf8")).tasks.id1.prompt).toBe("work");
});
test("changed owner prevents retry and sync; cache remains available offline", async () => {
  let epoch = "one"; let posts = 0;
  const c = await fixture(async (_host, _path, r) => { if (r.op === "hello") return h(epoch); if (r.op === "launch") { posts++; throw Error("timeout"); } throw Error("offline"); });
  await c.connect("myhost"); await expect(c.launch("/repo", "p", "id1")).rejects.toThrow("timeout");
  epoch = "two";
  await expect(c.launch("/repo", "p", "id1")).rejects.toThrow("owner changed");
  await c.connect("myhost");
  await expect(c.launch("/repo", "p", "id1")).rejects.toThrow("different owner or intent");
  await expect(c.sync("id1")).rejects.toThrow("another remote owner");
  expect((await c.transcript("id1")).outcome).toBe("unknown"); expect(posts).toBe(1);
});
test("paginated sync persists contiguous pages and does not clobber accepted task after offline", async () => {
  let offline = false; const cursors: number[] = [];
  const c = await fixture(async (_host, _path, r) => {
    if (r.op === "hello") { if (offline) throw Error("offline"); return h(); }
    if (r.op === "launch") return { task: { taskId: r.taskId, state: "accepted" } };
    cursors.push(r.cursor as number);
    if (r.cursor === 0) return { task: { taskId: r.taskId, state: "running" }, events: [{ seq: 1, event: "first" }], cursor: 1, hasMore: true };
    return { task: { taskId: r.taskId, state: "done" }, events: [{ seq: 2, event: "done" }], cursor: 2, hasMore: false };
  });
  await c.connect("box"); await c.launch("/repo", "p", "id1");
  expect((await c.sync("id1")).events.map((e) => e.seq)).toEqual([1, 2]); expect(cursors).toEqual([0, 1]);
  offline = true; await expect(c.sync("id1")).rejects.toThrow("offline");
  expect((await c.transcript("id1")).task?.state).toBe("done");
});
test("rejects gaps without persisting bad transcript and never accepts hostile host", async () => {
  const c = await fixture(async (_host, _path, r) => r.op === "hello" ? h() : r.op === "launch" ? { task: { taskId: r.taskId, state: "accepted" } } : { task: { taskId: r.taskId, state: "running" }, events: [{ seq: 2, event: "gap" }], cursor: 2, hasMore: false });
  await expect(c.connect("-oProxyCommand=evil")).rejects.toThrow("Invalid SSH alias");
  await c.connect("box"); await c.launch("/repo", "p", "id1");
  await expect(c.sync("id1")).rejects.toThrow("Noncontiguous");
  expect((await c.transcript("id1")).events).toEqual([]);
});

test("lost launch reply blocks automatic fresh-ID repeat of the same intent", async () => {
  let posts = 0;
  const c = await fixture(async (_h, _p, r) => { if (r.op === "hello") return h(); posts++; throw Error("lost"); });
  await c.connect("box"); await expect(c.launch("/repo", "p")).rejects.toThrow("lost");
  await expect(c.launch("/repo", "p")).rejects.toThrow("identical launch has unknown outcome");
  expect(posts).toBe(1);
});
test("missing remote model fails explicitly without copying a local default", async () => {
  const c = await fixture(async () => ({ ...h(), profile: { name: "normal", auth: "missing" } }));
  await expect(c.connect("box")).rejects.toThrow("Remote normal profile has no model");
});
test("independent client instances serialize local state writes", async () => {
  const transport: Transport = async (_h, _p, r) => r.op === "hello" ? h() : { task: { taskId: r.taskId, state: "accepted" } };
  const first = await fixture(transport), second = new RemoteClient(first.path, transport);
  await first.connect("box");
  await Promise.all([first.launch("/repo", "one", "one"), second.launch("/repo", "two", "two")]);
  expect(Object.keys((await first.status()).tasks).sort()).toEqual(["one", "two"]);
});
