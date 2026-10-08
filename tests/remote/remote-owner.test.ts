import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteResponse, RemoteTask } from "../../src/remote/protocol";

type Owner = typeof import("../../src/remote/owner");
type Hello = Extract<RemoteResponse, { ownerId: string }>;

// The shipped control and runner entry points share HOME-backed durable state.
// Import after setting HOME, with a private module instance even if another suite
// imported root-owner first. All running owners must be joined inside the callback.
async function withOwner(run: (home: string, repo: string, owner: Owner, hello: Hello) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "bruv-remote-"));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    mkdirSync(join(home, ".bruv"));
    writeFileSync(
      join(home, ".bruv", "subagents.json"),
      JSON.stringify({ normal: { model: "example/model", thinking: "low" } }),
    );
    const repo = join(home, "repo");
    mkdirSync(repo);
    mkdirSync(join(repo, ".git"));
    const module = "../../src/remote/owner";
    const owner = (await import(module + "?fixture=" + encodeURIComponent(home))) as Owner;
    const hello = await owner.handleRemoteRequest({ op: "hello" });
    if (!("ownerId" in hello)) throw new Error("Handshake failed");
    await run(home, repo, owner, hello);
  } finally {
    process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  }
}

// /bin/true launch establishes the durable intent but cannot run the owner.
// Claim the recorded PID/start time here to exercise runOwnerTask's real guard,
// without inheriting identity or state from another scenario.
function claimTask(home: string, taskId: string): RemoteTask["profile"] {
  const statePath = join(home, ".bruv", "remote-owner", "tasks", taskId, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.task.state = "accepted";
  state.pid = process.pid;
  state.startTime = readFileSync(`/proc/${process.pid}/stat`, "utf8").split(") ")[1]!.split(" ")[19];
  writeFileSync(statePath, JSON.stringify(state));
  return state.task.profile;
}

function rpcScript(home: string, name: string, body: string): string {
  const path = join(home, name + ".sh");
  writeFileSync(path, "#!/bin/sh\n" + body);
  chmodSync(path, 0o700);
  return path;
}

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
  "owner identity pins launch intent, recovers lost owners and rotates boot epoch",
  async () => {
    await withOwner(async (home, repo, { handleRemoteRequest }, hello) => {
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
      writeFileSync(join(home, ".bruv", "subagents.json"), JSON.stringify({ normal: { model: "changed/model" } }));
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
      writeFileSync(join(home, ".bruv", "subagents.json"), JSON.stringify({ normal: {} }));
      expect(await handleRemoteRequest({ ...request, taskId: "missing_default" })).toMatchObject({
        code: "missing_model",
      });
      writeFileSync(join(home, ".bruv", "subagents.json"), JSON.stringify({ normal: { model: "changed/model" } }));
      const identityPath = join(home, ".bruv", "remote-owner", "identity.json");
      const previousIdentity = JSON.parse(readFileSync(identityPath, "utf8"));
      writeFileSync(identityPath, JSON.stringify({ ...previousIdentity, boot: "prior-linux-boot" }));
      const restarted = await handleRemoteRequest({ op: "hello" });
      expect("epoch" in restarted && restarted.epoch).not.toBe(hello.epoch);
      expect(
        await handleRemoteRequest({ op: "sync", taskId: request.taskId, ownerId: hello.ownerId, epoch: hello.epoch }),
      ).toMatchObject({ code: "owner_changed" });
    });
  },
);

