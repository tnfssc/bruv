import type { FixtureRpcEvent, FixtureMessage } from "../fixtures/rpc-types";
import { requireValue } from "../lib/require-value";
import { loopbackParent, fixtureRpc } from "../fixtures/loopback-parent-fixture";
import { ownedFixtureEnv } from "../../tests/helpers/helpers";
/** Run real dist/bruv --mode rpc against isolated fake model and pinned Docker SSH host.
 * Parent completion wake is deliberately tested separately by remote-jobs-e2e.ts:
 * this proof kills its original parent before the independent owner finishes.
 */
import { type spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { strict as assert } from "node:assert";
const bruv = requireValue(process.env.BRUV_BIN);
const container = requireValue(process.env.FIXTURE_CONTAINER);
const home = homedir();
const statePath = join(home, ".bruv/remote/state.json");
const agentDir = requireValue(process.env.BRUV_CODING_AGENT_DIR);
// remote-e2e.sh owns this root and its SSH/Docker fixture settings.
const rpcEnv = ownedFixtureEnv(requireValue(process.env.FIXTURE_DROP_DIR));
rpcEnv.PATH = `${join(requireValue(process.env.FIXTURE_DROP_DIR), "bin")}:${rpcEnv.PATH}`;
rpcEnv.BRUV_CODING_AGENT_DIR = agentDir;
rpcEnv.PI_CODING_AGENT_DIR = agentDir;
rpcEnv.DOCKER_HOST = requireValue(process.env.DOCKER_HOST);
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
let localCalls = 0;
const rpcChildren: ReturnType<typeof spawn>[] = [];
const provider = loopbackParent(agentDir, () => localCalls++);
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
          questions?: Array<{ id: string; text: string; owner: unknown; version: number }>;
        };
      }
    >;
  };
