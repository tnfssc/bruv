/** Drive the compiled normal CLI PTY; RPC only seeds disposable native owner tasks. */
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
    const callId = "fixture-remote-launch";
    const code =
      'console.log(await remote.launch({repoPath: "/fixture/repo", prompt: "Inspect the repository with execute and say REMOTE_FIXTURE_FINISHED_ON_OWNER"}))';
    const response = body.messages.some((m) => m.role === "tool" && m.tool_call_id === callId)
      ? { role: "assistant", content: "LOCAL_FIXTURE_ACK" }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: callId,
              type: "function",
              function: {
                name: "execute",
                arguments: JSON.stringify({ code }),
              },
            },
          ],
        };
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
        lastError?: string;
        cancelRequested?: boolean;
        replies?: Record<string, unknown>;
        repoPath: string;
        repository?: { status: string; artifact: string };
        localArtifacts?: { complete: boolean; files: Record<string, { path: string }> };
        artifactsComplete?: boolean;
        events: Array<{ event: unknown }>;
        task?: {
          state: string;
          capabilityNeeds?: unknown[];
          capabilities?: unknown[];
          questions?: Array<{
            id: string;
            text: string;
            owner: unknown;
            version: number;
            status: string;
            answer?: string;
          }>;
        };
      }
    >;
  };
const launchRpc = (cwd = home) => {
  const child = spawn(die, ["--mode", "rpc", "--provider", "fixture", "--model", "fixture-model", "--no-session"], {
    cwd,
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
          const event = JSON.parse(line);
          events.push(event);
          if (event.type === "extension_ui_request" && event.method === "confirm")
            child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: false }) + "\n");
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
        throw new Error(
          "RPC timeout " +
            label +
            "; stderr=" +
            stderr +
            "; pane=" +
            spawnSync("tmux", ["-L", "die-remote-pty-" + process.pid, "capture-pane", "-p", "-t", "remote"], {
              encoding: "utf8",
            }).stdout +
            "; events=" +
            JSON.stringify(events.slice(-4)),
        );
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
// Real tmux PTY against the same disposable native owner; no local question ledger is created.
const tmux = (...args: string[]) => {
  const result = spawnSync("tmux", ["-L", "die-remote-pty-" + process.pid, ...args], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const ownerQuestion = (taskId: string): { status: string; answer?: string } => {
  const result = spawnSync(
    "ssh",
    [
      "-F",
      process.env.FIXTURE_SSH_CONFIG!,
      "fixture-owner",
      "cat /root/.die/remote-owner/tasks/" + taskId + "/session.jsonl.questions.json",
    ],
    { encoding: "utf8", timeout: 6000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout)[0];
};
const pane = () => tmux("capture-pane", "-p", "-t", "remote");
const evidence = (name: string) => {
  const dir = process.env.DIE_REMOTE_PTY_ARTIFACTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + ".txt"), pane());
  }
};
const key = (...keys: string[]) => tmux("send-keys", "-t", "remote", ...keys);
// Capture only terminal text; the owner/RPC JSON remains available separately for machine assertions.
const historyPane = () => tmux("capture-pane", "-p", "-S", "-", "-t", "remote");
const noChatJson = (frame: string) =>
  assert(
    !/"(?:taskId|eventCount|lastAssistant|transcriptComplete|replyDelivery)"\s*:/.test(frame),
    "structured remote poll leaked into human chat\n" + frame,
  );
