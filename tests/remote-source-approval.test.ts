import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withJobRequestIdentity } from "../src/job-delivery";
import { QuestionService } from "../src/questions/service";
import { RemoteClient } from "../src/remote/client";
import { createRemoteJobsAdapter, type RepositoryLauncher, type SshLaunchRequest, sshJobId } from "../src/remote/jobs";
import { SOURCE_CHOICES, SourceApprovalService, type SourceIntent } from "../src/remote/source-approval";
import { JobService } from "../src/tasks/job-service";
import { TaskManager } from "../src/tasks/task-manager";

// Git snapshot helpers spawn their own Git processes; fence both global and
// system config for these isolated fixtures, not only the setup helper.
const gitKeys = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM"] as const;
const savedGitEnvironment = Object.fromEntries(gitKeys.map((key) => [key, process.env[key]]));
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});
afterAll(() => {
  for (const key of gitKeys) {
    const value = savedGitEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function git(root: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode) throw Error(r.stderr.toString());
  return r.stdout.toString().trim();
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "source-approval-"));
  dirs.push(dir);
  const root = join(dir, "repo");
  mkdirSync(root);
  git(root, "init", "-q");
  writeFileSync(join(root, "tracked"), "base");
  git(root, "add", ".");
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
  writeFileSync(join(root, "tracked"), "current tracked edit");
  writeFileSync(join(root, "new.txt"), "pinned new bytes");
  writeFileSync(join(root, "omitted.txt"), "omit");
  const file = join(dir, "parent.jsonl");
  let leaf = "root";
  let branch = [{ id: "root", parentId: null as string | null }];
  const observations: Array<{ id: string; parentId: string; type: string; customType: string }> = [];
  const ctx = {
    sessionManager: {
      getSessionId: () => "parent",
      getSessionFile: () => file,
      getLeafId: () => leaf,
      getBranch: () => branch,
      getEntries: () => [...branch, ...observations],
    },
  };
  const questions = new QuestionService();
  const path = join(dir, "client.json");
  const service = new SourceApprovalService(path, questions);
  const intent: SourceIntent = {
    taskId: "task_source",
    jobSessionFile: file,
    localRoot: root,
    target: "box",
    ownerId: "owner",
    epoch: "epoch",
    prompt: "work",
    placement: { profile: "normal", parentDepth: 0, workspace: { kind: "inherit" } },
    includeUntracked: ["new.txt"],
  };
  return {
    dir,
    root,
    ctx,
    file,
    questions,
    path,
    service,
    intent,
    appendObservation(id: string, parentId = leaf, customType = "die-diagnostic") {
      observations.push({ id, parentId, type: "custom", customType });
    },
    navigate: (value: string) => {
      leaf = value;
      branch = [{ id: value, parentId: null }];
    },
    continueParent() {
      leaf = "followup";
      branch = [
        { id: "root", parentId: null },
        { id: leaf, parentId: "root" },
      ];
    },
  };
}
async function approve(f: ReturnType<typeof fixture>, choice: string) {
  const record = f.service.get(f.file, f.intent.taskId)!;
  const q = f.questions.get(f.ctx, record.questionId!);
  return f.questions.answer(f.ctx, { id: q.id, owner: q.owner, version: q.version, text: choice });
}
test("exact human-owned question pins tracked edits and requested bytes, not post-approval source", async () => {
  const f = fixture();
  const pending = await f.service.prepare(f.intent, f.ctx);
  const q = f.questions.get(f.ctx, pending.questionId!);
  expect(q.text).toContain('"paths":["new.txt"]');
  expect(q.taskIds).toEqual([sshJobId(f.intent.taskId)]);
  expect(q.text).toContain("SHA-256");
  expect(q.text).toContain('"target":"box"');
  expect(pending.state).toBe("waiting");
  await approve(f, SOURCE_CHOICES[0]);
  writeFileSync(join(f.root, "new.txt"), "changed after human answer");
  writeFileSync(join(f.root, "tracked"), "changed later tracked edit");
  const ready = await new SourceApprovalService(f.path).prepare(f.intent, f.ctx);
  const snapshot = f.service.snapshot(ready);
  const checkout = join(f.dir, "proof");
  git(f.dir, "clone", "-q", snapshot.bundle, checkout);
  expect(readFileSync(join(checkout, "new.txt"), "utf8")).toBe("pinned new bytes");
  expect(readFileSync(join(checkout, "tracked"), "utf8")).toBe("current tracked edit");
  expect(snapshot.omittedUntracked).toEqual(["omitted.txt"]);
});
test("ordinary agent ask/resolve cannot forge approval; unresolved defaults omit", async () => {
  const f = fixture();
  const pending = await f.service.prepare(f.intent, f.ctx);
  const q = f.questions.get(f.ctx, pending.questionId!);
  expect(() => f.questions.handle("questions.answer", { id: q.id, text: SOURCE_CHOICES[0] }, f.ctx)).toThrow(
    "UI reply only",
  );
  await expect(f.questions.ask(f.ctx, { text: "approved:true", dedupKey: q.dedupKey })).rejects.toThrow(
    "different request",
  );
  await f.questions.resolve(f.ctx, { id: q.id, owner: q.owner, version: q.version, reason: "approved:true" });
  const ready = await f.service.prepare(f.intent, f.ctx);
  expect(ready.decision).toBe("omit");
  expect(ready.omissionReason).toContain("all untracked files omitted");
  expect(f.service.snapshot(ready).selectedUntracked).toEqual([]);
});
test("explicit denial omits all untracked; explicit cancel never yields a dispatch snapshot", async () => {
  const f = fixture();
  await f.service.prepare(f.intent, f.ctx);
  await approve(f, SOURCE_CHOICES[1]);
  const denied = await f.service.prepare(f.intent, f.ctx);
  expect(denied.decision).toBe("omit");
  expect(f.service.snapshot(denied).omittedUntracked).toEqual(["new.txt", "omitted.txt"]);
  const g = fixture();
  await g.service.prepare(g.intent, g.ctx);
  await approve(g, SOURCE_CHOICES[2]);
  const cancelled = await g.service.prepare(g.intent, g.ctx);
  expect(cancelled.state).toBe("cancelled");
  expect(() => g.service.snapshot(cancelled)).toThrow("not ready");
});
test("owner, target, epoch, source and prompt retries cannot reuse approval", async () => {
  const f = fixture();
  await f.service.prepare(f.intent, f.ctx);
  await approve(f, SOURCE_CHOICES[0]);
  for (const change of [
    { target: "elsewhere" },
    { epoch: "new" },
    { ownerId: "other" },
    { prompt: "other" },
    { includeUntracked: ["omitted.txt"] },
  ])
    await expect(f.service.prepare({ ...f.intent, ...change }, f.ctx)).rejects.toThrow("retry intent conflict");
  await expect(f.service.prepare({ ...f.intent, jobSessionFile: "other" }, f.ctx)).rejects.toThrow(
    "parent session mismatch",
  );
  f.navigate("sibling");
  await expect(f.service.prepare(f.intent, f.ctx)).rejects.toThrow("Question not found");
});
test("stale or non-CLI answers do not grant inclusion; changed pinned bundle refuses dispatch", async () => {
  const f = fixture();
  const p = await f.service.prepare(f.intent, f.ctx);
  const ledger = f.file + ".questions.json";
  const records = JSON.parse(readFileSync(ledger, "utf8"));
  Object.assign(records[0], {
    status: "answered",
    answer: SOURCE_CHOICES[0],
    answeredFrom: "cli",
    replyId: "stale",
    replyVersion: 0,
  });
  writeFileSync(ledger, JSON.stringify(records));
  expect((await f.service.prepare(f.intent, f.ctx)).decision).toBe("omit");
  const g = fixture();
  await g.service.prepare(g.intent, g.ctx);
  await approve(g, SOURCE_CHOICES[0]);
  const ready = await g.service.prepare(g.intent, g.ctx);
  writeFileSync(ready.include.snapshot.bundle, "tampered");
  expect(() => g.service.snapshot(ready)).toThrow("changed");
  expect(p.questionVersion).toBe(2);
});
test("credential paths never receive an inclusion question", async () => {
  const f = fixture();
  writeFileSync(join(f.root, ".env"), "fixture fake secret");
  await expect(f.service.prepare({ ...f.intent, includeUntracked: [".env"] }, f.ctx)).rejects.toThrow(
    "credential/config",
  );
  expect(f.questions.list(f.ctx)).toEqual([]);
});
test("question delivery mutations preserve authentic human approval", async () => {
  const f = fixture();
  await f.service.prepare(f.intent, f.ctx);
  const answered = await approve(f, SOURCE_CHOICES[0]);
  await f.questions.setDelivery(f.ctx, {
    id: answered.id,
    owner: answered.owner,
    version: answered.version,
    delivery: "queued",
  });
  expect((await f.service.prepare(f.intent, f.ctx)).decision).toBe("include");
});
async function adapterFixture() {
  const f = fixture();
  let offline = false;
  let transportCalls = 0;
  let launches = 0;
  const client = new RemoteClient(f.path, async (_host, _die, req) => {
    transportCalls++;
    if (offline) throw Error("offline fixture");
    if (req.op === "hello")
      return {
        protocol: 1,
        taskPlacement: 1,
        ownerId: "owner",
        epoch: "epoch",
        version: "1",
        platform: "linux",
        profile: { name: "normal", model: "fixture", auth: "configured" },
      };
    if (req.op === "launch") {
      launches++;
      return {
        task: {
          taskId: req.taskId,
          state: "accepted",
          profile: { name: (req.placement as any)?.profile ?? "normal" },
          placement: req.placement,
        },
      };
    }
    if (req.op === "events") return { events: [] };
    if (req.op === "status") return { task: { taskId: req.taskId, state: "running" } };
    if (req.op === "cancel") return { task: { taskId: req.taskId, state: "cancelled" } };
    throw Error("unexpected fixture op " + req.op);
  });
  await client.connect("box");
  let dispatches = 0;
  const launcher: RepositoryLauncher = async (c, args) => {
    dispatches++;
    expect(args.preparedSnapshot).toBeDefined();
    await c.launch(
      "/fixture/checkout",
      args.prompt,
      args.taskId,
      undefined,
      args.jobSessionFile,
      args.placement,
      args.jobQuestionOwner,
    );
    return (await c.read()).tasks[args.taskId]!;
  };
  const request: SshLaunchRequest = {
    taskId: f.intent.taskId,
    target: "box",
    jobSessionFile: f.file,
    localRoot: f.root,
    prompt: "work",
    placement: f.intent.placement as SshLaunchRequest["placement"],
    source: { includeUntracked: ["new.txt"] },
  };
  return {
    ...f,
    client,
    launcher,
    request,
    adapter: createRemoteJobsAdapter(client, launcher, f.service),
    offline: (v: boolean) => {
      offline = v;
    },
    counts: () => ({ transportCalls, launches, dispatches }),
  };
}
test("normal jobs track pending source permission, inspect and cancel without remote acceptance", async () => {
  const f = await adapterFixture();
  f.appendObservation("execute-target-discovery");
  const before = f.counts();
  const pending = await f.adapter.launch(f.request, f.ctx);
  expect(pending.outcome).toBe("not-dispatched");
  expect(pending.status).toBe("unknown");
  expect(pending.sourceApproval?.state).toBe("waiting");
  expect(f.counts()).toEqual(before);
  expect((await f.client.read()).tasks).toEqual({});
  expect((await f.adapter.list(f.file))[0]?.id).toBe(sshJobId(f.intent.taskId));
  expect((await f.adapter.inspect(f.file, pending.id)).output).toContain("/questions");
  await expect(f.adapter.stop("other-parent", pending.id)).rejects.toThrow("ownership");
  expect((await f.adapter.stop(f.file, pending.id)).status).toBe("cancelled");
  expect(f.counts()).toEqual(before);
  expect((await f.adapter.launch(f.request, f.ctx)).status).toBe("cancelled");
  expect(f.counts().dispatches).toBe(0);
});
test("offline restart reuses exact pinned task ID and intent; uncertain accepted run cannot duplicate", async () => {
  const f = await adapterFixture();
  await f.adapter.launch(f.request, f.ctx);
  await approve(f, SOURCE_CHOICES[0]);
  f.offline(true);
  const retry = { ...f.request, source: { includeUntracked: ["new.txt"], retryTaskId: f.request.taskId } };
  const uncertain = await createRemoteJobsAdapter(f.client, f.launcher).launch(retry, f.ctx);
  expect(uncertain.id).toBe(sshJobId(f.request.taskId));
  expect(uncertain.outcome).toBe("unknown");
  expect(Object.keys((await f.client.read()).tasks)).toEqual([f.request.taskId]);
  f.offline(false);
  const result = await createRemoteJobsAdapter(f.client, f.launcher).launch(retry, f.ctx);
  expect(result.id).toBe(uncertain.id);
  expect(f.counts().launches).toBe(1);
  expect(Object.keys((await f.client.read()).tasks)).toEqual([f.request.taskId]);
});
test("stopWork cancels all pending source questions locally even offline", async () => {
  const f = await adapterFixture();
  await f.adapter.launch(f.request, f.ctx);
  f.offline(true);
  const before = f.counts();
  const result = await f.adapter.stopWork(f.file);
  expect(result.outcome).toBe("acknowledged");
  expect(result.jobs[0]?.status).toBe("cancelled");
  expect(f.counts()).toEqual(before);
});

