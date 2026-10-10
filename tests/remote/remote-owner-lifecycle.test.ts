import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerRpcOutput } from "../../src/remote/owner-rpc";

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Fixture checkpoint timed out");
    await Bun.sleep(10);
  }
}

async function withOwner(run: (fixture: Awaited<ReturnType<typeof ownerFixture>>) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "bruv-owner-lifecycle-"));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await run(await ownerFixture(home));
  } finally {
    process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  }
}

async function ownerFixture(home: string) {
  mkdirSync(join(home, ".bruv"));
  writeFileSync(join(home, ".bruv", "subagents.json"), JSON.stringify({ normal: { model: "example/model" } }));
  const repo = join(home, "repo");
  mkdirSync(repo);
  mkdirSync(join(repo, ".git"));
  const module = "../../src/remote/owner";
  const owner = (await import(
    module + "?lifecycle=" + encodeURIComponent(home)
  )) as typeof import("../../src/remote/owner");
  const hello = await owner.handleRemoteRequest({ op: "hello" });
  if (!("ownerId" in hello)) throw new Error("Handshake failed");
  const identity = { ownerId: hello.ownerId, epoch: hello.epoch };
  async function task(taskId: string, body: string) {
    await owner.handleRemoteRequest(
      { ...identity, op: "launch", taskId, repoPath: repo, prompt: "pilot" },
      "/bin/true",
    );
    const directory = join(home, ".bruv", "remote-owner", "tasks", taskId);
    const statePath = join(directory, "state.json");
    // Launch creates the durable task; /bin/true does not run it. Claim its owner
    // identity here so runOwnerTask exercises the real ownership guard in this process.
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.pid = process.pid;
    state.startTime = readFileSync("/proc/" + process.pid + "/stat", "utf8")
      .split(") ")[1]!
      .split(" ")[19];
    state.task.state = "accepted";
    writeFileSync(statePath, JSON.stringify(state));
    const executable = join(directory, "rpc.sh");
    writeFileSync(
      executable,
      `#!/bin/sh
task_directory="$(dirname "$BRUV_REMOTE_RUNTIME_STATE")"
read line
echo '{"type":"response","id":"remote-config","success":true,"data":{"model":{"provider":"example","id":"model"},"thinkingLevel":"off"}}'
read line
${body}
`,
    );
    chmodSync(executable, 0o700);
    const start = () => owner.runOwnerTask(taskId, executable);
    return {
      directory,
      state: () => JSON.parse(readFileSync(statePath, "utf8")).task,
      sync: () => owner.handleRemoteRequest({ ...identity, op: "sync", taskId }),
      start,
      // Release every scripted gate and join the owner before HOME/temp state cleanup,
      // even if an assertion fails while the native child is waiting for the test.
      async run(releaseGates: string[], exercise: (running: Promise<void>) => Promise<void>) {
        const running = start();
        try {
          await exercise(running);
        } finally {
          for (const name of releaseGates) writeFileSync(join(directory, name), "go");
          await running;
        }
      },
      answer: (replyId: string) =>
        owner.handleRemoteRequest({
          ...identity,
          op: "answer",
          taskId,
          replyId,
          id: "q",
          owner: { sessionId: "s", branchId: "b" },
          version: 2,
          text: "yes",
        }),
      cancel: () => owner.handleRemoteRequest({ ...identity, op: "cancel", taskId }),
    };
  }
  return { task, owner };
}

function checkpoint(state: object): string {
  const runtime = { settled: true, activeJobs: 0, pendingMessages: false, questions: [], ...state };
  return `echo '${JSON.stringify(runtime)}' > "$BRUV_REMOTE_RUNTIME_STATE"
echo '{"type":"agent_settled"}'`;
}
function gate(name: string): string {
  return `while [ ! -f "$task_directory/${name}" ]; do sleep 0.01; done`;
}
const question = { id: "q", status: "pending", owner: { sessionId: "s", branchId: "b" }, version: 2 };