const command = async (text: string, expected: string) => {
  const before = historyPane().split("[die-remote]").length;
  key("C-u");
  type(text);
  // Let the real editor consume the pasted command before dispatching Enter.
  await until(text);
  await Bun.sleep(150);
  key("Enter");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const messages = historyPane().split("[die-remote]");
    if (messages.length > before && messages.at(-1)!.replace(/\s+/g, "").includes(expected.replace(/\s+/g, ""))) return;
    await Bun.sleep(100);
  }
  throw new Error("No rendered command result: " + text + "\n" + pane());
};
const type = (text: string) => tmux("send-keys", "-t", "remote", "-l", text);
const until = async (needle: string, timeout = 12000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = pane();
    if (frame.includes(needle)) return frame;
    await Bun.sleep(80);
  }
  throw Error("PTY missing " + needle + "\n" + pane());
};
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
try {
  assert.equal(spawnSync("ssh", ["-F", process.env.FIXTURE_SSH_CONFIG!, "fixture-owner", "true"]).status, 0);
  const rpc = launchRpc();
  rpc.send("/remote connect fixture-owner /usr/local/bin/die");
  await rpc.wait(() => existsSync(statePath) && !!state().connection, "remote connection");
  const launch = async (suffix: string, question = true) => {
    const before = new Set(Object.keys(state().tasks));
    rpc.send("/remote launch /fixture/repo " + (question ? "REMOTE_FIXTURE_MENU_" : "REMOTE_FIXTURE_") + suffix);
    await rpc.wait(() => Object.keys(state().tasks).some((id) => !before.has(id)), "native task launch", 30000);
    const id = Object.keys(state().tasks).find((id) => !before.has(id))!;
    if (question) await rpc.wait(() => !!state().tasks[id]?.task?.questions?.length, "native question", 30000);
    else await rpc.wait(() => state().tasks[id]?.task?.state === "running", "native running task", 30000);
    return id;
  };
  const first = await launch("CHOICE");
  const second = await launch("FREE_TEXT");
  // Spawn the compiled CLI, not a mocked picker or RPC UI. tmux owns the PTY.
  const cmd = [
    "env",
    "HOME=" + home,
    "DIE_CODING_AGENT_DIR=" + agentDir,
    die,
    "--offline",
    "--no-approve",
    "--provider",
    "fixture",
    "--model",
    "fixture-model",
  ]
    .map(quote)
    .join(" ");
  tmux("new-session", "-d", "-s", "remote", "-x", "120", "-y", "35", cmd);
  await until("REMOTE_FIXTURE_MENU_QUESTION");
  type("/remote answer ");
  await until("→ Question:");
  evidence("question-completion");
  key("Tab");
  await until("/remote answer " + first);
  key("C-u");
  type("/remote");
  key("Enter");
  await until("Remote · inbox", 20000);
  evidence("inbox");
  // Task filter must narrow the inbox without submitting either owner question.
  type("FREE_TEXT");
  key("Down");
  await until("Task: REMOTE_FIXTURE_MENU_FREE_TEXT");
  assert(pane().includes("Task: REMOTE_FIXTURE_MENU_FREE_TEXT"), "search did not expose matching task\n" + pane());
  assert(!pane().includes("Task: REMOTE_FIXTURE_MENU_CHOICE"), "search left the unrelated task visible");
  evidence("filtered-inbox");
  // Escape is navigation only: neither owner question may be answered by closing the menu.
  key("Escape");
  await Bun.sleep(200);
  assert.equal(ownerQuestion(first).status, "pending");
  assert.equal(ownerQuestion(second).status, "pending");
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  key("Enter");
  await until("→ REMOTE_FIXTURE_MENU_FIRST");
  key("Down");
  // Narrow wrapping must retain the long choice's end, not silently truncate it.
  tmux("resize-window", "-t", "remote", "-x", "50", "-y", "20");
  await Bun.sleep(180);
  assert(pane().includes("NARROW_TERMINAL"), pane());
  evidence("narrow-choice");
  key("Enter");
  await rpc.wait(
    () => ownerQuestion(first).status !== "pending" || ownerQuestion(second).status !== "pending",
    "PTY choice submitted",
    20000,
  );
  const answeredId = [first, second].find((id) => ownerQuestion(id).status !== "pending")!;
  assert(answeredId, "choice did not submit");
  const unansweredId = answeredId === first ? second : first;
  assert.equal(
    ownerQuestion(answeredId).answer,
    "REMOTE_FIXTURE_MENU_SECOND_LONG_CHOICE_WITH_TAIL_VISIBLE_ON_NARROW_TERMINAL",
  );
  await until("Remote · inbox");
  key("Enter");
  await until("→ REMOTE_FIXTURE_MENU_FIRST");
  key("Down", "Down", "Enter");
  await until("enter submit");
  type("Discarded remote draft");
  key("Escape");
  await until("→ REMOTE_FIXTURE_MENU_FIRST");
  assert.equal(ownerQuestion(unansweredId).status, "pending");
  key("Down", "Down", "Enter");
  await until("enter submit");
  type("REMOTE_FIXTURE_MENU_CONTINUED free text");
  await Bun.sleep(100);
  evidence("custom-editor");
  key("Enter");
  await rpc.wait(() => ownerQuestion(unansweredId).status !== "pending", "PTY free-text submitted", 20000);
  assert.equal(ownerQuestion(unansweredId).answer, "REMOTE_FIXTURE_MENU_CONTINUED free text");
  await until("Remote · inbox");
  key("Escape");
  const staleId = await launch("STALE");
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  key("Enter");
  await until("→ REMOTE_FIXTURE_MENU_FIRST");
  const staleQ = state().tasks[staleId]!.task!.questions![0]!;
  const stablePickerFrame = pane();
  rpc.send("/remote answer " + staleId + " " + staleQ.id + " REMOTE_FIXTURE_MENU_CONTINUED external answer");
  await rpc.wait(() => ownerQuestion(staleId).status !== "pending", "external answer creates stale picker", 20000);
  await Bun.sleep(5500); // Cross the production refresh timer while the other client changes this question.
  assert.equal(pane(), stablePickerFrame, "background refresh disturbed the open picker");
  key("Enter");
  await until("Question changed");
  evidence("stale-rejected");
  assert.equal(ownerQuestion(staleId).answer, "REMOTE_FIXTURE_MENU_CONTINUED external answer");
  await rpc.wait(() => state().tasks[answeredId]?.task?.state === "done", "native answer completion", 20000);
  await rpc.wait(
    () => historyPane().includes("REMOTE_FIXTURE_NATIVE_ANSWER_CONTINUED"),
    "readable final assistant text",
    20000,
  );
  noChatJson(historyPane());
  evidence("final-assistant");
  tmux("resize-window", "-t", "remote", "-x", "120", "-y", "35");
  type("/remote an");
  await until("→ answer");
  evidence("subcommand-completion");
  key("Tab");
  await until("/remote answer");
  key("C-u");
  type("/remote sync ");
  await until("→ Task:");
  evidence("task-completion");
  key("Tab");
  await until("/remote sync " + first);
  key("C-u");
  // This native owner job remains active for 120s. Observe multiple real 5s refreshes in
  // the compiled CLI, not just a renderer unit test or a synthetic publish call.
  const cancelled = await launch("CANCEL", false);
  await Bun.sleep(6000);
  const pollFrame = pane();
  const pollHistory = historyPane();
  assert(pollFrame.includes("remote: 1 active"), "named compact active remote status not visible\n" + pollFrame);
  noChatJson(pollHistory);
  await Bun.sleep(11000); // At least two more production timer ticks with no owner transition.
  assert.equal(pane(), pollFrame, "unchanged active polls churned the human terminal");
  assert.equal(historyPane(), pollHistory, "unchanged active polls appended chat messages");
  evidence("stable-active-polls");
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  type("REMOTE_FIXTURE_CANCEL");
  await until("Task: REMOTE_FIXTURE_CANCEL");
  key("Enter");
  await until("View cached transcript");
  type("Cancel");
  await until("→ Cancel task");
  key("Enter");
  await until("Cancel remote task?");
  key("Escape");
  await until("View cached transcript");
  assert(!state().tasks[cancelled]?.cancelRequested, "Escape requested cancellation");
  type("Cancel");
  await until("→ Cancel task");
  key("Enter");
  await until("Cancel remote task?");
  evidence("cancel-confirmation");
  key("Enter");
  await rpc.wait(() => state().tasks[cancelled]?.task?.state === "cancelled", "menu task cancellation", 20000);
  await until("View cached transcript");
  key("Escape");
  await until("Remote · inbox");
  key("Escape");
  // A real cancellation changes state once; the next two polls must not repeat it.
  await Bun.sleep(6000);
  const cancelledFrame = historyPane();
  noChatJson(cancelledFrame);
  await Bun.sleep(11000);
  assert.equal(historyPane(), cancelledFrame, "cancelled state was announced repeatedly");
  evidence("cancelled-once");
  // Explicit human commands are distinct from structured execute/RPC operations.
  await command("/remote status", "cached observations");
  await until(cancelled);
  noChatJson(historyPane());
  evidence("human-status");
  await command("/remote sync " + first, "Last synchronized state");
  await until(first);
  noChatJson(historyPane());
  evidence("human-sync");
  // Use a tall actual terminal to inspect full transcript events rather than
  // incorrectly treating the bottom viewport as the entire transcript.
  tmux("resize-window", "-t", "remote", "-x", "120", "-y", "160");
  await Bun.sleep(150);
  const finalOffset = state().tasks[unansweredId]!.events.reduce((found, row, index) => {
    const event = row.event as any;
    return event?.type === "message_end" &&
      event.message?.role === "assistant" &&
      JSON.stringify(event.message).includes("REMOTE_FIXTURE_NATIVE_ANSWER_CONTINUED")
      ? index
      : found;
  }, -1);
  assert(finalOffset >= 0, "fixture final assistant absent from source transcript");
  await command("/remote transcript " + unansweredId + " " + finalOffset, "REMOTE_FIXTURE_NATIVE_ANSWER_CONTINUED");
  const answerOffset = state().tasks[unansweredId]!.events.reduce(
    (found, row, index) => (JSON.stringify(row.event).includes("REMOTE_FIXTURE_MENU_CONTINUED") ? index : found),
    -1,
  );
  assert(answerOffset >= 0, "fixture answer absent from source transcript");
  await command("/remote transcript " + unansweredId + " " + answerOffset, "REMOTE_FIXTURE_MENU_CONTINUED");
  // Explicit transcript content can itself contain structured tool/event text. The
  // no-envelope assertions above apply to routine notices and status/sync, not to
  // arbitrary content the human explicitly requested in the transcript.
  evidence("human-transcript");
  tmux("resize-window", "-t", "remote", "-x", "120", "-y", "35");
  await Bun.sleep(150);
  // Long owner prompt must remain searchable on a narrow real terminal, without losing its tail.
  const longName = "LONG_NAME_" + "segment_".repeat(18) + "VISIBLE_TAIL";
  const longId = await launch(longName);
  tmux("resize-window", "-t", "remote", "-x", "50", "-y", "20");
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  type("VISIBLE_TAIL");
  await until("VISIBLE_TAIL");
  evidence("long-task-narrow");
  assert(pane().includes("VISIBLE_TAIL"), "long task tail hidden at narrow width");
  key("Escape");
  tmux("resize-window", "-t", "remote", "-x", "120", "-y", "35");
  // The owner and cached question identity survive a fresh compiled client process.
  const pinnedOwner = JSON.stringify(state().connection);
  tmux("kill-session", "-t", "remote");
  tmux("new-session", "-d", "-s", "remote", "-x", "120", "-y", "35", cmd);
  await until("REMOTE_FIXTURE_MENU_QUESTION", 20000);
  assert.equal(JSON.stringify(state().connection), pinnedOwner, "fresh client lost pinned owner");
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  type("VISIBLE_TAIL");
  await until("VISIBLE_TAIL");
  evidence("fresh-client-owner");
  key("Escape");
  // Keep a picker open across a separate native task's completion; it must not steal input.
  const finishing = await launch("FINISH_WHILE_MENU_OPEN", false);
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  type("FINISH_WHILE_MENU_OPEN");
  await until("Task: REMOTE_FIXTURE_FINISH_WHILE_MENU_OPEN");
  const openFrame = pane();
  await rpc.wait(() => state().tasks[finishing]?.task?.state === "done", "owner completion under menu", 25000);
  await Bun.sleep(6000);
  assert.equal(pane(), openFrame, "owner completion displaced open picker");
  evidence("completion-menu-open");
  key("Escape");
  await until("REMOTE_FIXTURE", 15000);
  // The exact historical startup replay count is separately owned by task_c7a78d5a.
  const offline = await launch("OFFLINE");
  const stopped = spawnSync("docker", ["stop", "-t", "1", container], { encoding: "utf8", timeout: 15000 });
  assert.equal(stopped.status, 0, stopped.stderr);
  await command("/remote sync " + offline, "cached");
  rpc.send("/remote sync " + offline);
  await rpc.wait(() => !!state().tasks[offline]?.lastError, "offline state", 20000);
  await rpc.wait(() => /offline|unreachable|unavailable/i.test(pane()), "offline human notice", 20000);
  assert(/offline|unreachable|unavailable/i.test(historyPane()), "offline command implied fresh owner state");
  noChatJson(historyPane().split("[die-remote]").at(-1)!);
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  type("REMOTE_FIXTURE_MENU_OFFLINE");
  await until("Answer unavailable");
  evidence("offline-inbox");
  key("Enter");
  await Bun.sleep(150);
  assert(pane().includes("Remote · inbox"), "offline answer became actionable");
  assert(!state().tasks[offline]?.replies, "offline question saved a reply");
  type("REMOTE_FIXTURE_MENU_OFFLINE");
  await until("Task: REMOTE_FIXTURE_MENU_OFFLINE");
  key("Down", "Enter");
  await until("View cached transcript");
  evidence("offline-task");
  key("Enter");
  await until("cached");
  tmux("kill-session", "-t", "remote");
  tmux("new-session", "-d", "-s", "remote", "-x", "120", "-y", "35", cmd);
  await until("remote:", 20000);
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  type("REMOTE_FIXTURE_MENU_OFFLINE");
  await until("Answer unavailable");
  evidence("offline-fresh-client");
  assert(!pane().includes("→ Answer"), "offline startup offered actionable answer");
  key("Escape");
  // Remote interaction must never create a local user-question ledger.
  const localLedgers = spawnSync("find", [home, "-name", "*.questions.json"], { encoding: "utf8" });
  assert.equal(localLedgers.status, 0, localLedgers.stderr);
  assert.equal(localLedgers.stdout.trim(), "", "remote UI wrote local user questions");
  console.log(
    "PASS compiled CLI PTY remote menu, stable active polls, readable transitions/final/status/sync/transcript, offline honesty; native Docker SSH owner questions",
  );
} finally {
  try {
    tmux("kill-server");
  } catch {}
  for (const child of rpcChildren) if (child.exitCode === null) child.kill("SIGKILL");
  provider.stop(true);
}