test("JobService exposes selection not approval, passes parent context and follows up same pending ID", async () => {
  const f = await adapterFixture();
  const manager = new TaskManager(() => {});
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    undefined,
    undefined,
    f.adapter,
  );
  const ctx = { ...f.ctx, cwd: f.root } as any;
  const signal = (invocation: string) =>
    withJobRequestIdentity(new AbortController().signal, { executeInvocationId: invocation, callIndex: 1 });
  try {
    const request = { prompt: "work", target: "box", source: { includeUntracked: ["new.txt"] } };
    const pending = (await service.handle("subagent", request, ctx, signal("first"))) as any;
    expect(pending.outcome).toBe("not-dispatched");
    expect(pending.sourceApproval.questionId).toBeDefined();
    await expect(
      service.handle("subagent", { ...request, source: { ...request.source, approved: true } }, ctx, signal("spoof")),
    ).rejects.toThrow();
    await expect(
      service.handle(
        "subagent",
        { ...request, source: { ...request.source, retryTaskId: "nonexistent" } },
        ctx,
        signal("unknown"),
      ),
    ).rejects.toThrow("Unknown source approval retry");
    await expect(service.handle("subagent", { ...request, target: "local" }, ctx, signal("local"))).rejects.toThrow(
      "explicit cross-placement",
    );
    const q = f.questions.get(f.ctx, pending.sourceApproval.questionId);
    await f.questions.answer(f.ctx, { id: q.id, owner: q.owner, version: q.version, text: SOURCE_CHOICES[1] });
    f.continueParent();
    const result = (await service.handle(
      "subagent",
      { ...request, source: { ...request.source, retryTaskId: pending.sourceApproval.taskId } },
      ctx,
      signal("followup"),
    )) as any;
    expect((await f.client.read()).tasks[pending.sourceApproval.taskId]?.jobQuestionOwner).toEqual({
      sessionId: "parent",
      branchId: "root",
    });
    expect(result.id).toBe(pending.id);
    expect(result.output).toContain("all untracked files omitted");
    expect(f.counts().launches).toBe(1);
  } finally {
    await manager.shutdown();
  }
});