test.skipIf(process.platform !== "linux")(
  "placement selects destination roles and enforces workspace and depth authority",
  async () => {
    await withOwner(async (home, repo, { handleRemoteRequest, runOwnerTask }, hello) => {
      const request = {
        op: "launch" as const,
        ownerId: hello.ownerId,
        epoch: hello.epoch,
        taskId: "task_one",
        repoPath: repo,
        prompt: "test",
      };
      // Destination selects the requested role, never a normal-profile fallback.
      writeFileSync(
        join(home, ".bruv", "subagents.json"),
        JSON.stringify({
          normal: { model: "changed/model" },
          fast: { model: "example/fast" },
          orchestrator: { model: "example/orchestrator" },
        }),
      );
      expect(
        await handleRemoteRequest(
          {
            ...request,
            taskId: "no_isolation",
            placement: { profile: "normal", parentDepth: 0, workspace: { kind: "inherit" } },
          },
          "/bin/true",
        ),
      ).toMatchObject({ code: "repository_required" });
      const wrongDir = join(home, ".bruv", "remote-owner", "tasks", "wrong_workspace");
      mkdirSync(wrongDir);
      writeFileSync(
        join(wrongDir, "repository-ready.json"),
        JSON.stringify({ checkout: repo, workspace: { kind: "inherit" } }),
      );
      expect(
        await handleRemoteRequest(
          {
            ...request,
            taskId: "wrong_workspace",
            placement: { profile: "normal", parentDepth: 0, workspace: { kind: "worktree", branch: "isolated" } },
          },
          "/bin/true",
        ),
      ).toMatchObject({ code: "workspace_conflict" });
      for (const role of ["fast", "normal", "orchestrator"] as const) {
        const placement = { profile: role, parentDepth: 0, workspace: { kind: "inherit" as const } };
        const req = { ...request, taskId: "placed_" + role, placement };
        const preparedDir = join(home, ".bruv", "remote-owner", "tasks", req.taskId);
        mkdirSync(preparedDir);
        writeFileSync(
          join(preparedDir, "repository-ready.json"),
          JSON.stringify({ checkout: repo, workspace: placement.workspace }),
        );
        const accepted = await handleRemoteRequest(req, "/bin/true");
        expect(accepted).toMatchObject({ task: { profile: { name: role }, placement } });
        expect(
          await handleRemoteRequest({
            ...req,
            placement: { ...placement, parentDepth: 1, parentType: "orchestrator" },
          }),
        ).toMatchObject({ code: "intent_conflict" });
        const profile = claimTask(home, req.taskId);
        const envFile = join(home, req.taskId + ".env");
        const script = rpcScript(
          home,
          req.taskId,
          handshake(profile) +
            'printf "%s:%s" "$BRUV_SUBAGENT_TYPE" "$BRUV_SUBAGENT_DEPTH" > "' +
            envFile +
            '"\n' +
            `echo '{"jobs":[]}' > "$BRUV_REMOTE_RUNTIME_STATE"\necho '{"type":"agent_settled"}'\n`,
        );
        await runOwnerTask(req.taskId, script);
        expect(readFileSync(envFile, "utf8")).toBe(role + ":1");
      }
      for (const placement of [
        { profile: "normal", parentDepth: 1, parentType: "normal" },
        { profile: "normal", parentDepth: 1, parentType: "fast" },
        { profile: "normal", parentDepth: 2, parentType: "orchestrator" },
        { profile: "normal", parentDepth: -1 },
      ]) {
        expect(
          await handleRemoteRequest(
            {
              ...request,
              taskId: "forbidden_role",
              placement: { ...placement, workspace: { kind: "inherit" } },
            } as any,
            "/bin/true",
          ),
        ).toMatchObject({ code: "invalid_placement" });
      }
      const nested = {
        ...request,
        taskId: "nested_role",
        placement: {
          profile: "fast" as const,
          parentDepth: 1,
          parentType: "orchestrator" as const,
          workspace: { kind: "inherit" as const },
        },
      };
      const nestedDir = join(home, ".bruv", "remote-owner", "tasks", nested.taskId);
      mkdirSync(nestedDir);
      writeFileSync(
        join(nestedDir, "repository-ready.json"),
        JSON.stringify({ checkout: repo, workspace: nested.placement.workspace }),
      );
      expect(
        await handleRemoteRequest({ ...nested, model: "example/explicit", thinking: "high" }, "/bin/true"),
      ).toMatchObject({ task: { profile: { name: "fast", model: "example/explicit", thinking: "high" } } });
      writeFileSync(join(home, ".bruv", "subagents.json"), JSON.stringify({ normal: { model: "changed/model" } }));
      expect(await handleRemoteRequest({ ...nested, taskId: "missing_fast" }, "/bin/true")).toMatchObject({
        code: "missing_model",
      });
    });
  },
);

