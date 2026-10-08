import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RootClient, type RootClientOptions } from "../../src/remote/root/client";
import type { RootCommandReceipt, RootRecord, RootRequest, RootTransport } from "../../src/remote/root/contract";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup({ missingCommandStatus = "unknown" }: { missingCommandStatus?: "unknown" | "error" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bruv-root-client-"));
  dirs.push(dir);
  const cwd = join(dir, "repo");
  mkdirSync(cwd);
  const target = { name: "fixture", host: "fixture", bruvPath: "bruv", ownerId: "owner", epoch: "epoch" };
  let record: RootRecord;
  let lostReply: "command" | "create" | undefined;
  let gap = false;
  let owner = "owner";
  const calls: RootRequest[] = [];
  const receipts = new Map<string, RootCommandReceipt>();
  let sourceResult: any;
  function ownerReply(req: RootRequest): unknown {
    if (req.op === "hello") return { ownerId: owner, epoch: "epoch" };
    if (req.op === "repository-upload")
      return { offset: req.offset + Buffer.from(req.data, "base64").length, checkout: "/independent/root/source" };
    if (req.op === "create") {
      record = { intent: req.intent, state: "running" };
      return { record };
    }
    if (req.op === "command") {
      const receipt: RootCommandReceipt = { commandId: req.commandId, state: "completed", result: { ok: true } };
      receipts.set(req.commandId, receipt);
      return receipt;
    }
    if (req.op === "command-status") {
      const receipt = receipts.get(req.commandId);
      if (!receipt && missingCommandStatus === "error") throw Error("Unknown root command");
      return receipt ?? { commandId: req.commandId, state: "unknown" };
    }
    if (req.op === "observe")
      return {
        record,
        events: gap ? [{ seq: req.cursor + 2, event: { type: "agent_start" } }] : [],
        cursor: gap ? req.cursor + 2 : req.cursor,
        hasMore: false,
      };
    if (req.op === "detach") return { accepted: true };
    if (req.op === "repository-result") return sourceResult;
    throw Error("unexpected request");
  }
  const transport: RootTransport = async (_host, _path, req) => {
    calls.push(req);
    const response = ownerReply(req);
    if (req.op === lostReply) {
      lostReply = undefined;
      throw Error(req.op === "create" ? "lost create reply" : "lost reply");
    }
    return response;
  };
  const options: RootClientOptions = {
    cwd,
    target,
    stateDir: join(dir, "state"),
    remoteRepo: "/server/existing",
    transport,
  };
  return {
    dir,
    cwd,
    options,
    calls,
    forgetCommand: (id: string) => receipts.delete(id),
    loseNextReply: (op: "command" | "create") => (lostReply = op),
    setGap: () => (gap = true),
    setOwner: (x: string) => (owner = x),
    close: () => {
      record.state = "closed";
      record.exitCode = 0;
    },
    setResult: (x: any) => (sourceResult = x),
  };
}
test("lost prompt reply + restart reconciles SAME saved command without automatic duplicate", async () => {
  const f = setup();
  const c = await RootClient.open(f.options);
  await c.ensureCreated();
  f.loseNextReply("command");
  await expect(c.initialPrompt("hello")).rejects.toThrow("uncertain");
  const saved = c.read();
  const id = saved.initialPrompt!.commandId;
  expect(saved.commands[id]!.command).toEqual({ kind: "prompt", text: "hello" });
  const reopened = await RootClient.open(f.options);
  await reopened.ensureCreated();
  expect(reopened.read().intent.sessionId).toBe(saved.intent.sessionId);
  expect((await reopened.initialPrompt("hello")).state).toBe("completed");
  expect(f.calls.filter((r) => r.op === "command")).toHaveLength(1);
  expect(f.calls.filter((r) => r.op === "create")).toHaveLength(1);
  expect(statSync(c.path).mode & 0o777).toBe(0o600);
});
test("unknown command status never redispatches, including explicit retry with same id", async () => {
  const f = setup();
  const c = await RootClient.open(f.options);
  await c.ensureCreated();
  f.loseNextReply("command");
  await expect(c.command({ kind: "abort" }, "durable")).rejects.toThrow();
  f.forgetCommand("durable");
  expect((await c.command({ kind: "abort" }, "durable")).state).toBe("unknown");
  await expect(c.command({ kind: "close" }, "durable")).rejects.toThrow("conflict");
  expect(f.calls.filter((r) => r.op === "command")).toHaveLength(1);
});
test("owner fence and immutable model reject reconnect before command", async () => {
  const f = setup();
  const c = await RootClient.open({ ...f.options, model: "pinned" });
  await c.ensureCreated();
  await expect(RootClient.open({ ...f.options, model: "other" })).rejects.toThrow("immutable");
  await expect(RootClient.open({ ...f.options, target: { ...f.options.target, epoch: "other" } })).rejects.toThrow(
    "epoch",
  );
  f.setOwner("replacement");
  await expect(c.command({ kind: "abort" })).rejects.toThrow("owner/epoch");
  expect(f.calls.filter((r) => r.op === "command")).toHaveLength(0);
});
test("ordered cursor gap preserves authoritative root but never commits a skipped cursor", async () => {
  const f = setup();
  const c = await RootClient.open(f.options);
  await c.ensureCreated();
  f.setGap();
  await expect(c.observe()).rejects.toThrow("gap");
  expect(c.read().cursor).toBe(0);
  expect(c.read().record?.state).toBe("running");
});
test("detach never issues abort or close", async () => {
  const f = setup();
  const c = await RootClient.open(f.options);
  await c.ensureCreated();
  await c.detach();
  expect(f.calls.some((r) => r.op === "detach")).toBe(true);
  expect(f.calls.some((r) => r.op === "command")).toBe(false);
});
function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode) throw Error(r.stderr.toString());
  return r.stdout.toString();
}
test("tracked source upload is independent, selected untracked exact bytes; source drift returns review only", async () => {
  const f = setup();
  git(f.cwd, "init", "-q");
  git(f.cwd, "config", "user.name", "fixture");
  git(f.cwd, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(f.cwd, "file.txt"), "before\n");
  git(f.cwd, "add", "file.txt");
  git(f.cwd, "commit", "-qm", "base");
  writeFileSync(join(f.cwd, "approved.txt"), "approved exact bytes");
  writeFileSync(join(f.cwd, "omitted.txt"), "do not send");
  const c = await RootClient.open({ ...f.options, remoteRepo: undefined, remoteInclude: ["approved.txt"] });
  await c.ensureCreated();
  expect(c.read().source!.selectedUntracked).toEqual(["approved.txt"]);
  expect(c.read().source!.omittedUntracked).toContain("omitted.txt");
  expect(c.read().intent.repoPath).toBe("/independent/root/source");
  await expect(c.returnSource()).rejects.toThrow("confirmed closed");
  expect(f.calls.some((r) => r.op === "repository-result")).toBe(false);
  const patch = Buffer.from(
    "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n",
  );
  const result = {
    snapshot: c.read().source!.snapshot,
    patch: "/remote/not-local",
    sha256: createHash("sha256").update(patch).digest("hex"),
    untracked: [],
  };
  f.setResult({ result, total: patch.length, offset: patch.length, data: patch.toString("base64") });
  f.close();
  writeFileSync(join(f.cwd, "file.txt"), "local drift\n");
  const outcome = await c.returnSource();
  expect(outcome?.status).toBe("review");
  expect(outcome?.reason).toContain("changed since capture");
  expect(readFileSync(join(f.cwd, "file.txt"), "utf8")).toBe("local drift\n");
  expect(readFileSync(outcome!.artifact).equals(patch)).toBe(true);
});

