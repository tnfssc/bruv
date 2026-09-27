import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      expect(sync).toMatchObject({
        task: { state: "unknown", error: "Owner exited without durable completion; task will not be relaunched" },
      });
      expect(await handleRemoteRequest(request)).toMatchObject({ task: { state: "unknown" } });
      const override = { ...request, taskId: "explicit_profile", model: "example/override", thinking: "high" };
      expect(await handleRemoteRequest(override, "/bin/true")).toMatchObject({
        task: { profile: { model: "example/override", thinking: "high" } },
      });
      expect(await handleRemoteRequest({ ...override, model: "example/other" })).toMatchObject({
        code: "intent_conflict",
      });
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
      // Native reply ingress pins the question owner/version and persists one intent;
      // retrying after a lost control response cannot replace or duplicate it.
      const replyReq = { ...request, taskId: "answer_slot", prompt: "reply" };
      await handleRemoteRequest(replyReq, "/bin/true");
      const replyDir = join(home, ".die", "remote-owner", "tasks", replyReq.taskId);
      const replyStatePath = join(replyDir, "state.json");
      const replyState = JSON.parse(readFileSync(replyStatePath, "utf8"));
      const question = { id: "q1", owner: { sessionId: "s", branchId: "b" }, version: 2, status: "pending" };
      replyState.task.state = "running";
      replyState.task.questions = [question];
      writeFileSync(replyStatePath, JSON.stringify(replyState));
      const answer = {
        op: "answer" as const,
        ownerId: hello.ownerId,
        epoch: hello.epoch,
        taskId: replyReq.taskId,
        id: question.id,
        owner: question.owner,
        version: 2,
        text: "yes",
        replyId: "reply1",
      };
      expect(await handleRemoteRequest({ ...answer, version: 1 })).toMatchObject({ code: "stale_question" });
      expect(await handleRemoteRequest(answer)).toMatchObject({ task: { state: "running" } });
      expect(await handleRemoteRequest(answer)).toMatchObject({ task: { state: "running" } });
      expect(await handleRemoteRequest({ ...answer, text: "no" })).toMatchObject({ code: "answer_conflict" });
      expect(JSON.parse(readFileSync(join(replyDir, "answer.json"), "utf8"))).toMatchObject(answer);
      // Exercise the owner mailbox -> RPC command -> ledger acknowledgement, without
      // pretending stdin text is a native answer (the child here is a protocol fixture).
      const liveReq = { ...request, taskId: "question_dispatch", prompt: "ask" };
      await handleRemoteRequest(liveReq, "/bin/true");
      const liveDir = join(home, ".die", "remote-owner", "tasks", liveReq.taskId);
      const liveStatePath = join(liveDir, "state.json");
      const liveState = JSON.parse(readFileSync(liveStatePath, "utf8"));
      liveState.task.state = "accepted";
      liveState.pid = process.pid;
      liveState.startTime = saved.startTime;
      writeFileSync(liveStatePath, JSON.stringify(liveState));
      const liveRpc = join(home, "answer-rpc.sh");
      writeFileSync(
        liveRpc,
        [
          "#!/bin/sh",
          'while [ "$1" != "--session" ]; do shift; done',
          'session="$2"',
          handshake(liveState.task.profile),
          'echo \'{"settled":true,"activeJobs":0,"pendingMessages":false,"questions":[{"id":"q1","status":"pending","version":2,"owner":{"sessionId":"s","branchId":"b"}}]}\' > "$DIE_REMOTE_RUNTIME_STATE"',
          'echo \'{"type":"agent_settled"}\'',
          "read reply",
          'printf "%s" "$reply" > "' + join(liveDir, "command.json") + '"',
          'echo \'[{"id":"q1","status":"answered","replyVersion":2,"replyId":"reply_live","delivery":"delivered"}]\' > "$session.questions.json"',
          'echo \'{"type":"response","id":"remote-answer-reply_live","success":true}\'',
          'echo \'{"settled":true,"activeJobs":0,"pendingMessages":false,"questions":[]}\' > "$DIE_REMOTE_RUNTIME_STATE"',
          'echo \'{"type":"agent_settled"}\'',
          "",
        ].join("\n"),
      );
      chmodSync(liveRpc, 0o700);
      const running = runOwnerTask(liveReq.taskId, liveRpc);
      let observed = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = JSON.parse(readFileSync(liveStatePath, "utf8"));
        if (state.task.questions?.length) {
          observed = true;
          break;
        }
        await Bun.sleep(20);
      }
      expect(observed).toBe(true);
      const liveAnswer = { ...answer, taskId: liveReq.taskId, replyId: "reply_live" };
      expect(await handleRemoteRequest(liveAnswer)).toMatchObject({ task: { state: "running" } });
      await running;
      expect(JSON.parse(readFileSync(join(liveDir, "command.json"), "utf8")).message).toStartWith(
        "/remote-native-answer ",
      );
      expect(
        await handleRemoteRequest({ op: "sync", ownerId: hello.ownerId, epoch: hello.epoch, taskId: liveReq.taskId }),
      ).toMatchObject({ task: { state: "done", reply: { replyId: "reply_live", status: "delivered" } } });
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
        task: { state: "unknown", error: "Native question unresolved when remote session exited" },
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
      await verifyConcurrentFinish(home, repo, hello, handleRemoteRequest);
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

