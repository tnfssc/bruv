/** Run real dist/die --mode rpc against isolated fake model and pinned Docker SSH host. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { strict as assert } from "node:assert";
const die = process.env.DIE_BIN!;
const container = process.env.FIXTURE_CONTAINER!;
const home = homedir();
const statePath = join(home, ".die/remote/state.json");
const agentDir = process.env.DIE_CODING_AGENT_DIR!;
let localCalls = 0;
const rpcChildren: ReturnType<typeof spawn>[] = [];
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/chat/completions"))
      return new Response("not found", { status: 404 });
    const body = (await request.json()) as { messages: Array<{ role: string; tool_call_id?: string }> };
    const answering = body.messages.some((m) => m.role === "user" &&
      JSON.stringify(m).includes("REMOTE_FIXTURE_SEND_NATIVE_ANSWER"));
    const callId = answering ? "fixture-remote-answer" : "fixture-remote-launch";
    const question = answering
      ? Object.entries(state().tasks).find(([, task]) => task.task?.questions?.some((q) => q.text === "REMOTE_FIXTURE_NATIVE_QUESTION"))
      : undefined;
    const native = question?.[1].task?.questions?.find((q) => q.text === "REMOTE_FIXTURE_NATIVE_QUESTION");
    const code = answering
      ? `console.log(await remote.answer(${JSON.stringify(question?.[0])}, ${JSON.stringify({ id: native?.id, owner: native?.owner, version: native?.version, text: "REMOTE_FIXTURE_ANSWER_ACCEPTED" })}))`
      : 'console.log(await remote.launch({repoPath: "/fixture/repo", prompt: "Inspect the repository with execute and say REMOTE_FIXTURE_FINISHED_ON_OWNER"}))';
    const response = body.messages.some((m) => m.role === "tool" && m.tool_call_id === callId)
      ? { role: "assistant", content: "LOCAL_FIXTURE_ACK" }
      : { role: "assistant", tool_calls: [{ index: 0, id: callId, type: "function", function: {
        name: "execute", arguments: JSON.stringify({ code }),
      } }] };
    localCalls++;
    const event = (delta: object, finish_reason: string | null) => ({
      id: "local-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason }],
    });
    return new Response(
      [event(response, null), event({}, "tool_calls" in response ? "tool_calls" : "stop")]
        .map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n")
        .join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
mkdirSync(agentDir, { recursive: true });
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: "http://127.0.0.1:" + provider.port + "/v1",
        api: "openai-completions",
        apiKey: "fixture-only",
        models: [{ id: "fixture-model", name: "fixture", contextWindow: 32000, maxTokens: 1024 }],
      },
    },
  }),
);
const state = () =>
  JSON.parse(readFileSync(statePath, "utf8")) as {
    connection?: unknown;
    tasks: Record<
      string,
      {
        cursor: number;
        events: Array<{ event: unknown }>;
        task?: { state: string; questions?: Array<{ text: string; owner: unknown; version: number }> };
      }
    >;
  };
const launchRpc = () => {
  const child = spawn(die, ["--mode", "rpc", "--provider", "fixture", "--model", "fixture-model", "--no-session"], {
    cwd: home,
    env: { ...process.env, HOME: home, DIE_CODING_AGENT_DIR: agentDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  rpcChildren.push(child);
  const events: any[] = [];
  let stderr = "",
    buffer = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += String(chunk);
    for (let pos; (pos = buffer.indexOf("\n")) !== -1; ) {
      const line = buffer.slice(0, pos);
      buffer = buffer.slice(pos + 1);
      if (line) {
        try {
          events.push(JSON.parse(line));
        } catch {
          throw new Error("Invalid RPC JSON: " + line);
        }
      }
    }
  });
  const send = (message: string) => child.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n");
  const wait = async (predicate: () => boolean, label: string, limit = 20_000) => {
    const start = Date.now();
    while (!predicate()) {
      if (child.exitCode !== null) throw new Error("RPC exited while " + label + ": " + stderr);
      if (Date.now() - start > limit)
        throw new Error("RPC timeout " + label + "; stderr=" + stderr + "; events=" + JSON.stringify(events.slice(-8)));
      await Bun.sleep(40);
    }
  };
  return { child, events, send, wait, stderr: () => stderr };
};
const ssh = (...args: string[]) =>
  spawnSync("ssh", ["-F", process.env.FIXTURE_SSH_CONFIG!, "fixture-owner", ...args], {
    encoding: "utf8",
    timeout: 6000,
  });
try {
  // SSH identity must be pinned; wrong host key cannot silently become trusted.
  const pinned = ssh("true");
  assert.equal(pinned.status, 0, pinned.stderr);
  const wrongKeyPath = join(home, "wrong_known_hosts");
  writeFileSync(
    wrongKeyPath,
    "[127.0.0.1]:1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMy1tD58VMDxyLCjcHQEoiJFq93UpHzOd89Sn3AzBZTi\n",
  );
  const wrong = spawnSync(
    "ssh",
    ["-F", process.env.FIXTURE_SSH_CONFIG!, "-o", "UserKnownHostsFile=" + wrongKeyPath, "fixture-owner", "true"],
    { encoding: "utf8", timeout: 6000 },
  );
  // A different known-hosts file must not authenticate this server.
  assert.notEqual(wrong.status, 0, "SSH unexpectedly trusted an unpinned host key");
  const cli = launchRpc();
  cli.send("/remote connect fixture-owner /usr/local/bin/die");
  await cli.wait(() => existsSync(statePath) && !!state().connection, "human /remote connect");
  cli.send("Launch the already-configured remote repo with the remote execute helper");
  await cli.wait(() => Object.keys(state().tasks).length === 1, "agent remote execute launch", 30000);
  const [taskId] = Object.keys(state().tasks);
  assert(taskId);
  await cli.wait(
    () => cli.events.some((e) => e.type === "tool_execution_end" && e.toolName === "execute"),
    "real remote execute completion",
    30000,
  );
  assert(
    cli.events.some((e) => e.type === "tool_execution_end" && e.toolName === "execute" && !e.isError),
    JSON.stringify(cli.events.slice(-8)),
  );
  // Client disappears before the independent owner model finishes. No provider calls on this client afterward.
  assert.notEqual(
    ssh("test -f /tmp/fixture-owner-finished-model").status,
    0,
    "owner must still be working when client disconnects",
  );
  cli.child.kill("SIGKILL");
  await cli.wait(() => cli.child.exitCode !== null || cli.child.signalCode !== null, "client exit", 5000);
  const callsAtDisconnect = localCalls;
  assert(callsAtDisconnect <= 2, "unexpected local provider traffic");
  let ownerFinished = false;
  for (let i = 0; i < 120; i++) {
    const r = ssh("test -f /tmp/fixture-owner-finished-model");
    if (r.status === 0) {
      ownerFinished = true;
      break;
    }
    await Bun.sleep(100);
  }
  assert(ownerFinished, "owner continued after local RPC client exit");
  assert.equal(localCalls, callsAtDisconnect, "disconnected client must not make provider calls");
  const reconnect = launchRpc();
  // Reconnect should refresh active tasks without a manual sync.
  reconnect.send("/remote status");
  await reconnect.wait(
    () => state().tasks[taskId]!.task?.state === "done",
    "offline transcript sync after reconnect",
    30000,
  );
  assert(state().tasks[taskId]!.cursor > 0, "saved paginated owner events");
  const transcript = JSON.stringify(state().tasks[taskId]!.events);
  assert(transcript.includes("REMOTE_FIXTURE_WAITING_FOR_JOB"), "owner did not yield while background job ran");
  assert(transcript.includes("REMOTE_FIXTURE_EXECUTED_ON_OWNER"), "actual owner background job output absent");
  const hasFinal = (row: any) =>
    row.event?.type === "message_end" &&
    row.event?.message?.role === "assistant" &&
    row.event.message.content?.some((c: any) => c.type === "text" && c.text === "REMOTE_FIXTURE_FINISHED_ON_OWNER");
  assert(state().tasks[taskId]!.events.some(hasFinal), "actual owner final assistant message absent");
  // A native question is created by the real execute/questions API, not a fixture ledger.
  reconnect.send("/remote launch /fixture/repo REMOTE_FIXTURE_QUESTION");
  await reconnect.wait(() => Object.keys(state().tasks).length === 2, "native question task accepted");
  const questionId = Object.keys(state().tasks).find((id) => id !== taskId)!;
  for (let i = 0; i < 100 && !state().tasks[questionId]!.task?.questions?.length; i++) {
    reconnect.send("/remote sync " + questionId);
    await Bun.sleep(100);
  }
  const questionTask = state().tasks[questionId]!.task;
  if (!questionTask?.questions?.length)
    console.error(
      "QUESTION DEBUG",
      ssh(
        "cat /root/.die/remote-owner/tasks/" +
          questionId +
          "/runtime.json; tail -c 3000 /root/.die/remote-owner/tasks/" +
          questionId +
          "/events.jsonl; cat /tmp/fixture-owner-provider-requests",
      ).stdout,
    );
  assert.equal(questionTask?.state, "running", "unanswered native question must stay running");
  assert.equal(questionTask?.questions?.[0]?.text, "REMOTE_FIXTURE_NATIVE_QUESTION");
  assert(
    questionTask?.questions?.[0]?.owner && questionTask.questions[0].version > 0,
    "native question identity/version absent",
  );
  reconnect.send("REMOTE_FIXTURE_SEND_NATIVE_ANSWER");
  await reconnect.wait(
    () => reconnect.events.some((e) => e.type === "tool_execution_end" && e.toolName === "execute" && !e.isError &&
      JSON.stringify(e).includes("REMOTE_FIXTURE_ANSWER_ACCEPTED")),
    "native targeted answer from client execute", 30000,
  );
  await reconnect.wait(() => ssh("test -f /tmp/fixture-native-answer-finished").status === 0,
    "native answer reached owner model", 30000);
  await reconnect.wait(() => state().tasks[questionId]!.task?.state === "done", "answered remote task completion", 30000);
  assert(JSON.stringify(state().tasks[questionId]!.events).includes("REMOTE_FIXTURE_NATIVE_ANSWER_CONTINUED"),
    "answered owner conversation did not continue to final response");
  reconnect.child.kill("SIGKILL");
  const callsBeforeOffline = localCalls;
  const stopped = spawnSync("docker", ["stop", container], { encoding: "utf8", timeout: 15000 });
  assert.equal(stopped.status, 0, stopped.stderr);
  const offline = launchRpc();
  for (let offset = 0; offset < state().tasks[taskId]!.cursor; offset += 50)
    offline.send("/remote transcript " + taskId + " " + offset);
  const offlineHasFinal = () =>
    offline.events.some(
      (e) =>
        e.id === "offline-history" &&
        e.data?.messages?.some((message: any) => {
          if (message.customType !== "die-remote" || typeof message.content !== "string") return false;
          try {
            return JSON.parse(message.content).events?.some(hasFinal);
          } catch {
            return false;
          }
        }),
    );
  // Read the actual normal conversation history, not merely a cache file.
  for (let i = 0; i < 100; i++) {
    offline.child.stdin.write(JSON.stringify({ id: "offline-history", type: "get_messages" }) + "\n");
    await Bun.sleep(50);
    if (offlineHasFinal()) break;
  }
  assert(
    offlineHasFinal(),
    "offline human paged transcript did not render final assistant output in normal conversation",
  );
  assert.equal(localCalls, callsBeforeOffline, "offline transcript must not call a provider");
  offline.child.kill("SIGKILL");
  console.log(
    "PASS normal CLI RPC agent remote execute helper, human connect, pinned SSH, independent owner, automatic reconnect sync, native question answer/continuation, server-offline paged human transcript; events=" +
      state().tasks[taskId]!.cursor,
  );
} finally {
  for (const child of rpcChildren) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  provider.stop(true);
}