test("human answer stays human-owned after ordinary agent resolution", async () => {
  const f = fixture();
  await f.service.prepare(f.intent, f.ctx);
  const q = await approve(f, SOURCE_CHOICES[0]);
  await f.questions.resolve(f.ctx, {
    id: q.id,
    owner: q.owner,
    version: q.version,
    reason: "Using saved human answer",
  });
  expect((await f.service.prepare(f.intent, f.ctx)).decision).toBe("include");
});

test("approval acceptance keeps cached normal-job ordering stable", async () => {
  const f = await adapterFixture();
  const second = { ...f.request, taskId: "task_second", prompt: "second" };
  const firstResult = await f.adapter.launch(f.request, f.ctx);
  const secondResult = await f.adapter.launch(second, f.ctx);
  expect((await f.adapter.list(f.file)).map((job) => job.id)).toEqual([firstResult.id, secondResult.id]);
  const q = f.questions.get(f.ctx, secondResult.sourceApproval!.questionId!);
  await f.questions.answer(f.ctx, { id: q.id, owner: q.owner, version: q.version, text: SOURCE_CHOICES[0] });
  await f.adapter.launch(second, f.ctx);
  expect((await createRemoteJobsAdapter(f.client, f.launcher).list(f.file)).map((job) => job.id)).toEqual([
    firstResult.id,
    secondResult.id,
  ]);
});