test.skipIf(process.platform !== "linux")(
  "settlement keeps child alive for jobs, messages and human questions",
  async () => {
    await withOwner(async ({ task }) => {
      const t = await task(
        "pending_work",
        `${checkpoint({ activeJobs: 1 })}
${gate("jobs-finished")}
${checkpoint({ pendingMessages: true })}
${gate("messages-finished")}
${checkpoint({ questions: [question] })}
${gate("human-finished")}
${checkpoint({})}`,
      );
      await t.run(["jobs-finished", "messages-finished", "human-finished"], async (running) => {
        const journal = join(t.directory, "events.jsonl");
        await until(() => existsSync(journal) && readFileSync(journal, "utf8").includes("agent_settled"));
        expect(t.state().state).toBe("running");
        writeFileSync(join(t.directory, "jobs-finished"), "go");
        await until(() => readFileSync(journal, "utf8").match(/agent_settled/g)?.length === 2);
        expect(t.state().state).toBe("running");
        writeFileSync(join(t.directory, "messages-finished"), "go");
        await until(() => t.state().questions?.length === 1);
        expect(t.state()).toMatchObject({ state: "running", questions: [question] });
        writeFileSync(join(t.directory, "human-finished"), "go");
        await running;
        expect(await t.sync()).toMatchObject({ task: { state: "done", questions: [] } });
      });
    });
  },
);

test.skipIf(process.platform !== "linux")(
  "RPC success needs matching ledger proof; uncertain dispatch is not replayed",
  async () => {
    await withOwner(async ({ task }) => {
      const t = await task(
        "answer_proof",
        `${checkpoint({ questions: [question] })}
read command
printf "%s" "$command" > "$task_directory/command.json"
${gate("ack")}
# The ledger deliberately has a stale replyVersion (1, not the requested 2).
echo '[{"id":"q","status":"answered","replyVersion":1,"replyId":"reply","delivery":"delivered"}]' > "$task_directory/session.jsonl.questions.json"
echo '{"type":"response","id":"remote-answer-reply","success":true}'
${gate("finish")}
${checkpoint({})}
# stdin closes only on verified settlement. A replay would be captured here.
while read command; do echo "$command" >> "$task_directory/replayed"; done`,
      );
      await t.run(["ack", "finish"], async (running) => {
        await until(() => t.state().questions?.length === 1);
        await t.answer("reply");
        const receipt = join(t.directory, "answers", "reply.json");
        expect(JSON.parse(readFileSync(receipt, "utf8"))).toMatchObject({ status: "uncertain" });
        await until(() => existsSync(join(t.directory, "command.json")));
        expect(JSON.parse(readFileSync(join(t.directory, "answer.json"), "utf8"))).toMatchObject({
          dispatch: "uncertain",
        });
        await t.answer("reply");
        writeFileSync(join(t.directory, "ack"), "go");
        await until(() => readFileSync(join(t.directory, "events.jsonl"), "utf8").includes("remote-answer-reply"));
        writeFileSync(join(t.directory, "finish"), "go");
        await running;
        expect(await t.sync()).toMatchObject({
          task: { state: "done", reply: { replyId: "reply", status: "uncertain" } },
        });
        expect(JSON.parse(readFileSync(receipt, "utf8"))).toMatchObject({ status: "uncertain" });
        expect(existsSync(join(t.directory, "replayed"))).toBe(false);
      });
    });
  },
);

for (const settled of [true, false]) {
  test.skipIf(process.platform !== "linux")(
    "cancellation waits for child close; native report settled=" + settled,
    async () => {
      await withOwner(async ({ task }) => {
        const t = await task(
          "cancel_" + settled,
          `${checkpoint({ activeJobs: 1 })}
read command
printf "%s" "$command" > "$task_directory/cancel-command.json"
echo '${JSON.stringify({ settled })}' > "$task_directory/cancel-report.json"
while read command; do :; done
${gate("exit")}
echo closed > "$task_directory/child-exited"`,
        );
        await t.run(["exit"], async (running) => {
          let returned = false;
          void running.then(() => {
            returned = true;
          });
          await until(
            () =>
              existsSync(join(t.directory, "events.jsonl")) &&
              readFileSync(join(t.directory, "events.jsonl"), "utf8").includes("agent_settled"),
          );
          await t.cancel();
          await until(() => existsSync(join(t.directory, "cancel-report.json")));
          await Bun.sleep(300);
          expect(returned).toBe(false);
          expect(t.state().state).toBe("running");
          expect(JSON.parse(readFileSync(join(t.directory, "cancel-command.json"), "utf8"))).toMatchObject({
            message: "/bruv-remote-cancel",
          });
          writeFileSync(join(t.directory, "exit"), "go");
          await running;
          expect(existsSync(join(t.directory, "child-exited"))).toBe(true);
          expect(await t.sync()).toMatchObject({
            task: settled
              ? { state: "cancelled" }
              : {
                  state: "unknown",
                  error: "Cancel acknowledged. Native work exit not confirmed.",
                },
          });
        });
      });
    },
  );
}

