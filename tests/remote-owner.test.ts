import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function handshake(profile: { model: string; thinking?: string }): string {
  const slash = profile.model.indexOf("/");
  return (
    "read line\necho '" +
    JSON.stringify({
      type: "response",
      id: "remote-config",
      success: true,
      data: {
        model: { provider: profile.model.slice(0, slash), id: profile.model.slice(slash + 1) },
        thinkingLevel: profile.thinking,
      },
    }) +
    "'\nread line\n"
  );
}

test.skipIf(process.platform !== "linux")(
  "remote handshake, pinned launch, immutable intent and unknown recovery",
  async () => {
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
      expect(await handleRemoteRequest({ op: "hello" })).toMatchObject({
        profile: { model: "changed/model", thinking: "off" },
      });
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
      writeFileSync(join(home, ".die", "subagents.json"), JSON.stringify({ normal: {} }));
      expect(await handleRemoteRequest({ ...request, taskId: "missing_default" })).toMatchObject({
        code: "missing_model",
      });
      writeFileSync(join(home, ".die", "subagents.json"), JSON.stringify({ normal: { model: "changed/model" } }));
      // Exercise the owner RPC journal with a protocol-speaking child (never a provider).
      const taskDir = join(home, ".die", "remote-owner", "tasks", request.taskId);
      const statePath = join(taskDir, "state.json");
      const saved = JSON.parse(readFileSync(statePath, "utf8"));
      saved.task.state = "accepted";
      saved.pid = process.pid;
      saved.startTime = readFileSync(`/proc/${process.pid}/stat`, "utf8").split(") ")[1].split(" ")[19];
      writeFileSync(statePath, JSON.stringify(saved));
      const rpc = join(home, "rpc.sh");
      writeFileSync(
        rpc,
        "#!/bin/sh\n" +
          handshake(saved.task.profile) +
          'echo \'{"settled":true,"activeJobs":0,"pendingMessages":false,"questions":[]}\' > "$DIE_REMOTE_RUNTIME_STATE"\necho \'{"type":"agent_settled"}\'\n',
      );
      chmodSync(rpc, 0o700);
      await runOwnerTask(request.taskId, rpc);
      const done = await handleRemoteRequest({
        op: "sync",
        ownerId: hello.ownerId,
        epoch: hello.epoch,
        taskId: request.taskId,
      });
      expect(done).toMatchObject({ task: { state: "done" } });
      expect("events" in done && done.events.at(-1)?.event).toMatchObject({ type: "agent_settled" });

      // Real RPC message_end errors must override a superficially successful agent_end.
      for (const [id, output, expected] of [
        [
          "provider_error",
          '{"type":"message_end","message":{"stopReason":"error","errorMessage":"provider unavailable"}}\n{"type":"agent_end","willRetry":false}\n',
          "provider unavailable",
        ],
        [
          "provider_abort",
          '{"type":"message_end","message":{"stopReason":"aborted"}}\n{"type":"agent_end","willRetry":false}\n',
          "aborted",
        ],
        ["rpc_oversize", "x".repeat(600_000), "RPC line limit exceeded"],
        ["model_mismatch", '{"type":"agent_settled"}\n', "different or unavailable model"],
      ] as const) {
        const req = { ...request, taskId: id, prompt: id };
        await handleRemoteRequest(req, "/bin/true");
        const dir = join(home, ".die", "remote-owner", "tasks", id);
        const path = join(dir, "state.json");
        const state = JSON.parse(readFileSync(path, "utf8"));
        state.task.state = "accepted";
        state.pid = process.pid;
        state.startTime = saved.startTime;
        writeFileSync(path, JSON.stringify(state));
        const script = join(home, id + ".sh");
        writeFileSync(
          script,
          "#!/bin/sh\n" +
            handshake(id === "model_mismatch" ? { ...state.task.profile, model: "other/model" } : state.task.profile) +
            "cat <<'RPCOUTPUT'\n" +
            output.trimEnd() +
            "\nRPCOUTPUT\n",
        );
        chmodSync(script, 0o700);
        await runOwnerTask(id, script);
        const result = await handleRemoteRequest({
          op: "sync",
          ownerId: hello.ownerId,
          epoch: hello.epoch,
          taskId: id,
        });
        expect(result).toMatchObject({ task: { state: "unknown" } });
        if ("task" in result) expect(result.task.error).toContain(expected);
        expect(await handleRemoteRequest(req)).toMatchObject({ task: { state: "unknown" } });
      }
      const questionReq = { ...request, taskId: "question_pending", prompt: "question" };
      await handleRemoteRequest(questionReq, "/bin/true");
      const questionDir = join(home, ".die", "remote-owner", "tasks", questionReq.taskId);
      const questionStatePath = join(questionDir, "state.json");
      const questionState = JSON.parse(readFileSync(questionStatePath, "utf8"));
      questionState.task.state = "accepted";
      questionState.pid = process.pid;
      questionState.startTime = saved.startTime;
      writeFileSync(questionStatePath, JSON.stringify(questionState));
      const questionRpc = join(home, "question.sh");
      writeFileSync(
        questionRpc,
        [
          "#!/bin/sh",
          'while [ "$1" != "--session" ]; do shift; done',
          'printf \'%s\' \'[{"status":"pending"}]\' > "$2.questions.json"',
          handshake(questionState.task.profile),
          'echo \'{"type":"agent_end","willRetry":false}\'',
          "",
        ].join("\n"),
      );
      chmodSync(questionRpc, 0o700);
      await runOwnerTask(questionReq.taskId, questionRpc);
      expect(
        await handleRemoteRequest({
          op: "sync",
          ownerId: hello.ownerId,
          epoch: hello.epoch,
          taskId: questionReq.taskId,
        }),
      ).toMatchObject({
        task: { state: "unknown", error: "Native question unresolved; remote answering unavailable" },
      });
      expect(
        await handleRemoteRequest({
          op: "sync",
          ownerId: hello.ownerId,
          epoch: hello.epoch,
          taskId: request.taskId,
          cursor: 99,
        }),
      ).toMatchObject({ code: "journal_gap" });
      writeFileSync(join(taskDir, "events.jsonl"), '{"seq":1,"event":');
      expect(
        await handleRemoteRequest({ op: "sync", ownerId: hello.ownerId, epoch: hello.epoch, taskId: request.taskId }),
      ).toMatchObject({ code: "journal_gap" });
      const identityPath = join(home, ".die", "remote-owner", "identity.json");
      const previousIdentity = JSON.parse(readFileSync(identityPath, "utf8"));
      writeFileSync(identityPath, JSON.stringify({ ...previousIdentity, boot: "prior-linux-boot" }));
      const restarted = await handleRemoteRequest({ op: "hello" });
      expect("epoch" in restarted && restarted.epoch).not.toBe(hello.epoch);
      expect(
        await handleRemoteRequest({ op: "sync", taskId: request.taskId, ownerId: hello.ownerId, epoch: hello.epoch }),
      ).toMatchObject({ code: "owner_changed" });
    } finally {
      process.env.HOME = old;
      rmSync(home, { recursive: true, force: true });
    }
  },
);