test("startup admission is durable before dispatch and another client cannot overwrite its receipt", async () => {
  const f = setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const options = {
    ...f.options,
    transport: async (host: string, path: string, req: RootRequest) => {
      if (req.op === "command" && req.command.kind === "prompt") {
        entered.resolve();
        await release.promise;
      }
      return f.options.transport!(host, path, req);
    },
  };
  const first = await RootClient.open(options);
  await first.ensureCreated();
  const second = await RootClient.open(options);
  const prompt = first.initialPrompt("hello");
  await entered.promise;
  let abort: Promise<unknown> | undefined;
  try {
    const saved = second.read();
    const id = saved.initialPrompt!.commandId;
    expect(saved.commands[id]).toEqual({
      command: { kind: "prompt", text: "hello" },
      receipt: { commandId: id, state: "unknown" },
    });
    abort = second.command({ kind: "abort" }, "other-client");
  } finally {
    release.resolve();
    await Promise.all([prompt, ...(abort ? [abort] : [])]);
  }
  const saved = first.read();
  expect(Object.keys(saved.commands)).toHaveLength(2);
  expect(saved.commands[saved.initialPrompt!.commandId]!.receipt.state).toBe("completed");
  expect(saved.commands["other-client"]!.receipt.state).toBe("completed");
  await expect(second.initialPrompt("different")).rejects.toThrow("different startup prompt");
  expect(f.calls.filter((r) => r.op === "command")).toHaveLength(2);
});

