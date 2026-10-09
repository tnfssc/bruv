import type { RemoteState } from "../../src/remote/client";
import type { RemoteTask } from "../../src/remote/protocol";
import type { Question } from "../../src/questions/service";
import { requireValue } from "../lib/require-value";
/** Compiled disposable owner recovery + in-app session switch. Run via remote-e2e.sh. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
const home = requireValue(process.env.HOME),
  bruv = requireValue(process.env.BRUV_BIN),
  drop = requireValue(process.env.FIXTURE_DROP_DIR);
const statePath = join(home, ".bruv/remote/state.json");
const agentDir = requireValue(process.env.BRUV_CODING_AGENT_DIR);
mkdirSync(agentDir, { recursive: true });
// Local fake coordinator acknowledges task attention; no tools, real keys, or external provider.
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    new Response(
      `${[
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture-model",
          choices: [
            { index: 0, delta: { role: "assistant", content: "FIXTURE_COORDINATOR_ACK" }, finish_reason: null },
          ],
        },
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
      ]
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join("")}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ),
});
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: `http://127.0.0.1:${provider.port}/v1`,
        api: "openai-completions",
        apiKey: "fixture-only",
        models: [{ id: "fixture-model", name: "fixture", contextWindow: 32000, maxTokens: 1024 }],
      },
    },
  }),
);
const tmuxName = `bruv-recovery-${process.pid}`;
const tmux = (...args: string[]) => {
  const r = spawnSync("tmux", ["-L", tmuxName, ...args], { encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const pane = () => tmux("capture-pane", "-p", "-t", "recovery");
const capture = (name: string) => {
  const dir = process.env.BRUV_REMOTE_PTY_ARTIFACTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.txt`), pane());
  }
};
const key = (...keys: string[]) => tmux("send-keys", "-t", "recovery", ...keys);
const type = (s: string) => {
  tmux("set-buffer", "-b", "fixture", s);
  tmux("paste-buffer", "-b", "fixture", "-t", "recovery");
  key("Enter");
};
type RecoveryState = Omit<RemoteState, "tasks"> & {
  tasks: Record<
    string,
    Omit<RemoteState["tasks"][string], "task"> & {
      task?: { taskId: string; state: string; questions?: Question[]; reply?: { replyId: string } };
    }
  >;
};
const state = (): RecoveryState => JSON.parse(readFileSync(statePath, "utf8"));
const wait = async (fn: () => boolean, label: string, ms = 30000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms)
      throw Error(
        "timeout " +
          label +
          " pane=" +
          pane() +
          " state=" +
          (existsSync(statePath) ? JSON.stringify(state()).slice(-1000) : "none"),
      );
    await Bun.sleep(80);
  }
};
const rpc = spawn(
  bruv,
  ["--mode", "rpc", "--offline", "--no-approve", "--provider", "fixture", "--model", "fixture-model", "--no-session"],
  { cwd: home, env: { ...process.env, HOME: home, BRUV_CODING_AGENT_DIR: agentDir }, stdio: ["pipe", "pipe", "pipe"] },
);
let rpcOut = "",
  rpcErr = "";
rpc.stdout.on("data", (x) => (rpcOut += x));
rpc.stderr.on("data", (x) => (rpcErr += x));
const send = (s: string) => rpc.stdin.write(`${JSON.stringify({ type: "prompt", message: s })}\n`);
const ownerQuestion = (id: string): Question => {
  const r = spawnSync(
    "/usr/bin/ssh",
    [
      "-F",
      requireValue(process.env.FIXTURE_SSH_CONFIG),
      "fixture-owner",
      `cat /root/.bruv/remote-owner/tasks/${id}/session.jsonl.questions.json`,
    ],
    { encoding: "utf8", timeout: 6000 },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout)[0];
};
const ownerSaved = (id: string): { task: RemoteTask; pid?: number; startTime?: string; boot: string } => {
  const r = spawnSync(
    "/usr/bin/ssh",
    [
      "-F",
      requireValue(process.env.FIXTURE_SSH_CONFIG),
      "fixture-owner",
      `cat /root/.bruv/remote-owner/tasks/${id}/state.json`,
    ],
    { encoding: "utf8", timeout: 6000 },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const ownerTaskIds = (): string[] => {
  const r = spawnSync(
    "/usr/bin/ssh",
    ["-F", requireValue(process.env.FIXTURE_SSH_CONFIG), "fixture-owner", "ls -1 /root/.bruv/remote-owner/tasks"],
    { encoding: "utf8", timeout: 6000 },
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split("\n").filter(Boolean).sort();
};
const launch = async (command: (s: string) => void, name: string) => {
  const before = new Set(Object.keys(state().tasks));
  command(`/remote launch /fixture/repo REMOTE_FIXTURE_MENU_${name}`);
  await wait(() => Object.keys(state().tasks).some((id) => !before.has(id)), `launch ${name}`);
  const id = requireValue(Object.keys(state().tasks).find((id) => !before.has(id)));
  await wait(() => !!state().tasks[id]?.task?.questions?.length, `question ${name}`);
  return id;
};
// Each proof keeps the accepted identity, the transport disturbance, and reconciliation together.
async function verifyLaunchRetryPreservesOwnerProcess() {
  // Discard only a genuine successful launch reply after the owner accepted it.
  // The cached uncertain intent must be retried with its original taskId.
  writeFileSync(join(drop, "drop-next-launch"), "one-shot\n");
  const beforeLaunch = new Set(Object.keys(state().tasks));
  send("/remote launch /fixture/repo REMOTE_FIXTURE_MENU_LOST_LAUNCH");
  await wait(() => existsSync(join(drop, "launch-drop-used")), "owner accepted launch before reply drop");
  const acceptedLaunch = JSON.parse(readFileSync(join(drop, "dropped-launch.json"), "utf8"));
  const launchId = acceptedLaunch.task.taskId;
  assert(!beforeLaunch.has(launchId));
  await wait(() => !!state().tasks[launchId]?.lastError, "uncertain launch persisted");
  assert.equal(state().tasks[launchId].outcome, "unknown");
  assert.match(requireValue(state().tasks[launchId].lastError), /accepted owner launch response intentionally lost/);
  await wait(() => rpcOut.includes(`Launch outcome unknown for ${launchId}`), "uncertain launch surfaced to RPC");
  await wait(
    () => !!state().tasks[launchId]?.task?.questions?.length || !!ownerSaved(launchId).pid,
    "owner native launch",
  );
  const ownerBefore = ownerSaved(launchId);
  assert(ownerBefore.pid && ownerBefore.startTime, "owner persisted native process identity");
  const idsBefore = ownerTaskIds();
  send(`/remote retry ${launchId}`);
  await wait(() => state().tasks[launchId]?.outcome === "accepted", "same taskId launch recovered");
  await wait(() => !!state().tasks[launchId]?.task?.questions?.length, "recovered native question");
  const ownerAfter = ownerSaved(launchId);
  assert.deepEqual(ownerTaskIds(), idsBefore, "retry created an extra owner task");
  assert.equal(ownerAfter.pid, ownerBefore.pid, "retry dispatched a second native process");
  assert.equal(ownerAfter.startTime, ownerBefore.startTime, "retry changed native process identity");
  assert.equal(requireValue(state().tasks[launchId].task).taskId, launchId);
  console.log(
    "accepted launch reply lost, same taskId recovered",
    launchId,
    "owner pid",
    ownerBefore.pid,
    "owner task count",
    idsBefore.length,
  );
}

async function verifyAnswerRetryPreservesReply() {
  const lost = await launch(send, "LOST_REPLY");
  const q = requireValue(requireValue(state().tasks[lost].task).questions)[0];
  writeFileSync(join(drop, "drop-next-answer"), "one-shot\n");
  send(`/remote answer ${lost} ${q.id} ACCEPTED_ON_OWNER`);
  await wait(
    () => existsSync(join(drop, "drop-used")) && !!state().tasks[lost]?.replyDelivery?.[q.id],
    "dropped accepted reply",
  );
  assert(existsSync(join(drop, "dropped-reply.json")));
  const accepted = JSON.parse(readFileSync(join(drop, "dropped-reply.json"), "utf8"));
  const replyId = requireValue(state().tasks[lost].replies)[q.id].replyId;
  assert.equal(accepted.task.reply.replyId, replyId);
  assert.equal(requireValue(state().tasks[lost].replyDelivery)[q.id].status, "uncertain");
  assert.equal(ownerQuestion(lost).answer, "ACCEPTED_ON_OWNER");
  send(`/remote sync ${lost}`);
  await wait(() => state().tasks[lost]?.task?.reply?.replyId === replyId, "sync receipt");
  send(`/remote answer ${lost} ${q.id} ACCEPTED_ON_OWNER`);
  await wait(() => state().tasks[lost]?.replyDelivery?.[q.id]?.status === "delivered", "same reply recovered");
  assert.equal(requireValue(state().tasks[lost].replies)[q.id].replyId, replyId);
  assert.equal(ownerQuestion(lost).answer, "ACCEPTED_ON_OWNER");
  console.log(
    "accepted reply lost after owner response, reconciled same replyId",
    replyId,
    "owner status",
    accepted.task.reply.status,
    "rpc",
    rpcOut.slice(-500),
  );
}

async function verifySessionSwitchPreservesTaskOwners() {
  // Run real interactive binary in tmux. PATH is explicit: fish/tmux may reset it.
  const quote = (x: string) => `'${x.replaceAll("'", "'\\''")}'`;
  const cmd = [
    "env",
    `PATH=${process.env.PATH}`,
    `HOME=${home}`,
    `BRUV_CODING_AGENT_DIR=${agentDir}`,
    bruv,
    "--offline",
    "--no-approve",
    "--provider",
    "fixture",
    "--model",
    "fixture-model",
  ]
    .map(quote)
    .join(" ");
  tmux("new-session", "-d", "-s", "recovery", "-x", "120", "-y", "35", cmd);
  await wait(() => pane().includes("fixture-model"), "interactive model ready");
  await Bun.sleep(2500); // startup notices can render before the input handler is ready
  type("/name DOGFOOD_OLD_SESSION");
  await Bun.sleep(300);
  const a = await launch(type, "SWITCH_OLD");
  await wait(() => !!state().tasks[a].jobSessionFile, "old session owner");
  const oldSession = requireValue(state().tasks[a].jobSessionFile);
  await wait(() => existsSync(oldSession), "old session journal published after fixture acknowledgement");
  const oldFrame = pane();
  capture("old-session");
  type("/new");
  await Bun.sleep(600);
  type("/name DOGFOOD_NEW_SESSION");
  await Bun.sleep(300);
  const b = await launch(type, "SWITCH_NEW");
  await wait(() => !!state().tasks[b].jobSessionFile, "new session owner");
  const newSession = requireValue(state().tasks[b].jobSessionFile);
  assert.notEqual(newSession, oldSession, "/new did not change in-app session");
  assert.equal(state().tasks[a].jobSessionFile, oldSession, "switch adopted previous task");
  const questionA = requireValue(requireValue(state().tasks[a].task).questions)[0];
  send(`/remote answer ${a} ${questionA.id} ANSWERED_OUTSIDE_NEW_SESSION`);
  await wait(() => ownerQuestion(a).answer === "ANSWERED_OUTSIDE_NEW_SESSION", "external old answer");
  await Bun.sleep(6000); // real background refresh, not a renderer unit test
  const newFrame = pane();
  capture("new-session-no-adoption");
  assert(
    !newFrame.includes("ANSWERED_OUTSIDE_NEW_SESSION") && !newFrame.includes(a),
    "old-session completion entered new session",
  );
  assert.equal(state().tasks[a].jobSessionFile, oldSession);
  assert.equal(state().tasks[b].jobSessionFile, newSession);
  const newHistory = tmux("capture-pane", "-p", "-S", "-", "-t", "recovery");
  assert(
    !newHistory.includes(a) && !newHistory.includes("ANSWERED_OUTSIDE_NEW_SESSION"),
    "old task notice entered new session scrollback",
  );
  const newMessages = readFileSync(newSession, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "message");
  assert(
    !JSON.stringify(newMessages).includes(a) && !JSON.stringify(newMessages).includes("ANSWERED_OUTSIDE_NEW_SESSION"),
    "old task notice entered new session journal",
  );
  type("/resume");
  await wait(() => pane().includes("DOGFOOD_OLD_SESSION"), "actual resume menu");
  capture("resume-picker");
  tmux("send-keys", "-t", "recovery", "-l", "DOGFOOD_OLD_SESSION");
  await Bun.sleep(250);
  key("Enter");
  await Bun.sleep(1500);
  type("/session");
  await wait(
    () =>
      pane()
        .replace(/\s/g, "")
        .includes(requireValue(oldSession.split("/").at(-1))),
    "resumed original session file",
  );
  capture("resumed-original-session");
  assert.equal(state().tasks[a].jobSessionFile, oldSession);
  assert.equal(state().tasks[b].jobSessionFile, newSession);
  console.log(
    "in-app /new owner boundaries",
    oldSession,
    newSession,
    "oldFrame",
    oldFrame.slice(-160),
    "newFrame",
    newFrame.slice(-160),
  );
}

try {
  send("/remote connect fixture-owner /usr/local/bin/bruv");
  await wait(() => existsSync(statePath) && !!state().connection, "connect");
  await verifyLaunchRetryPreservesOwnerProcess();
  await verifyAnswerRetryPreservesReply();
  // Keep RPC alive: it answers the old session task from outside the interactive session.
  await verifySessionSwitchPreservesTaskOwners();
} finally {
  rpc.kill();
  provider.stop();
  try {
    tmux("kill-server");
  } catch {}
}