test.skipIf(process.platform !== "linux")(
  "native RPC completion requires verified settlement and a readable journal",
  async () => {
    await withOwner(async (home, repo, { handleRemoteRequest, runOwnerTask }, hello) => {
      const request = {
        op: "launch" as const,
        ownerId: hello.ownerId,
        epoch: hello.epoch,
        taskId: "task_one",
        repoPath: repo,
        prompt: "test",
      };
      await handleRemoteRequest(request, "/bin/true");
      // Accepted profile, not changed destination defaults, governs the RPC handshake.
      writeFileSync(join(home, ".bruv", "subagents.json"), JSON.stringify({ normal: { model: "changed/model" } }));
      // Exercise the owner RPC journal with a protocol-speaking child (never a provider).
      const taskDir = join(home, ".bruv", "remote-owner", "tasks", request.taskId);
      const profile = claimTask(home, request.taskId);
      const rpc = rpcScript(
        home,
        "rpc",
        handshake(profile) +
          'echo \'{"settled":true,"activeJobs":0,"pendingMessages":false,"questions":[]}\' > "$BRUV_REMOTE_RUNTIME_STATE"\necho \'{"type":"agent_settled"}\'\n',
      );
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
        const profile = claimTask(home, id);
        const script = rpcScript(
          home,
          id,
          handshake(id === "model_mismatch" ? { ...profile, model: "other/model" } : profile) +
            "cat <<'RPCOUTPUT'\n" +
            output.trimEnd() +
            "\nRPCOUTPUT\n",
        );
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
      const questionProfile = claimTask(home, questionReq.taskId);
      const questionRpc = rpcScript(
        home,
        "question",
        [
          'while [ "$1" != "--session" ]; do shift; done',
          'printf \'%s\' \'[{"status":"pending"}]\' > "$2.questions.json"',
          handshake(questionProfile),
          'echo \'{"type":"agent_end","willRetry":false}\'',
          "",
        ].join("\n"),
      );
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
    });
  },
);

test.skipIf(process.platform !== "linux")(
  "reply receipts recover unpublished slots without replacing accepted intent",
  async () => {
    await withOwner(async (home, repo, { handleRemoteRequest }, hello) => {
      const request = {
        op: "launch" as const,
        ownerId: hello.ownerId,
        epoch: hello.epoch,
        taskId: "task_one",
        repoPath: repo,
        prompt: "test",
      };
      // Native reply ingress pins the question owner/version and persists one intent;
      // retrying after a lost control response cannot replace or duplicate it.
      const replyReq = { ...request, taskId: "answer_slot", prompt: "reply" };
      await handleRemoteRequest(replyReq, "/bin/true");
      const replyDir = join(home, ".bruv", "remote-owner", "tasks", replyReq.taskId);
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
      // Simulate control-process death after its durable receipt but before command publication.
      rmSync(join(replyDir, "answer.json"));
      expect(await handleRemoteRequest(answer)).toMatchObject({
        task: { reply: { replyId: answer.replyId, status: "uncertain" } },
      });
      expect(JSON.parse(readFileSync(join(replyDir, "answer.json"), "utf8"))).toMatchObject(answer);

      // A retry may recover an unpublished slot, but must not erase an uncertain
      // dispatch marker and authorize the same native answer a second time.
      const dispatched = { ...answer, dispatch: "uncertain" };
      writeFileSync(join(replyDir, "answer.json"), JSON.stringify(dispatched));
      expect(await handleRemoteRequest(answer)).toMatchObject({ task: { reply: { status: "uncertain" } } });
      expect(JSON.parse(readFileSync(join(replyDir, "answer.json"), "utf8"))).toEqual(dispatched);

      // A delivered first answer must not permanently occupy the task's reply slot.
      let nextState = JSON.parse(readFileSync(join(replyDir, "state.json"), "utf8"));
      nextState.task.questions = [{ ...question, id: "q2" }];
      writeFileSync(join(replyDir, "state.json"), JSON.stringify(nextState));
      const second = { ...answer, id: "q2", replyId: "reply_second" };
      expect(await handleRemoteRequest(second)).toMatchObject({ code: "answer_conflict" });
      nextState.task.reply = { replyId: answer.replyId, status: "delivered" };
      writeFileSync(join(replyDir, "state.json"), JSON.stringify(nextState));
      writeFileSync(
        join(replyDir, "answers", answer.replyId + ".json"),
        JSON.stringify({ request: answer, status: "delivered" }),
      );
      expect(await handleRemoteRequest(second)).toMatchObject({
        task: { reply: { replyId: "reply_second", status: "uncertain" } },
      });
      expect(await handleRemoteRequest(answer)).toMatchObject({
        task: { reply: { replyId: answer.replyId, status: "delivered" } },
      });
      expect(JSON.parse(readFileSync(join(replyDir, "answer.json"), "utf8")).id).toBe("q2");
      nextState = JSON.parse(readFileSync(join(replyDir, "state.json"), "utf8"));
      nextState.task.state = "cancelled";
      writeFileSync(join(replyDir, "state.json"), JSON.stringify(nextState));
      expect(await handleRemoteRequest(second)).toMatchObject({ code: "not_running" });
    });
  },
);

