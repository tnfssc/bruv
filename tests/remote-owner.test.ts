import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("remote handshake, pinned launch, immutable intent and unknown recovery", async () => {
  const home = mkdtempSync(join(tmpdir(), "die-remote-"));
  const old = process.env.HOME;
  process.env.HOME = home;
  try {
    const { handleRemoteRequest, runOwnerTask } = await import("../src/remote/owner");
    mkdirSync(join(home, ".die"));
    writeFileSync(
      join(home, ".die", "subagents.json"),
      JSON.stringify({ normal: { model: "example/model", thinking: "low" } }),
    );
    const repo = join(home, "repo");
    mkdirSync(repo);
    mkdirSync(join(repo, ".git"));
    const hello = await handleRemoteRequest({ op: "hello" });
    if (!("ownerId" in hello)) throw Error("handshake failed");
    expect(hello.profile).toEqual({ name: "normal", model: "example/model", thinking: "low", auth: "unknown" });
    expect(await handleRemoteRequest({ op: "hello" })).toEqual(hello);
    const request = {
      op: "launch" as const,
      ownerId: hello.ownerId,
      epoch: hello.epoch,
      taskId: "task_one",
      repoPath: repo,
      prompt: "test",
    };
    const launched = await handleRemoteRequest(request, "/bin/true");
    expect("task" in launched && launched.task.profile.model).toBe("example/model");
    writeFileSync(join(home, ".die", "subagents.json"), JSON.stringify({ normal: { model: "changed/model" } }));
    expect(await handleRemoteRequest(request, "/bin/true")).toEqual(launched);
    expect(await handleRemoteRequest({ ...request, prompt: "different" })).toMatchObject({ code: "intent_conflict" });
    expect(await handleRemoteRequest({ ...request, epoch: "stale" })).toMatchObject({ code: "owner_changed" });
    await Bun.sleep(50);
    const sync = await handleRemoteRequest({
      op: "sync",
      ownerId: hello.ownerId,
      epoch: hello.epoch,
      taskId: request.taskId,
      cursor: 0,
    });
    expect("task" in sync && sync.task.state).toBe("unknown");
    expect(await handleRemoteRequest(request)).toMatchObject({ task: { state: "unknown" } });
    // Exercise the owner RPC journal with a protocol-speaking child (never a provider).
    const taskDir = join(home, ".die", "remote-owner", "tasks", request.taskId);
    const statePath = join(taskDir, "state.json");
    const saved = JSON.parse(readFileSync(statePath, "utf8"));
    saved.task.state = "accepted";
    saved.pid = process.pid;
    saved.startTime = readFileSync(`/proc/${process.pid}/stat`, "utf8").split(") ")[1].split(" ")[19];
    writeFileSync(statePath, JSON.stringify(saved));
    const rpc = join(home, "rpc.sh");
    writeFileSync(rpc, `#!/bin/sh\nread line\nprintf '{"type":"agent_end","willRetry":false}\n'\n`);
    chmodSync(rpc, 0o700);
    await runOwnerTask(request.taskId, rpc);
    const done = await handleRemoteRequest({
      op: "sync",
      ownerId: hello.ownerId,
      epoch: hello.epoch,
      taskId: request.taskId,
    });
    expect(done).toMatchObject({ task: { state: "done" }, events: [{ seq: 1, event: { type: "agent_end" } }] });
  } finally {
    process.env.HOME = old;
    rmSync(home, { recursive: true, force: true });
  }
});