const launchRepo = join(home, "launch-source");
mkdirSync(launchRepo, { recursive: true });
writeFileSync(join(launchRepo, "README.md"), "isolated placement source\n");
for (const args of [
  ["init", "-q"],
  ["add", "README.md"],
  ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base"],
]) {
  const result = spawnSync("git", ["-C", launchRepo, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
assert(!existsSync(join(home, ".git")), "HOME must not become source Git repository");
const launchRpc = (cwd = launchRepo) =>
  fixtureRpc({
    bruv,
    cwd,
    env: rpcEnv,
    children: rpcChildren,
    timeoutDetail: (events) =>
      "; events=" +
      JSON.stringify(
        events
          .filter((e) => e.type === "tool_execution_end" || (e.type === "message_end" && e.message?.role !== "system"))
          .slice(-6),
      ),
  });
const ssh = (...args: string[]) =>
  spawnSync("ssh", ["-F", requireValue(process.env.FIXTURE_SSH_CONFIG), "fixture-owner", ...args], {
    encoding: "utf8",
    timeout: 6000,
  });
function verifyPinnedSsh() {
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
    [
      "-F",
      requireValue(process.env.FIXTURE_SSH_CONFIG),
      "-o",
      `UserKnownHostsFile=${wrongKeyPath}`,
      "fixture-owner",
      "true",
    ],
    { encoding: "utf8", timeout: 6000 },
  );
  // A different known-hosts file must not authenticate this server.
  assert.notEqual(wrong.status, 0, "SSH unexpectedly trusted an unpinned host key");
}

async function proveOwnerReconnectAndQuestion() {
  const cli = launchRpc();
  cli.send("/remote connect fixture-owner /usr/local/bin/bruv");
  await cli.wait(() => existsSync(statePath) && !!state().connection, "human /remote connect");
  cli.send("REMOTE_FIXTURE_BASIC");
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
    () => requireValue(state().tasks[taskId]).task?.state === "done",
    "offline transcript sync after reconnect",
    30000,
  );
  assert(requireValue(state().tasks[taskId]).cursor > 0, "saved paginated owner events");
  const transcript = JSON.stringify(requireValue(state().tasks[taskId]).events);
  assert(transcript.includes("REMOTE_FIXTURE_WAITING_FOR_JOB"), "owner did not yield while background job ran");
  assert(transcript.includes("REMOTE_FIXTURE_EXECUTED_ON_OWNER"), "actual owner background job output absent");
  const hasFinal = (row: { event: unknown }) => {
    const event = row.event as FixtureRpcEvent;
    const content = event.message?.content;
    return (
      event.type === "message_end" &&
      event.message?.role === "assistant" &&
      Array.isArray(content) &&
      content.some((c) => c.type === "text" && c.text === "REMOTE_FIXTURE_FINISHED_ON_OWNER")
    );
  };
  assert(requireValue(state().tasks[taskId]).events.some(hasFinal), "actual owner final assistant message absent");
  // A native question is created by the real execute/questions API, not a fixture ledger.
  reconnect.send("REMOTE_FIXTURE_QUESTION");
  await reconnect.wait(() => Object.keys(state().tasks).length === 2, "native question task accepted");
  const questionId = requireValue(Object.keys(state().tasks).find((id) => id !== taskId));
  await reconnect.wait(
    () => !!requireValue(state().tasks[questionId]).task?.questions?.length,
    "automatic pending native question refresh",
    30000,
  );
  const questionTask = requireValue(state().tasks[questionId]).task;
  if (!questionTask?.questions?.length)
    console.error(
      "QUESTION DEBUG",
      ssh(
        "cat /root/.bruv/remote-owner/tasks/" +
          questionId +
          "/runtime.json; tail -c 3000 /root/.bruv/remote-owner/tasks/" +
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
  reconnect.send(
    `/remote answer ${questionId} ${requireValue(requireValue(requireValue(questionTask).questions)[0]).id} REMOTE_FIXTURE_ANSWER_ACCEPTED`,
  );
  await reconnect.wait(
    () => ssh("test -f /tmp/fixture-native-answer-finished").status === 0,
    "native answer reached owner model",
    30000,
  );
  await reconnect.wait(
    () => requireValue(state().tasks[questionId]).task?.state === "done",
    "answered remote task completion",
    30000,
  );
  assert(
    JSON.stringify(requireValue(state().tasks[questionId]).events).includes("REMOTE_FIXTURE_NATIVE_ANSWER_CONTINUED"),
    "answered owner conversation did not continue to final response",
  );
  reconnect.child.kill("SIGKILL");
  return taskId;
}

async function proveRepositoryReturnAndGrantedWork(taskId: string) {
  // Current-repo tracked dirty transfer, explicit omission, safe return and conflict artifacts.
  const localRepo = join(home, "local-repo");
  mkdirSync(localRepo);
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", localRepo, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q");
  writeFileSync(join(localRepo, "tracked.txt"), "base\n");
  git("add", "tracked.txt");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
  writeFileSync(join(localRepo, "tracked.txt"), "staged\n");
  git("add", "tracked.txt");
  writeFileSync(join(localRepo, "tracked.txt"), "dirty tracked input\n");
  writeFileSync(join(localRepo, "on-demand.txt"), "LOCAL_ON_DEMAND_CONTENT\n");
  mkdirSync(join(localRepo, ".agents", "skills", "review"), { recursive: true });
  writeFileSync(join(localRepo, ".agents", "skills", "review", "SKILL.md"), "LOCAL_REVIEW_SKILL\n");
  const originalIndex = git("ls-files", "--stage");
  let repoRpc = launchRpc(localRepo);
  const waitForTask = async (command: string, previous: Set<string>, pendingId?: string) => {
    await repoRpc.wait(
      () => Object.keys(state().tasks).some((id) => !previous.has(id)),
      "repository/capability launch accepted",
      30000,
    );
    const id = requireValue(Object.keys(state().tasks).find((id) => !previous.has(id)));
    const proof = join(home, `placement-${command}.json`);
    await repoRpc.wait(
      () =>
        existsSync(proof) &&
        JSON.parse(readFileSync(proof, "utf8")).launch.id === `ssh:${Buffer.from(id).toString("base64url")}`,
      "stable returned normal job ID",
    );
    if (pendingId)
      assert.equal(
        JSON.parse(readFileSync(proof, "utf8")).launch.id,
        pendingId,
        "source retry changed reserved job identity",
      );
    return id;
  };
  const nextTask = async (command: string) => {
    const previous = new Set(Object.keys(state().tasks));
    repoRpc.send(command);
    return waitForTask(command, previous);
  };
  const launchWithUntrackedOmission = async () => {
    const command = "REMOTE_FIXTURE_REPO_SAFE";
    const previous = new Set(Object.keys(state().tasks));
    repoRpc.send(command);
    const proof = join(home, "placement-REMOTE_FIXTURE_REPO_SAFE.json");
    await repoRpc.wait(() => existsSync(proof), "normal placement source preflight", 30000);
    const pending = JSON.parse(readFileSync(proof, "utf8")).launch;
    const pendingId = pending.id;
    assert.equal(pending.sourceApproval.state, "waiting");
    assert(pending.sourceApproval.questionId, "untracked inclusion did not ask a human question");
    assert.equal(Object.keys(state().tasks).length, previous.size, "unapproved task dispatched before human answer");
    await repoRpc.wait(() => repoRpc.events.some((e) => e.type === "agent_end"), "source parent yielded");
    repoRpc.send(`/questions answer ${pending.sourceApproval.questionId} Omit untracked files`);
    repoRpc.send(`${command} PLACEMENT_RETRY`);
    return waitForTask(command, previous, pendingId);
  };
  const safeId = await launchWithUntrackedOmission();
  await repoRpc.wait(
    () => requireValue(state().tasks[safeId]).repository?.status === "applied",
    "automatic safe repo return",
    60000,
  );
  assert.equal(readFileSync(join(localRepo, "tracked.txt"), "utf8"), "remote tracked edit\n");
  assert.equal(git("ls-files", "--stage"), originalIndex, "local staged index was changed");
  assert(
    JSON.parse(readFileSync(join(home, "placement-REMOTE_FIXTURE_REPO_SAFE.json"), "utf8")).launch.id.startsWith(
      "ssh:",
    ),
    "normal source approval retry did not preserve a tracked SSH job",
  );
  assert.equal(
    ssh(`test ! -e ${requireValue(state().tasks[safeId]).repoPath}/on-demand.txt`).status,
    0,
    "unapproved untracked content transferred",
  );
  writeFileSync(join(localRepo, "tracked.txt"), "second input\n");
  const conflictId = await nextTask("REMOTE_FIXTURE_REPO_CONFLICT");
  writeFileSync(join(localRepo, "tracked.txt"), "LOCAL_CONFLICT_PRESERVED\n");
  await repoRpc.wait(
    () => requireValue(state().tasks[conflictId]).repository?.status === "review",
    "conflicting local change retained for review",
    60000,
  );
  assert.equal(readFileSync(join(localRepo, "tracked.txt"), "utf8"), "LOCAL_CONFLICT_PRESERVED\n");
  assert.equal(git("ls-files", "--stage"), originalIndex);
  assert(
    readFileSync(requireValue(requireValue(state().tasks[conflictId]).repository).artifact, "utf8").includes(
      "remote tracked edit",
    ),
    "review artifact missing remote patch bytes",
  );
  const capabilityId = await nextTask("REMOTE_FIXTURE_CAPABILITY");
  await repoRpc.wait(
    () => !!requireValue(state().tasks[capabilityId]).task?.capabilityNeeds?.length,
    "missing capability grant surfaced",
    30000,
  );
  repoRpc.child.kill("SIGKILL");
  await new Promise((resolve) => repoRpc.child.once("exit", resolve));
  await Bun.sleep(1000);
  assert.equal(
    ssh("test ! -e /tmp/fixture-capability-finished").status,
    0,
    "capability silently ran while local client was offline/ungranted",
  );
  repoRpc = launchRpc(localRepo);
  repoRpc.send(`/remote grant ${capabilityId} repo.read tool:git-status skill:review`);
  await repoRpc.wait(
    () => requireValue(state().tasks[capabilityId]).task?.state === "done",
    "explicit local file/tool/skill grant after reconnect",
    90000,
  );
  const capabilityText = JSON.stringify(requireValue(state().tasks[capabilityId]).events);
  assert(
    capabilityText.includes("LOCAL_ON_DEMAND_CONTENT") && capabilityText.includes("LOCAL_REVIEW_SKILL"),
    "local capability tool/skill results missing from offline transcript",
  );
  const cancelledId = await nextTask("REMOTE_FIXTURE_CANCEL");
  await repoRpc.wait(
    () => ssh("test -e /tmp/fixture-cancel-started").status === 0,
    "native background job started",
    30000,
  );
  repoRpc.send("REMOTE_FIXTURE_CANCEL PLACEMENT_STOP");
  await repoRpc.wait(
    () => requireValue(state().tasks[cancelledId]).task?.state === "cancelled",
    "native remote cancellation reached stopped checkpoint",
    40000,
  );
  assert.equal(
    ssh("test ! -e /tmp/fixture-cancel-unwanted; ! kill -0 $(cat /tmp/fixture-cancel-pid) 2>/dev/null").status,
    0,
    "cancelled native shell still alive",
  );
  await repoRpc.wait(
    () => requireValue(state().tasks[capabilityId]).artifactsComplete === true,
    "offline text artifacts synchronized",
    30000,
  );
  const cachedFiles = Object.values(requireValue(state().tasks[capabilityId]).localArtifacts?.files ?? {});
  assert(cachedFiles.length, "task-owned text artifacts absent");
  assert(
    cachedFiles.some((file) => readFileSync(file.path, "utf8").includes("LOCAL_ON_DEMAND_CONTENT")),
    "cached artifacts lost complete tool text",
  );
  await repoRpc.wait(
    () => requireValue(state().tasks[taskId]).artifactsComplete === true,
    "large execute and native job text artifacts synchronized",
    30000,
  );
  const longFiles = Object.values(requireValue(state().tasks[taskId]).localArtifacts?.files ?? {});
  assert(
    longFiles.some(
      (file) =>
        file.path.endsWith("/stdout.log") &&
        readFileSync(file.path, "utf8").includes(`REMOTE_LONG_TEXT_BEGIN${"x".repeat(9000)}REMOTE_LONG_TEXT_END`),
    ),
    "complete large execute stdout was not cached separately from preview",
  );
  assert(
    longFiles.some(
      (file) =>
        file.path.includes("execute-job-") &&
        readFileSync(file.path, "utf8").includes("REMOTE_FIXTURE_EXECUTED_ON_OWNER"),
    ),
    "full native background job text was not cached before owner exit",
  );
  repoRpc.child.kill("SIGKILL");
}

async function proveOfflineTranscript(taskId: string) {
  const callsBeforeOffline = localCalls;
  const stopped = spawnSync("docker", ["stop", container], { encoding: "utf8", timeout: 15000 });
  assert.equal(stopped.status, 0, stopped.stderr);
  const offline = launchRpc();
  for (let offset = 0; offset < requireValue(state().tasks[taskId]).cursor; offset += 50)
    offline.send(`/remote transcript ${taskId} ${offset}`);
  const offlineHasFinal = () =>
    offline.events.some(
      (e) =>
        e.id === "offline-history" &&
        e.data?.messages?.some((message: FixtureMessage) => {
          if (message.customType !== "bruv-remote" || typeof message.content !== "string") return false;
          // Human transcript is readable conversation text, not the structured operations API.
          return (
            message.content.includes("REMOTE_FIXTURE_FINISHED_ON_OWNER") && !message.content.trimStart().startsWith("{")
          );
        }),
    );
  // Read the actual normal conversation history, not merely a cache file.
  for (let i = 0; i < 100; i++) {
    offline.child.stdin.write(`${JSON.stringify({ id: "offline-history", type: "get_messages" })}\n`);
    await Bun.sleep(50);
    if (offlineHasFinal()) break;
  }
  assert(
    offlineHasFinal(),
    "offline human paged transcript did not render final assistant output in normal conversation",
  );
  assert.equal(localCalls, callsBeforeOffline, "offline transcript must not call a provider");
  offline.child.kill("SIGKILL");
}

try {
  verifyPinnedSsh();
  const taskId = await proveOwnerReconnectAndQuestion();
  await proveRepositoryReturnAndGrantedWork(taskId);
  await proveOfflineTranscript(taskId);
  console.log(
    "PASS normal CLI RPC normal subagent target, human connect, pinned SSH, independent owner, automatic reconnect sync, native question answer/continuation, server-offline paged human transcript, dirty repo safe/index-preserving return and conflict review, explicit offline-waiting file/tool/skill grants, native cancellation, cached text artifacts; events=" +
      requireValue(state().tasks[taskId]).cursor,
  );
} finally {
  for (const child of rpcChildren) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  provider.stop(true);
}