test.skipIf(process.platform !== "linux")("mailbox dispatch requires native ledger acknowledgement", async () => {
  await withOwner(async (home, repo, { handleRemoteRequest, runOwnerTask }, hello) => {
    const request = {
      op: "launch" as const,
      ownerId: hello.ownerId,
      epoch: hello.epoch,
      taskId: "task_one",
      repoPath: repo,
      prompt: "test",
    };
    const answer = {
      op: "answer" as const,
      ownerId: hello.ownerId,
      epoch: hello.epoch,
      id: "q1",
      owner: { sessionId: "s", branchId: "b" },
      version: 2,
      text: "yes",
    };
    // Exercise the owner mailbox -> RPC command -> ledger acknowledgement, without
    // pretending stdin text is a native answer (the child here is a protocol fixture).
    const liveReq = { ...request, taskId: "question_dispatch", prompt: "ask" };
    await handleRemoteRequest(liveReq, "/bin/true");
    const liveDir = join(home, ".bruv", "remote-owner", "tasks", liveReq.taskId);
    const liveStatePath = join(liveDir, "state.json");
    const profile = claimTask(home, liveReq.taskId);
    const liveRpc = rpcScript(
      home,
      "answer-rpc",
      [
        'while [ "$1" != "--session" ]; do shift; done',
        'session="$2"',
        handshake(profile),
        'echo \'{"settled":true,"activeJobs":0,"pendingMessages":false,"questions":[{"id":"q1","status":"pending","version":2,"owner":{"sessionId":"s","branchId":"b"}}]}\' > "$BRUV_REMOTE_RUNTIME_STATE"',
        'echo \'{"type":"agent_settled"}\'',
        "read reply",
        'printf "%s" "$reply" > "' + join(liveDir, "command.json") + '"',
        'echo \'[{"id":"q1","status":"answered","replyVersion":2,"replyId":"reply_live","delivery":"delivered"}]\' > "$session.questions.json"',
        'echo \'{"type":"response","id":"remote-answer-reply_live","success":true}\'',
        'echo \'{"settled":true,"activeJobs":0,"pendingMessages":false,"questions":[]}\' > "$BRUV_REMOTE_RUNTIME_STATE"',
        'echo \'{"type":"agent_settled"}\'',
        "",
      ].join("\n"),
    );
    const running = runOwnerTask(liveReq.taskId, liveRpc);
    try {
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
    } finally {
      // A failed observation/assertion must not strand the RPC fixture on read.
      // Cancellation stops its child; joining drains publication before HOME removal.
      await handleRemoteRequest({ op: "cancel", ownerId: hello.ownerId, epoch: hello.epoch, taskId: liveReq.taskId });
      await running;
    }
  });
});

// The PID probe holds sync between its state read and dead-owner decision.
// The detached owner reaches agent_settled while sync owns the transaction lock.
test.skipIf(process.platform !== "linux")("sync cannot overwrite concurrent settled publication", async () => {
  await withOwner(async (home, repo, { handleRemoteRequest }, hello) => {
    const originalKill = process.kill;
    let child: ReturnType<typeof spawn> | undefined;
    let closed: Promise<void> | undefined;
    let spawnError: Error | undefined;
    const gate = join(home, "go");
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
      const directory = join(home, ".bruv", "remote-owner", "tasks", taskId);
      const statePath = join(directory, "state.json");
      const script = join(home, "rpc.sh");
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      writeFileSync(
        script,
        "#!/bin/sh\n" +
          handshake(state.task.profile) +
          `while [ ! -f ${JSON.stringify(join(home, "go"))} ]; do sleep 0.01; done\n` +
          `echo '{"settled":true,"activeJobs":0,"pendingMessages":false,"questions":[]}' > "$BRUV_REMOTE_RUNTIME_STATE"\n` +
          `echo '{"type":"agent_settled"}'\n`,
      );
      chmodSync(script, 0o700);
      const runner = join(home, "runner.ts");
      writeFileSync(
        runner,
        "await (await import(" +
          JSON.stringify(new URL("../../src/remote/owner.ts", import.meta.url).href) +
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
        child.once("error", (error) => {
          spawnError = error;
        });
        closed = new Promise<void>((resolve) => child!.once("close", () => resolve()));
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
        if (spawnError) throw spawnError;
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
      await closed;
      expect(child.exitCode).toBe(0);
      expect(
        await handleRemoteRequest({ op: "sync", ownerId: hello.ownerId, epoch: hello.epoch, taskId }),
      ).toMatchObject({ task: { state: "done" } });
    } finally {
      process.kill = originalKill;
      // Release the RPC fixture even when sync/assertions fail. The owner then
      // stops and joins that child itself; do not SIGKILL the owner and orphan it.
      writeFileSync(gate, "go");
      await closed;
    }
  });
});
