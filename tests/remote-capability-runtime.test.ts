import { grantCapabilities, revokeCapability } from "../src/remote/services";
import { test, expect, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { CAPABILITY_MAX_BYTES } from "../src/remote/capabilities";
import { OwnerCapabilityMailbox, ClientCapabilityStore } from "../src/remote/capability-runtime";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-capability-"));
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
    await expect(f.client.serve({ ...request, taskId: "other" })).rejects.toThrow("grant");
    await expect(f.client.serve({ ...request, kind: "skill:x" })).rejects.toThrow("grant");
    await expect(f.client.serve({ ...request, input: "x".repeat(4097) })).rejects.toThrow("request");
    await expect(again.request(grant.id, "repo.read", "x".repeat(4097))).rejects.toThrow();
    await expect(again.request(grant.id, "skill:x", "")).rejects.toThrow("grant");
    await expect(again.reply({ ...reply, taskId: "other" })).rejects.toThrow();
    expect(await again.reply(reply)).toBe(true);
    expect(await again.reply(reply)).toBe(true);
    expect(await again.execute(grant.id, "repo.read", "README.md", { requestId: request.id })).toBe("hello");
    expect(await again.pending()).toEqual([]);
    await expect(again.reply({ ...reply, value: "changed" })).rejects.toThrow("conflict");
    await expect(again.request(grant.id, "repo.read", "different", request.id)).rejects.toThrow("conflict");
  } finally {
    await f.clean();
  }
});
test.each([0, 250])(
  "offline execute remains pending; abort, deadline, revoke and terminal fence (fsync delay %i ms)",
  async (delayMs) => {
    const f = await fixture();
    const ac = new AbortController();
    let promise: Promise<string> | undefined;
    let restoreOpen = () => {};
    try {
      const grant = await f.client.grant("task1", f.repo, ["repo.read"]);
      await f.owner.acceptGrant(grant);
      const requestId = randomUUID();
      let delayedSync = false;
      if (delayMs) {
        // Hold the real temp-file fsync beyond the old 100 ms assumption, without bypassing durability.
        const open = fsPromises.open;
        const slowOpen = spyOn(fsPromises, "open").mockImplementation(async (...args: Parameters<typeof open>) => {
          const fd = await open(...args);
          if (String(args[0]).includes("/requests/" + requestId + ".json.")) {
            const sync = fd.sync.bind(fd);
            fd.sync = async () => {
              await Bun.sleep(delayMs);
              await sync();
              delayedSync = true;
            };
          }
          return fd;
        });
        restoreOpen = () => slowOpen.mockRestore();
      }
      promise = f.owner.execute(grant.id, "repo.read", "README.md", { requestId, signal: ac.signal });
      // Observe rejection immediately, even if a publication/assertion fails before the abort check.
      void promise.catch(() => {});
      // Same-ID requests are serialized and idempotent: this joins execute's durable publication.
      await f.owner.request(grant.id, "repo.read", "README.md", requestId);
      expect(delayedSync).toBe(delayMs > 0);
      expect((await f.owner.pending()).length).toBe(1);
      ac.abort();
      await expect(promise).rejects.toThrow("cancelled");
      expect(await f.owner.pending()).toEqual([]);
      const request = await f.owner.request(grant.id, "repo.read", "README.md");
      await expect(f.owner.awaitReply(request, { deadlineMs: 1 })).rejects.toThrow("deadline");
      expect(await f.owner.pending()).toEqual([]);
      const revokeRequest = await f.owner.request(grant.id, "repo.read", "README.md");
      await f.owner.revoke(grant.id);
      await expect(f.owner.request(grant.id, "repo.read", "README.md")).rejects.toThrow();
      expect(await f.owner.reply({ requestId: request.id, grantId: grant.id, taskId: "task1", value: "fake" })).toBe(
        false,
      );
      await expect(f.owner.awaitReply(revokeRequest)).rejects.toThrow("revoked");
      await f.owner.terminal();
      expect(await f.owner.pending()).toEqual([]);
      await expect(f.owner.request(grant.id, "repo.read", "README.md")).rejects.toThrow();
    } finally {
      ac.abort();
      await promise?.catch(() => {});
      restoreOpen();
      await f.clean();
    }
  },
);
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
    await writeFile(join(f.repo, "file.txt"), "x".repeat(CAPABILITY_MAX_BYTES));
    expect((await f.client.serve(req("tool:git-diff", "file.txt"))).error).toContain("output exceeds limit");
    await f.client.revoke(grant.id);
    await expect(f.client.serve(req("skill:review", ""))).rejects.toThrow("grant");
  } finally {
    await f.clean();
  }
});

test("revocation during a read-only Git tool suppresses its late result", async () => {
  const f = await fixture();
  const path = process.env.PATH;
  const started = join(f.root, "started"),
    release = join(f.root, "release");
  let work: ReturnType<ClientCapabilityStore["serve"]> | undefined;
  try {
    await writeFile(
      join(f.root, "git"),
      "#!" +
        process.execPath +
        "\n" +
        "if(process.argv.includes('config'))process.exit(1);" + // No local filters. Only the status read waits.
        "const {writeFileSync,existsSync}=require('node:fs');writeFileSync(" +
        JSON.stringify(started) +
        ", 'ready');" +
        "while(!existsSync(" +
        JSON.stringify(release) +
        "))await Bun.sleep(10);process.stdout.write('late private output');",
      { mode: 0o700 },
    );
    process.env.PATH = f.root + ":" + path;
    const grant = await f.client.grant("task1", f.repo, ["tool:git-status"]);
    work = f.client.serve({ id: "late_read", grantId: grant.id, taskId: "task1", kind: "tool:git-status", input: "" });
    void work.catch(() => {});
    for (let n = 0; n < 100 && !existsSync(started); n++) await Bun.sleep(10);
    expect(existsSync(started)).toBe(true);
    await f.client.revoke(grant.id);
    await writeFile(release, "continue");
    const reply = await work;
    expect(reply.error).toBe("Grant revoked");
    expect(reply.value).toBeUndefined();
  } finally {
    // A serve still reading its grant may not have spawned Git yet. Drain it before restoring PATH.
    try {
      await writeFile(release, "continue");
      await work;
    } finally {
      process.env.PATH = path;
      await f.clean();
    }
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

test("an explicit regrant after revocation gets a new durable authority without reviving the old one", async () => {
  const f = await fixture();
  try {
    execFileSync("git", ["-C", f.repo, "init", "-q"]);
    const client = {
      path: join(f.root, "remote", "state.json"),
      transcript: async () => ({ task: { state: "running" } }),
      control: async (req: any) => {
        if (req.op === "capability-grant") await f.owner.acceptGrant(req.grant);
        else if (req.op === "capability-revoke") await f.owner.revoke(req.grantId);
        return { accepted: true };
      },
    };
    const first = await grantCapabilities(client as any, "task1", f.repo, ["repo.read"]);
    await revokeCapability(client as any, "task1", first.grant.id);
    const second = await grantCapabilities(client as any, "task1", f.repo, ["repo.read"]);
    expect(second.grant.id).not.toBe(first.grant.id);
    expect(await f.owner.grant(first.grant.id)).toBeUndefined();
    expect(await f.owner.grant(second.grant.id)).toMatchObject({ kinds: ["repo.read"] });
    const retry = await grantCapabilities(client as any, "task1", f.repo, ["repo.read"]);
    expect(retry.grant.id).toBe(second.grant.id);
  } finally {
    await f.clean();
  }
});
