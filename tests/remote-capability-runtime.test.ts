import {
  capabilityNeeds,
  grantCapabilities,
  requestLocalCapability,
  revokeCapability,
  serviceRemoteTask,
} from "../src/remote/services";
import { test, expect, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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
  "offline execute publishes durably before abort removes it from pending (fsync delay %i ms)",
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
      const request = await f.owner.request(grant.id, "repo.read", "README.md", requestId);
      expect(delayedSync).toBe(delayMs > 0);
      expect(await f.owner.pending()).toEqual([request]);
      ac.abort();
      await expect(promise).rejects.toThrow("cancelled");
      expect(await f.owner.pending()).toEqual([]);
    } finally {
      ac.abort();
      await promise?.catch(() => {});
      restoreOpen();
      await f.clean();
    }
  },
);
test("reply deadline cancels its request and fences late delivery", async () => {
  const f = await fixture();
  try {
    const grant = await f.client.grant("task1", f.repo, ["repo.read"]);
    await f.owner.acceptGrant(grant);
    const request = await f.owner.request(grant.id, "repo.read", "README.md");
    await expect(f.owner.awaitReply(request, { deadlineMs: 1 })).rejects.toThrow("deadline");
    expect(await f.owner.pending()).toEqual([]);
    expect(await f.owner.reply({ requestId: request.id, grantId: grant.id, taskId: "task1", value: "fake" })).toBe(
      false,
    );
  } finally {
    await f.clean();
  }
});

test("grant revocation fences a pending request, late reply and new admission", async () => {
  const f = await fixture();
  try {
    const grant = await f.client.grant("task1", f.repo, ["repo.read"]);
    await f.owner.acceptGrant(grant);
    const request = await f.owner.request(grant.id, "repo.read", "README.md");
    expect(await f.owner.pending()).toEqual([request]);
    await f.owner.revoke(grant.id);
    await expect(f.owner.request(grant.id, "repo.read", "README.md")).rejects.toThrow("No active task grant");
    expect(await f.owner.reply({ requestId: request.id, grantId: grant.id, taskId: "task1", value: "fake" })).toBe(
      false,
    );
    await expect(f.owner.awaitReply(request)).rejects.toThrow("revoked");
    expect(await f.owner.pending()).toEqual([]);
  } finally {
    await f.clean();
  }
});

test("task terminal fences a pending request, late reply and new admission", async () => {
  const f = await fixture();
  try {
    const grant = await f.client.grant("task1", f.repo, ["repo.read"]);
    await f.owner.acceptGrant(grant);
    const request = await f.owner.request(grant.id, "repo.read", "README.md");
    expect(await f.owner.pending()).toEqual([request]);
    await f.owner.terminal();
    expect(await f.owner.pending()).toEqual([]);
    await expect(f.owner.awaitReply(request)).rejects.toThrow("Task terminal");
    expect(await f.owner.reply({ requestId: request.id, grantId: grant.id, taskId: "task1", value: "fake" })).toBe(
      false,
    );
    await expect(f.owner.request(grant.id, "repo.read", "README.md")).rejects.toThrow("No active task grant");
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
    await f.owner.cancelRequest("request_0");
    const recovered = await f.owner.request("grant_parallel", "repo.read", "file", "after_rejection");
    expect(recovered.id).toBe("after_rejection");
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

test("task servicing persists capability replies before delivery and retries frozen bytes", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repo, "README.md"), "first read");
    const store = new ClientCapabilityStore(join(f.root, "remote", "capability-grants"));
    const grant = await store.grant("task1", f.repo, ["repo.read"]);
    await f.owner.acceptGrant(grant);
    const request = await f.owner.request(grant.id, "repo.read", "README.md", "read1");
    const expectedReply = { requestId: request.id, grantId: grant.id, taskId: "task1", value: "first read" };
    const replies: unknown[] = [];
    let offline = true;
    const client = {
      path: join(f.root, "remote", "state.json"),
      control: async (command: any) => {
        const saved = JSON.parse(
          readFileSync(join(f.root, "remote", "capability-replies", "task1", "read1.json"), "utf8"),
        );
        expect(saved).toEqual({ request, reply: command.reply });
        replies.push(command.reply);
        if (offline) throw Error("lost capability reply");
        await f.owner.reply(command.reply);
      },
    };
    const task = { taskId: "task1", task: { state: "running", capabilities: [request] } };
    await expect(serviceRemoteTask(client as any, task as any)).rejects.toThrow("lost capability reply");
    await writeFile(join(f.repo, "README.md"), "changed after first read");
    offline = false;
    await serviceRemoteTask(client as any, task as any);
    expect(replies).toEqual([expectedReply, expectedReply]);
    expect(await f.owner.awaitReply(request)).toBe("first read");

    await expect(
      serviceRemoteTask(
        client as any,
        {
          ...task,
          task: { ...task.task, capabilities: [{ ...request, input: "different.md" }] },
        } as any,
      ),
    ).rejects.toThrow("Capability retry intent conflict");
    await store.revoke(grant.id);
    await serviceRemoteTask(client as any, task as any);
    expect(replies).toHaveLength(2);
  } finally {
    await f.clean();
  }
});

