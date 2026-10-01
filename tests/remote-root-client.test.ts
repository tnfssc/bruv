import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { RootClient, type RootClientOptions } from "../src/remote/root-client";
import type { RootRequest, RootRecord, RootTransport } from "../src/remote/root-contract";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bruv-root-client-"));
  dirs.push(dir);
  const cwd = join(dir, "repo");
  mkdirSync(cwd);
  const target = { name: "fixture", host: "fixture", bruvPath: "bruv", ownerId: "owner", epoch: "epoch" };
  let record: RootRecord;
  let lose = false,
    gap = false,
    owner = "owner";
  const calls: RootRequest[] = [];
  const receipts = new Map<string, any>();
  let sourceResult: any;
  const transport: RootTransport = async (_host, _path, req) => {
    calls.push(req);
    if (req.op === "hello") return { ownerId: owner, epoch: "epoch" };
    if (req.op === "repository-upload")
      return { offset: req.offset + Buffer.from(req.data, "base64").length, checkout: "/independent/root/source" };
    if (req.op === "create") {
      record = { intent: req.intent, state: "running" };
      return { record };
    }
    if (req.op === "command") {
      const receipt = { commandId: req.commandId, state: "completed", result: { ok: true } };
      receipts.set(req.commandId, receipt);
      if (lose) {
        lose = false;
        throw Error("lost reply");
      }
      return receipt;
    }
    if (req.op === "command-status")
      return receipts.get(req.commandId) ?? { commandId: req.commandId, state: "unknown" };
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
    receipts,
    setLose: () => (lose = true),
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
  f.setLose();
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
  f.setLose();
  await expect(c.command({ kind: "abort" }, "durable")).rejects.toThrow();
  f.receipts.clear();
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