// Target discovery and launch diagnostics may be off-branch children of the
// assistant execute anchor before source preflight asks its question.
test("source preflight at an execute anchor ignores diagnostic-only children, still needs a human", async () => {
  const f = fixture();
  f.appendObservation("target-diagnostic");
  f.appendObservation("launch-diagnostic", "target-diagnostic");
  const pending = await f.service.prepare(f.intent, f.ctx);
  expect(pending.state).toBe("waiting");
  expect(pending.decision).toBeUndefined();
  const q = f.questions.get(f.ctx, pending.questionId!);
  expect(q.owner).toEqual({ sessionId: "parent", branchId: "root" });
  expect(q.readOnly).toBe(false);
  expect(q.status).toBe("pending");
  expect(q.answeredFrom).toBeUndefined();
  expect(q.blocked?.checkpoint).toContain(f.intent.taskId);
  expect((await f.service.prepare(f.intent, f.ctx)).state).toBe("waiting");
  await approve(f, SOURCE_CHOICES[0]);
  f.continueParent();
  const ready = await f.service.prepare(f.intent, f.ctx);
  expect(ready.decision).toBe("include");
  expect(ready.questionOwner).toEqual(q.owner);
});

test("source preflight rejects real continuations even through diagnostic-only chains", async () => {
  for (const inline of [false, true]) {
    const f = fixture();
    f.appendObservation("diagnostic");
    f.appendObservation("continuation", inline ? "diagnostic" : "root", "other-bookkeeping");
    await expect(f.service.prepare(f.intent, f.ctx)).rejects.toThrow("current branch tip");
    expect(f.questions.list(f.ctx)).toEqual([]);
    expect(f.service.get(f.file, f.intent.taskId)?.questionId).toBeUndefined();
    expect(f.service.get(f.file, f.intent.taskId)?.decision).toBeUndefined();
  }
});