test("capability servicing is live-only and failure stops result collection", async () => {
  const f = await fixture();
  try {
    const client = { path: join(f.root, "remote", "state.json") };
    const task = {
      taskId: "task1",
      task: {
        state: "done",
        capabilities: [{ taskId: "wrong-task" }],
        artifactError: "artifact failure",
      },
    };
    await expect(serviceRemoteTask(client as any, task as any)).rejects.toThrow(
      "Offline text artifacts: Error: artifact failure",
    );
    await expect(
      serviceRemoteTask(
        client as any,
        {
          ...task,
          task: { ...task.task, state: "running" },
        } as any,
      ),
    ).rejects.toThrow("Capability identity mismatch");
  } finally {
    await f.clean();
  }
});

test("child capability need survives cancellation and becomes a mailbox request after a grant", async () => {
  const f = await fixture();
  const previousRuntime = process.env.BRUV_REMOTE_RUNTIME_STATE;
  process.env.BRUV_REMOTE_RUNTIME_STATE = join(f.owner.taskDir, "runtime.json");
  try {
    const args = { kind: "repo.read" as const, input: "README.md", requestId: "child-read" };
    await expect(requestLocalCapability(args, AbortSignal.abort())).rejects.toThrow("Capability request cancelled");
    expect(capabilityNeeds(f.owner.taskDir)).toEqual([
      { id: "child-read", taskId: "task1", kind: "repo.read", input: "README.md" },
    ]);
    await expect(requestLocalCapability({ ...args, input: "different.md" })).rejects.toThrow(
      "Capability intent conflict",
    );
    expect(await f.owner.pending()).toEqual([]);

    const grant = await f.client.grant("task1", f.repo, ["repo.read"]);
    await f.owner.acceptGrant(grant);
    const executing = requestLocalCapability(args);
    let pending = await f.owner.pending();
    while (!pending.length) {
      await Bun.sleep(10);
      pending = await f.owner.pending();
    }
    expect(capabilityNeeds(f.owner.taskDir)).toEqual([]);
    expect(pending[0]).toMatchObject({ id: "child-read", grantId: grant.id, kind: "repo.read", input: "README.md" });
    await f.owner.reply({ requestId: "child-read", grantId: grant.id, taskId: "task1", value: "owner reply" });
    expect(await executing).toBe("owner reply");
  } finally {
    if (previousRuntime === undefined) delete process.env.BRUV_REMOTE_RUNTIME_STATE;
    else process.env.BRUV_REMOTE_RUNTIME_STATE = previousRuntime;
    await f.clean();
  }
});

test("immutable grant publication accepts identical concurrent replay but rejects changed authority", async () => {
  const f = await fixture();
  try {
    const grants = await Promise.all([
      f.client.grant("task1", f.repo, ["repo.read"], "same_grant"),
      new ClientCapabilityStore(f.client.dir).grant("task1", f.repo, ["repo.read"], "same_grant"),
    ]);
    expect(grants[0]).toEqual(grants[1]);
    await expect(f.client.grant("task1", f.repo, ["tool:git-status"], "same_grant")).rejects.toMatchObject({
      code: "EEXIST",
    });
    await Promise.all(grants.map((grant) => f.owner.acceptGrant(grant)));
    await expect(f.owner.acceptGrant({ ...grants[0], kinds: ["tool:git-status"] })).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await f.owner.grant("same_grant")).toEqual(grants[0]);
  } finally {
    await f.clean();
  }
});

test("one-way markers keep their first record and cannot reopen replayed requests", async () => {
  const f = await fixture();
  try {
    const grant = await f.client.grant("task1", f.repo, ["repo.read"]);
    await f.owner.acceptGrant(grant);
    const request = await f.owner.request(grant.id, "repo.read", "README.md", "cancelled_read");
    await f.owner.cancelRequest(request.id);
    await f.owner.cancelRequest(request.id);
    expect(await f.owner.request(grant.id, "repo.read", "README.md", request.id)).toEqual(request);
    await expect(f.owner.awaitReply(request)).rejects.toThrow("cancelled");
    await f.owner.revoke(grant.id);
    await f.owner.revoke(grant.id);
    await f.client.revoke(grant.id);
    await f.client.revoke(grant.id);
    await f.owner.terminal("First terminal reason");
    await f.owner.terminal("Later terminal reason");
    const terminal = JSON.parse(
      await fsPromises.readFile(join(f.owner.taskDir, "capabilities", "terminal.json"), "utf8"),
    );
    expect(terminal).toEqual({ reason: "First terminal reason" });
    expect(await f.owner.grant(grant.id)).toBeUndefined();
    expect(await f.owner.pending()).toEqual([]);
    await expect(f.client.serve(request)).rejects.toThrow("grant");
  } finally {
    await f.clean();
  }
});
