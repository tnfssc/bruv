import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalCapabilities, readGrantedRepoFile, CAPABILITY_MAX_BYTES } from "../src/remote/capabilities";
let dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});
async function repo() {
  const d = await mkdtemp(join(tmpdir(), "die-cap-"));
  dirs.push(d);
  await mkdir(join(d, "sub"));
  await writeFile(join(d, "sub", "ok.txt"), "hello");
  return d;
}
test("explicit repo grant, bounded read and no other task/kind", async () => {
  const root = await repo();
  const local = new LocalCapabilities();
  const g = await local.grant("task", root, ["repo.read"]);
  const req = { id: "r", grantId: g.id, taskId: "task", kind: "repo.read" as const, input: "sub/ok.txt" };
  expect((await local.serve(req)).value).toBe("hello");
  expect(local.serve({ ...req, taskId: "other" })).rejects.toThrow();
  expect(local.serve({ ...req, kind: "skill:x" })).rejects.toThrow();
  local.revoke(g.id);
  expect(local.serve(req)).rejects.toThrow();
});
test("traversal, symlink, oversized, binary and nonregular denied", async () => {
  const root = await repo();
  await symlink(tmpdir(), join(root, "escape"));
  await writeFile(join(root, "huge"), "x".repeat(CAPABILITY_MAX_BYTES + 1));
  await writeFile(join(root, "binary"), new Uint8Array([255]));
  for (const name of ["../secret", "/etc/passwd", "escape/a", "huge", "binary", "sub"]) {
    expect(readGrantedRepoFile(root, name)).rejects.toThrow();
  }
});
test("offline waiting, reply identity, duplicate, revoke, cancellation and retry", async () => {
  const root = await repo();
  const client = new LocalCapabilities();
  const owner = new LocalCapabilities();
  const g = await client.grant("task", root, ["repo.read"]);
  owner.allowOwnerGrant(g.id, g.taskId, g.kinds);
  const pending = owner.request(g.id, "task", "repo.read", "sub/ok.txt");
  const [request] = owner.listPending();
  expect(owner.listPending()).toHaveLength(1); // no client connection: still waiting
  const answer = await client.serve(request);
  expect(() => owner.submit({ ...answer, taskId: "wrong" })).toThrow();
  expect(owner.submit(answer)).toBe(true);
  expect((await pending).value).toBe("hello");
  expect(owner.submit(answer)).toBe(false);
  const pending2 = owner.request(g.id, "task", "repo.read", "sub/ok.txt");
  owner.revoke(g.id);
  expect((await pending2).error).toBe("Grant revoked");
  expect(() => owner.request(g.id, "task", "repo.read", "sub/ok.txt")).toThrow();
  owner.allowOwnerGrant(g.id, "task", ["repo.read"]);
  const abort = new AbortController();
  const pending3 = owner.request(g.id, "task", "repo.read", "sub/ok.txt", abort.signal);
  const stale = owner.listPending()[0];
  abort.abort();
  expect((await pending3).error).toBe("Cancelled");
  expect(owner.submit({ requestId: stale.id, grantId: g.id, taskId: "task", value: "late" })).toBe(false);
});
test("named tool/skill handlers only; output and request limits", async () => {
  const root = await repo();
  const client = new LocalCapabilities();
  client.register("tool:echo", async (input, ctx) => (ctx.repoRoot === root ? input : "bad"));
  client.register("skill:large", async () => "x".repeat(CAPABILITY_MAX_BYTES + 1));
  const g = await client.grant("task", root, ["tool:echo", "skill:large"]);
  const req = { id: "r", grantId: g.id, taskId: "task", kind: "tool:echo" as const, input: "ok" };
  expect((await client.serve(req)).value).toBe("ok");
  expect((await client.serve({ ...req, kind: "skill:large" })).error).toMatch(/limit/);
  expect(client.serve({ ...req, input: "x".repeat(4097) })).rejects.toThrow();
  client.endTask("task");
  expect(client.serve(req)).rejects.toThrow();
});

test("revocation during slow handler suppresses late result", async () => {
  const root = await repo();
  const client = new LocalCapabilities();
  let complete!: (value: string) => void;
  client.register(
    "tool:slow",
    async () =>
      await new Promise<string>((resolve) => {
        complete = resolve;
      }),
  );
  const g = await client.grant("task", root, ["tool:slow"]);
  const work = client.serve({ id: "r", grantId: g.id, taskId: "task", kind: "tool:slow", input: "" });
  client.revoke(g.id);
  complete("too late");
  expect((await work).error).toBe("Grant revoked");
});