test("framing accepts split/coalesced lines and keeps malformed or oversized output out", () => {
  const output = new OwnerRpcOutput(32);
  expect([...output.push('{"type":')]).toEqual([]);
  expect([...output.push('"start"}\n{"type":"end"}\n')]).toEqual([{ type: "start" }, { type: "end" }]);
  expect(output.truncated).toBe(false);
  expect(() => [...output.push("bad json\n")]).toThrow("Invalid RPC JSON output");
  expect(() => [...new OwnerRpcOutput(4).push("12345")]).toThrow("RPC line limit exceeded");
  expect(() => [...new OwnerRpcOutput(4).push("12345\n")]).toThrow("RPC line limit exceeded");
});

test("framing rejects terminated blank and whitespace JSON frames", () => {
  expect(() => [...new OwnerRpcOutput(32).push("\n")]).toThrow("Invalid RPC JSON output");
  expect(() => [...new OwnerRpcOutput(32).push(" \t\n")]).toThrow("Invalid RPC JSON output");
});

test.skipIf(process.platform !== "linux")(
  "owner error teardown waits for forced child close before publication",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "bruv-owner-error-test-"));
    try {
      const runner = join(directory, "runner.ts");
      writeFileSync(runner, readFileSync(new URL("./fixtures/remote-owner-error.ts.txt", import.meta.url)));
      const child = Bun.spawn(
        [process.execPath, runner, new URL("../../src/remote/owner.ts", import.meta.url).pathname],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const result = JSON.parse(await new Response(child.stdout).text());
      expect(await child.exited).toBe(0);
      expect(await new Response(child.stderr).text()).toBe("");
      expect(result).toMatchObject({
        childAliveAfterReturn: false,
        task: {
          state: "unknown",
          error: "Error: injected close-wait error",
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform !== "linux")("spawn failure publishes unknown only after process cleanup", async () => {
  await withOwner(async ({ task, owner }) => {
    const t = await task("missing_child", "");
    await owner.runOwnerTask("missing_child", join(t.directory, "missing-executable"));
    expect(t.state().state).toBe("unknown");
    expect(t.state().error).toContain("missing-executable");
  });
});

test.skipIf(process.platform !== "linux")(
  "owner refuses to replay a nonempty journal before spawning RPC",
  async () => {
    await withOwner(async ({ task }) => {
      const t = await task("journal_replay", 'touch "$task_directory/spawned"');
      const path = join(t.directory, "events.jsonl");
      const original = JSON.stringify({ seq: 1, event: { type: "previous-owner" } }) + "\n";
      writeFileSync(path, original);
      await t.start();
      expect(t.state()).toMatchObject({ state: "unknown", error: "Error: Existing journal; cannot replay owner" });
      expect(readFileSync(path, "utf8")).toBe(original);
      expect(existsSync(join(t.directory, "spawned"))).toBe(false);
    });
  },
);

test.skipIf(process.platform !== "linux")(
  "journal row limit includes its envelope, not just the RPC frame",
  async () => {
    await withOwner(async ({ task }) => {
      const frame = { type: "fixture", text: "" };
      frame.text = "x".repeat(512 * 1024 - Buffer.byteLength(JSON.stringify(frame)));
      const line = JSON.stringify(frame);
      const t = await task("journal_row_limit", `echo '${line}'`);
      await t.start();
      expect(t.state()).toMatchObject({
        state: "unknown",
        error: "Journal write failed: Error: RPC journal limit exceeded",
      });
      // The configuration response is durable; the rejected row is never appended.
      const rows = readFileSync(join(t.directory, "events.jsonl"), "utf8")
        .trimEnd()
        .split("\n")
        .map((row) => JSON.parse(row));
      expect(rows).toEqual([
        {
          seq: 1,
          event: {
            type: "response",
            id: "remote-config",
            success: true,
            data: { model: { provider: "example", id: "model" }, thinkingLevel: "off" },
          },
        },
      ]);
      expect(await t.sync()).toMatchObject({ task: { state: "unknown" }, events: rows, cursor: 1, hasMore: false });
    });
  },
);
