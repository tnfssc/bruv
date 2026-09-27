import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { OwnerCapabilityMailbox, ClientCapabilityStore } from "../src/remote/capability-runtime";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "die-capability-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  const owner = new OwnerCapabilityMailbox(join(root, "tasks", "task1"), "task1");
  const client = new ClientCapabilityStore(join(root, "local-grants"));
  return { root, repo, owner, client, clean: () => rm(root, { recursive: true, force: true }) };
};
test("offline request survives reload, explicitly granted read and idempotent fenced reply", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, "README.md"), "hello");
    const grant = await f.client.grant("task1", f.repo, ["repo.read"]);
    await f.owner.acceptGrant(grant);
    const request = await f.owner.request(grant.id, "repo.read", "README.md", randomUUID());
    const again = new OwnerCapabilityMailbox(f.owner.taskDir, "task1");
    expect(await again.pending()).toEqual([request]);
    const reply = await f.client.serve(request);
    expect(reply.value).toBe("hello");
    expect(await again.reply(reply)).toBe(true);
    expect(await again.reply(reply)).toBe(true);
    expect(await again.execute(grant.id, "repo.read", "README.md", { requestId: request.id })).toBe("hello");
    expect(await again.pending()).toEqual([]);
    expect(again.reply({ ...reply, value: "changed" })).rejects.toThrow("conflict");
    expect(again.request(grant.id, "repo.read", "different", request.id)).rejects.toThrow("conflict");
  } finally {
    await f.clean();
  }
});
test("offline execute remains pending; abort, deadline, revoke and terminal fence", async () => {
  const f = await fixture();
  try {
    const grant = await f.client.grant("task1", f.repo, ["repo.read"]);
    await f.owner.acceptGrant(grant);
    const ac = new AbortController();
    const promise = f.owner.execute(grant.id, "repo.read", "README.md", { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 100));
    expect((await f.owner.pending()).length).toBe(1);
    ac.abort();
    await expect(promise).rejects.toThrow("cancelled");
    expect(await f.owner.pending()).toEqual([]);
    const request = await f.owner.request(grant.id, "repo.read", "README.md");
    await expect(f.owner.awaitReply(request, { deadlineMs: 1 })).rejects.toThrow("deadline");
    expect(await f.owner.pending()).toEqual([]);
    const revokeRequest = await f.owner.request(grant.id, "repo.read", "README.md");
    await f.owner.revoke(grant.id);
    expect(await f.owner.reply({ requestId: request.id, grantId: grant.id, taskId: "task1", value: "fake" })).toBe(
      false,
    );
    expect(f.owner.awaitReply(revokeRequest)).rejects.toThrow("revoked");
    await f.owner.terminal();
    expect(await f.owner.pending()).toEqual([]);
    expect(f.owner.request(grant.id, "repo.read", "README.md")).rejects.toThrow();
  } finally {
    await f.clean();
  }
});
test("sensitive paths denied, explicit skills and read-only git tools", async () => {
  const f = await fixture();
  try {
    execFileSync("git", ["init", "-q", f.repo]);
    await writeFile(join(f.repo, "file.txt"), "safe\n");
    execFileSync("git", ["-C", f.repo, "add", "file.txt"]);
    await writeFile(join(f.repo, "file.txt"), "changed\n");
    await mkdir(join(f.repo, ".agents", "skills", "review"), { recursive: true });
    await writeFile(join(f.repo, ".agents", "skills", "review", "SKILL.md"), "review rules");
    await writeFile(join(f.repo, ".env"), "PASSWORD=secret");
    await writeFile(join(f.repo, "credentials.json"), "secret");
    const grant = await f.client.grant("task1", f.repo, [
      "repo.read",
      "skill:review",
      "tool:git-status",
      "tool:git-diff",
    ]);
    const req = (kind: (typeof grant.kinds)[number], input: string) => ({
      id: randomUUID(),
      grantId: grant.id,
      taskId: "task1",
      kind,
      input,
    });
    expect((await f.client.serve(req("repo.read", ".env"))).error).toContain("denied");
    expect((await f.client.serve(req("repo.read", "credentials.json"))).error).toContain("denied");
    expect((await f.client.serve(req("repo.read", "../x"))).error).toContain("denied");
    expect((await f.client.serve(req("skill:review", ""))).value).toBe("review rules");
    expect((await f.client.serve(req("tool:git-diff", ".env"))).error).toContain("denied");
    expect((await f.client.serve(req("tool:git-diff", "file.txt"))).value).toContain("+changed");
    expect((await f.client.serve(req("tool:git-diff", "."))).error).toContain("regular file");
    expect((await f.client.serve(req("tool:git-status", ""))).value).toContain("file.txt");
    expect((await f.client.serve(req("tool:git-status", "extra"))).error).toContain("empty");
    await f.client.revoke(grant.id);
    expect(f.client.serve(req("skill:review", ""))).rejects.toThrow("grant");
  } finally {
    await f.clean();
  }
});

test("concurrent capability requests across mailbox instances obey the pending bound", async () => {
  const f = await fixture();
  try {
    await f.owner.acceptGrant({ id: "grant_parallel", taskId: "task1", kinds: ["repo.read"] });
    const requests = await Promise.allSettled(
      Array.from({ length: 40 }, (_, n) =>
        new OwnerCapabilityMailbox(f.owner.taskDir, "task1").request(
          "grant_parallel",
          "repo.read",
          "file",
          "request_" + n,
        ),
      ),
    );
    expect(requests.filter((r) => r.status === "fulfilled")).toHaveLength(32);
    expect(requests.filter((r) => r.status === "rejected")).toHaveLength(8);
    expect(await f.owner.pending()).toHaveLength(32);
  } finally {
    await f.clean();
  }
});