// The PID probe deliberately holds sync between its state read and dead-owner decision.
// The detached owner reaches agent_settled in another process while sync owns the lock.
async function verifyConcurrentFinish(
  home: string,
  repo: string,
  hello: { ownerId: string; epoch: string },
  handleRemoteRequest: typeof import("../src/remote/owner").handleRemoteRequest,
) {
  const originalKill = process.kill;
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const taskId = "concurrent_finish";
    const request = {
      op: "launch" as const,
      ownerId: hello.ownerId,
      epoch: hello.epoch,
      taskId,
      repoPath: repo,
      prompt: "test",
    };
    await handleRemoteRequest(request, "/bin/true");
    const directory = join(home, ".die", "remote-owner", "tasks", taskId);
    const statePath = join(directory, "state.json");
    const script = join(home, "rpc.sh");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    writeFileSync(
      script,
      "#!/bin/sh\n" +
        handshake(state.task.profile) +
        `while [ ! -f ${JSON.stringify(join(home, "go"))} ]; do sleep 0.01; done\n` +
        `echo '{"settled":true,"activeJobs":0,"pendingMessages":false,"questions":[]}' > "$DIE_REMOTE_RUNTIME_STATE"\n` +
        `echo '{"type":"agent_settled"}'\n`,
    );
    chmodSync(script, 0o700);
    const gate = join(home, "go");
    const runner = join(home, "runner.ts");
    writeFileSync(
      runner,
      "await (await import(" +
        JSON.stringify(new URL("../src/remote/owner.ts", import.meta.url).href) +
        ")).runOwnerTask(" +
        JSON.stringify(taskId) +
        ", " +
        JSON.stringify(script) +
        ");\n",
    );
    const stderr = openSync(join(home, "runner.stderr"), "w");
    try {
      child = spawn(process.execPath, [runner], {
        env: { ...process.env, HOME: home },
        stdio: ["ignore", "ignore", stderr],
      });
    } finally {
      closeSync(stderr);
    }
    if (!child.pid) throw new Error("owner runner did not spawn");
    state.pid = child.pid;
    state.startTime = readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ")[1]!.split(" ")[19];
    state.task.state = "accepted";
    writeFileSync(statePath, JSON.stringify(state));
    const startDeadline = Date.now() + 5000;
    while (JSON.parse(readFileSync(statePath, "utf8")).task.state !== "running") {
      if (Date.now() > startDeadline)
        throw new Error("owner did not start: " + readFileSync(join(home, "runner.stderr"), "utf8"));
      await Bun.sleep(10);
    }
    const pause = new Int32Array(new SharedArrayBuffer(4));
    let intercepted = false;
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === child!.pid && signal === 0 && !intercepted) {
        intercepted = true;
        writeFileSync(gate, "go");
        // Wait for the owner's last RPC event before allowing sync to check the PID.
        // With no shared lock the owner exits and writes done here; with the lock
        // it remains alive until sync has released the transaction.
        const deadline = Date.now() + 5000;
        while (!readFileSync(join(directory, "events.jsonl"), { flag: "a+" }).toString().includes("agent_settled")) {
          if (Date.now() > deadline)
            throw new Error("owner did not settle: " + readFileSync(join(home, "runner.stderr"), "utf8"));
          Atomics.wait(pause, 0, 0, 10);
        }
        Atomics.wait(pause, 0, 0, 300);
      }
      return originalKill(pid, signal as NodeJS.Signals);
    }) as typeof process.kill;
    const result = await handleRemoteRequest({ op: "sync", ownerId: hello.ownerId, epoch: hello.epoch, taskId });
    process.kill = originalKill;
    expect(readFileSync(join(home, "runner.stderr"), "utf8")).toBe("");
    expect(intercepted).toBe(true);
    expect(result).toMatchObject({ task: { state: "running" } });
    await new Promise<void>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("owner exited " + code))));
    });
    expect(await handleRemoteRequest({ op: "sync", ownerId: hello.ownerId, epoch: hello.epoch, taskId })).toMatchObject(
      { task: { state: "done" } },
    );
  } finally {
    process.kill = originalKill;
    if (child?.pid && child.exitCode === null) {
      try {
        originalKill(child.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
    }
  }
}