test("lost create reply resumes the committed source checkout without transferring a new snapshot", async () => {
  const f = setup();
  git(f.cwd, "init", "-q");
  git(f.cwd, "config", "user.name", "fixture");
  git(f.cwd, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(f.cwd, "file.txt"), "before\n");
  git(f.cwd, "add", "file.txt");
  git(f.cwd, "commit", "-qm", "base");
  f.loseNextReply("create");
  const options = {
    ...f.options,
    remoteRepo: undefined,
    transport: async (host: string, path: string, req: RootRequest) => {
      if (req.op === "create") {
        expect(client.read().intent.repoPath).toBe(req.intent.repoPath);
        expect(client.read().created).toBe(false);
      }
      return f.options.transport!(host, path, req);
    },
  };
  const client = await RootClient.open(options);
  await expect(client.ensureCreated()).rejects.toThrow("lost create reply");
  const saved = client.read();
  expect(saved.intent.repoPath).toBe("/independent/root/source");
  const uploads = f.calls.filter((r) => r.op === "repository-upload").length;
  expect(uploads).toBeGreaterThan(0);
  const reopened = await RootClient.open(options);
  await reopened.ensureCreated();
  expect(f.calls.filter((r) => r.op === "repository-upload")).toHaveLength(uploads);
  const creates = f.calls.filter((r) => r.op === "create");
  expect(creates).toHaveLength(2);
  expect(creates[1]).toEqual(creates[0]);
  expect(reopened.read().source).toEqual(saved.source);
});

test("startup reservation yields admission to an already queued command", async () => {
  const f = setup();
  const client = await RootClient.open(f.options);
  await client.ensureCreated();
  await Promise.all([client.initialPrompt("hello"), client.command({ kind: "abort" }, "abort")]);
  const dispatched = f.calls.filter((r) => r.op === "command");
  expect(dispatched.map((r) => r.command.kind)).toEqual(["abort", "prompt"]);
  expect(dispatched[1]!.commandId).toBe(client.read().initialPrompt!.commandId);
});

test("startup identity reserved without admission can dispatch its saved command", async () => {
  const f = setup({ missingCommandStatus: "error" });
  const client = await RootClient.open(f.options);
  await client.ensureCreated();
  const reserved = client.read();
  reserved.initialPrompt = { text: "reserved only", commandId: "reserved" };
  writeFileSync(client.path, JSON.stringify(reserved));

  const reopened = await RootClient.open(f.options);
  await reopened.initialPrompt("reserved only");
  expect(f.calls.filter((r) => r.op === "command")).toHaveLength(1);
  expect(reopened.read().commands.reserved!.receipt.state).toBe("completed");
});

test("admitted startup command uses status only; a status error does not block later commands", async () => {
  const f = setup({ missingCommandStatus: "error" });
  const client = await RootClient.open(f.options);
  await client.ensureCreated();
  const admitted = client.read();
  admitted.initialPrompt = { text: "unknown before wire", commandId: "uncertain" };
  admitted.commands.uncertain = {
    command: { kind: "prompt", text: "unknown before wire" },
    receipt: { commandId: "uncertain", state: "unknown" },
  };
  writeFileSync(client.path, JSON.stringify(admitted));

  const resumed = await RootClient.open(f.options);
  await expect(resumed.initialPrompt("unknown before wire")).rejects.toThrow("Unknown root command");
  expect(f.calls.filter((r) => r.op === "command")).toHaveLength(0);
  expect(f.calls.filter((r) => r.op === "command-status")).toHaveLength(1);
  expect(resumed.read().commands.uncertain!.receipt.state).toBe("unknown");
  await resumed.command({ kind: "abort" }, "after-status-error");
  expect(resumed.read().commands["after-status-error"]!.receipt.state).toBe("completed");
});
