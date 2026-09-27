/** Drive the compiled normal CLI PTY; RPC only seeds disposable native owner tasks. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
            spawnSync("tmux", ["-L", "die-capability-pty-" + process.pid, "capture-pane", "-p", "-t", "remote"], {
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
  const result = spawnSync("tmux", ["-L", "die-capability-pty-" + process.pid, ...args], {
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

// All remote data is confined to the disposable SSH container; all grants target this test checkout.
const repo = join(home, "capability-test-repo");
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, "on-demand.txt"), "disposable fixture only\n");
assert.equal(spawnSync("git", ["init", "-q", repo]).status, 0);
assert.equal(spawnSync("git", ["-C", repo, "add", "on-demand.txt"]).status, 0);
const grantDir = join(home, ".die/remote/capability-grants");
const allGrants = (id: string) =>
  existsSync(grantDir)
    ? readdirSync(grantDir)
        .filter((f) => f.endsWith(".json"))
        .map(
          (f) =>
            JSON.parse(readFileSync(join(grantDir, f), "utf8")) as {
              id: string;
              taskId: string;
              repoRoot: string;
              kinds: string[];
            },
        )
        .filter((g) => g.taskId === id)
    : [];
const granted = (id: string) => allGrants(id).filter((g) => !existsSync(join(grantDir, g.id + ".revoked")));
const needs = (id: string) =>
  (state().tasks[id]?.task?.capabilityNeeds ?? []) as Array<{ id: string; kind: string; input: string }>;
const reopen = async () => {
  for (let i = 0; i < 3 && !pane().includes("Remote · inbox"); i++) {
    key("Escape");
    await Bun.sleep(120);
  }
  if (!pane().includes("Remote · inbox")) {
    type("/remote");
    key("Enter");
  }
  await until("Remote · inbox");
};
const openCapabilities = async () => {
  await reopen();
  await select("CAPABILITY_PTY");
  await until("Task · REMOTE_FIXTURE_CAPABILITY_PTY");
  await select("Local capabilities");
  await until("Local capabilities · REMOTE_FIXTURE_CAPABILITY_PTY");
};
const select = async (label: string) => {
  await Bun.sleep(150);
  key("C-u");
  type(label);
  await until("> " + label);
  await Bun.sleep(100);
  key("Enter");
  const next: Record<string, string> = {
    CAPABILITY_PTY: "Task · REMOTE_FIXTURE_CAPABILITY_PTY",
    "Local capabilities": "Local capabilities · REMOTE_FIXTURE_CAPABILITY_PTY",
    "Refresh from remote": "Remote · inbox",
    "repo.read": "HUMAN authorization required",
    "shell.execute": "Invalid capability kind; no grant sent",
    "Revoke: repo.read": "Revoke local capability",
  };
  if (next[label]) await until(next[label]!);
};
try {
  assert.equal(ssh("true").status, 0, "disposable owner unreachable");
  const rpc = launchRpc();
  rpc.send("/remote connect fixture-owner /usr/local/bin/die");
  await rpc.wait(() => existsSync(statePath) && !!state().connection, "owner connection");
  rpc.send("/remote launch /fixture/repo REMOTE_FIXTURE_CAPABILITY_PTY");
  await rpc.wait(
    () => Object.values(state().tasks).some((t) => t.task?.capabilityNeeds?.length),
    "real owner request",
    30000,
  );
  const id = Object.keys(state().tasks).find((id) => needs(id).length)!;
  assert(needs(id).some((n) => n.kind === "repo.read" && n.input === "on-demand.txt"));
  // The owner publishes arbitrary saved requests. Inject an unsupported kind *only into this disposable
  // fixture's owner ledger* to assert that rendering it never turns it into an authorizable action.
  const unsupported = { id: "fixture_unsupported", taskId: id, kind: "shell.execute", input: "rm -rf /" };
  assert.equal(ssh("mkdir -p /root/.die/remote-owner/tasks/" + id + "/capability-needs").status, 0);
  const injected = spawnSync(
    "ssh",
    [
      "-F",
      process.env.FIXTURE_SSH_CONFIG!,
      "fixture-owner",
      "cat > /root/.die/remote-owner/tasks/" + id + "/capability-needs/fixture_unsupported.json",
    ],
    { input: JSON.stringify(unsupported), encoding: "utf8", timeout: 6000 },
  );
  assert.equal(injected.status, 0, injected.stderr);
  rpc.send("/remote sync " + id);
  await rpc.wait(() => needs(id).some((n) => n.kind === "shell.execute"), "unsupported owner fixture surfaced");
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
  tmux("new-session", "-d", "-s", "remote", "-x", "120", "-y", "35", "cd " + quote(repo) + " && " + cmd);
  await until("capability request: repo.read", 20000);
  type("/remote");
  key("Enter");
  await until("Remote · inbox");
  await select("CAPABILITY_PTY");
  await until("Task · REMOTE_FIXTURE_CAPABILITY_PTY");
  await select("Local capabilities");
  await until("Local capabilities · REMOTE_FIXTURE_CAPABILITY_PTY");
  await until("Request: repo.read");
  await until("on-demand.txt");
  await until("Request: shell.execute");
  evidence("requests-and-unsupported");
  // An owner change during a displayed menu must not silently rewrite the human's current choice.
  const extra = { id: "fixture_new_request", taskId: id, kind: "tool:git-diff", input: "tracked.txt" };
  const extraFile = "/root/.die/remote-owner/tasks/" + id + "/capability-needs/fixture_new_request.json";
  assert.equal(
    spawnSync("ssh", ["-F", process.env.FIXTURE_SSH_CONFIG!, "fixture-owner", "cat > " + extraFile], {
      input: JSON.stringify(extra),
      encoding: "utf8",
      timeout: 6000,
    }).status,
    0,
  );
  await Bun.sleep(350);
  assert(!pane().includes("Request: tool:git-diff"), "open picker changed without explicit refresh");
  await reopen();
  await select("Refresh from remote");
  await until("Remote · inbox");
  await openCapabilities();
  await until("Request: tool:git-diff");
  await until("tracked.txt");
  evidence("refreshed-requests");

  // Unsupported request must be visible but must not be silently granted.
  await select("shell.execute");
  await until("Invalid capability kind; no grant sent");
  evidence("unsupported-denied");
  assert.equal(granted(id).length, 0, "unsupported kind granted");
  assert(!pane().includes("HUMAN authorization required"), "unsupported kind reached grant confirmation");
  // Re-enter after a rejected action (the command may close the picker).
  await openCapabilities();
  await select("repo.read");
  await until("HUMAN authorization required");
  await until("Local repository:");
  await until("Authority: repo.read");
  await until("Remote request: on-demand.txt");
  evidence("grant-scope");
  key("Escape");
  await Bun.sleep(200);
  assert.equal(granted(id).length, 0, "Escape granted authority");
  // A remote request can disappear while the human reads the confirmation: fail closed.
  await openCapabilities();
  await select("repo.read");
  await until("HUMAN authorization required");
  const capFile = "/root/.die/remote-owner/tasks/" + id + "/capability-needs/fixture_cap_file.json";
  const original = ssh("cat " + capFile);
  assert.equal(original.status, 0, original.stderr);
  assert.equal(ssh("rm " + capFile).status, 0);
  key("Enter");
  await until("Remote request changed; no grant sent");
  assert.equal(granted(id).length, 0, "stale remote request created a local grant");
  assert.equal(
    spawnSync("ssh", ["-F", process.env.FIXTURE_SSH_CONFIG!, "fixture-owner", "cat > " + capFile], {
      input: original.stdout,
      encoding: "utf8",
      timeout: 6000,
    }).status,
    0,
  );
  evidence("stale-request-denied");
  // Repeat and explicitly choose No, then Yes. Only Yes may create an owner grant.
  await openCapabilities();
  await select("repo.read");
  await until("HUMAN authorization required");
  key("Down", "Enter");
  await Bun.sleep(250);
  assert.equal(granted(id).length, 0, "No granted authority");
  await until("Task · REMOTE_FIXTURE_CAPABILITY_PTY");
  await openCapabilities();
  await select("repo.read");
  await until("HUMAN authorization required");
  key("Enter");
  await rpc.wait(() => granted(id).some((g) => g.kinds.includes("repo.read")), "selected kind grant", 20000);
  assert(
    granted(id).every((g) => g.kinds.every((k) => k === "repo.read")),
    "scope broadened",
  );
  await until("Task · REMOTE_FIXTURE_CAPABILITY_PTY");
  await until("Local capability granted");
  evidence("grant-result");
  await openCapabilities();
  await until("Revoke: repo.read");
  await select("Revoke: repo.read");
  await until("Revoke local capability");
  evidence("revoke-confirm");
  key("Escape");
  await Bun.sleep(200);
  assert(
    granted(id).some((g) => g.kinds.includes("repo.read")),
    "Escape revoked grant",
  );
  key("Escape");
  await until("Remote · inbox");
  await select("CAPABILITY_PTY");
  await select("Local capabilities");
  await select("Revoke: repo.read");
  await until("Revoke local capability");
  key("Enter");
  await rpc.wait(() => !granted(id).some((g) => g.kinds.includes("repo.read")), "explicit revoke", 20000);
  await until("Local capability revoked");
  evidence("revoke-result");
  console.log(
    "PASS compiled tmux/Docker remote capability human menu: request details, unsupported denial, scoped confirmation, Escape/No/Yes, revoke cancellation/confirmation",
  );
} finally {
  for (const child of rpcChildren) child.kill();
  provider.stop();
  spawnSync("tmux", ["-L", "die-capability-pty-" + process.pid, "kill-server"]);
}
