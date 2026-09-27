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
        repoPath: string;
        repository?: { status: string; artifact: string };
        localArtifacts?: { complete: boolean; files: Record<string, { path: string }> };
        artifactsComplete?: boolean;
        events: Array<{ event: unknown }>;
        task?: {
          state: string;
          capabilityNeeds?: unknown[];
          capabilities?: unknown[];
          questions?: Array<{ id: string; text: string; owner: unknown; version: number; status: string; answer?: string }>;
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
// Real tmux PTY against the same disposable native owner; no local question ledger is created.
const tmux = (...args: string[]) => {
  const result = spawnSync("tmux", ["-L", "die-remote-pty-" + process.pid, ...args], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const ownerQuestion = (taskId: string): { status: string; answer?: string } => {
  const result = spawnSync("ssh", ["-F", process.env.FIXTURE_SSH_CONFIG!, "fixture-owner", "cat /root/.die/remote-owner/tasks/" + taskId + "/session.jsonl.questions.json"], {encoding:"utf8", timeout:6000});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout)[0];
};
const pane = () => tmux("capture-pane", "-p", "-t", "remote");
const key = (...keys: string[]) => tmux("send-keys", "-t", "remote", ...keys);
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
  const launch = async (suffix: string) => {
    const before = new Set(Object.keys(state().tasks));
    rpc.send("/remote launch /fixture/repo REMOTE_FIXTURE_MENU_" + suffix);
    await rpc.wait(() => Object.keys(state().tasks).some((id) => !before.has(id)), "native task launch", 30000);
    const id = Object.keys(state().tasks).find((id) => !before.has(id))!;
    await rpc.wait(() => !!state().tasks[id]?.task?.questions?.length, "native question", 30000);
    return id;
  };
  const first = await launch("CHOICE");
  const second = await launch("FREE_TEXT");
  // Spawn the compiled CLI, not a mocked picker or RPC UI. tmux owns the PTY.
  const cmd = ["env", "HOME=" + home, "DIE_CODING_AGENT_DIR=" + agentDir, die, "--offline", "--no-approve", "--provider", "fixture", "--model", "fixture-model"].map(quote).join(" ");
  tmux("new-session", "-d", "-s", "remote", "-x", "120", "-y", "35", cmd);
  await until("REMOTE_FIXTURE_MENU_QUESTION");
  type("/remote"); key("Enter");
  await until("REMOTE_FIXTURE_MENU_QUESTION", 20000);
  // Task filter must narrow the inbox without submitting either owner question.
  type("FREE_TEXT");
  await until("FREE_TEXT");
  assert(pane().includes(second), "search did not expose matching task");
  // Escape is navigation only: neither owner question may be answered by closing the menu.
  key("Escape");
  await Bun.sleep(200);
  assert.equal(ownerQuestion(first).status, "pending");
  assert.equal(ownerQuestion(second).status, "pending");
  type("/remote"); key("Enter");
  await until("REMOTE_FIXTURE_MENU_QUESTION");
  key("Enter");
  await until("REMOTE_FIXTURE_MENU_FIRST");
  // Narrow wrapping must retain the long choice's end, not silently truncate it.
  tmux("resize-window", "-t", "remote", "-x", "50", "-y", "20");
  await Bun.sleep(180);
  assert(pane().includes("NARROW_TERMINAL"), pane());
  key("Down", "Enter");
  await rpc.wait(() => ownerQuestion(first).status !== "pending" || ownerQuestion(second).status !== "pending", "PTY choice submitted", 20000);
  const answeredId = [first,second].find((id) => ownerQuestion(id).status !== "pending")!;
  assert(answeredId, "choice did not submit");
  const unansweredId = answeredId === first ? second : first;
  assert.equal(ownerQuestion(answeredId).answer, "REMOTE_FIXTURE_MENU_SECOND_LONG_CHOICE_WITH_TAIL_VISIBLE_ON_NARROW_TERMINAL");
  type("/remote"); key("Enter");
  await until("REMOTE_FIXTURE_MENU_QUESTION");
  key("Enter");
  await until("REMOTE_FIXTURE_MENU_FIRST");
  key("Down", "Down", "Enter");
  await until("enter submit");
  type("REMOTE_FIXTURE_MENU_CONTINUED free text"); key("Enter");
  await rpc.wait(() => ownerQuestion(unansweredId).status !== "pending", "PTY free-text submitted", 20000);
  assert.equal(ownerQuestion(unansweredId).answer, "REMOTE_FIXTURE_MENU_CONTINUED free text");
  const staleId = await launch("STALE");
  type("/remote"); key("Enter");
  await until("REMOTE_FIXTURE_MENU_QUESTION");
  key("Enter"); await until("REMOTE_FIXTURE_MENU_FIRST");
  const staleQ = state().tasks[staleId]!.task!.questions![0]!;
  rpc.send("/remote answer " + staleId + " " + staleQ.id + " REMOTE_FIXTURE_MENU_CONTINUED external answer");
  await rpc.wait(() => ownerQuestion(staleId).status !== "pending", "external answer creates stale picker", 20000);
  key("Enter");
  await until("Question changed");
  assert.equal(ownerQuestion(staleId).answer, "REMOTE_FIXTURE_MENU_CONTINUED external answer");
  type("/remote an"); key("Tab");
  await until("/remote answer");
  key("C-u");
  // Remote interaction must never create a local user-question ledger.
  const localLedgers = spawnSync("find", [home, "-name", "*.questions.json"], {encoding:"utf8"});
  assert.equal(localLedgers.status, 0, localLedgers.stderr);
  assert.equal(localLedgers.stdout.trim(), "", "remote UI wrote local user questions");
  console.log("PASS compiled CLI PTY remote menu navigation, choice, free text, narrow choice, autocomplete, cancellation; native Docker SSH owner questions");
} finally {
  try { tmux("kill-server"); } catch {}
  for (const child of rpcChildren) if (child.exitCode === null) child.kill("SIGKILL");
  provider.stop(true);
}
