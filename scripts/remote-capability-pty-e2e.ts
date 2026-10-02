import { loopbackParent, fixtureRpc } from "./loopback-parent-fixture";
/** Drive the compiled normal CLI PTY; RPC only seeds disposable native owner tasks. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { strict as assert } from "node:assert";
const bruv = process.env.BRUV_BIN!;
const home = homedir();
const statePath = join(home, ".bruv/remote/state.json");
const agentDir = process.env.BRUV_CODING_AGENT_DIR!;
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const rpcChildren: ReturnType<typeof spawn>[] = [];
const provider = loopbackParent(agentDir);
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
const launchRpc = (cwd = launchRepo, diagnostic = false) =>
  fixtureRpc({
    bruv,
    cwd,
    home,
    agentDir,
    children: rpcChildren,
    noSession: diagnostic,
    timeoutDetail: (events) =>
      "; pane=" +
      spawnSync("tmux", ["-L", "bruv-capability-pty-" + process.pid, "capture-pane", "-p", "-t", "remote"], {
        encoding: "utf8",
      }).stdout +
      "; events=" +
      JSON.stringify(events.slice(-4)),
  });
const ssh = (...args: string[]) =>
  spawnSync("ssh", ["-F", process.env.FIXTURE_SSH_CONFIG!, "fixture-owner", ...args], {
    encoding: "utf8",
    timeout: 6000,
  });
// Real tmux PTY against the same disposable native owner; no local question ledger is created.
const tmux = (...args: string[]) => {
  const result = spawnSync("tmux", ["-L", "bruv-capability-pty-" + process.pid, ...args], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const pane = () => tmux("capture-pane", "-p", "-t", "remote");
const evidence = (name: string) => {
  const dir = process.env.BRUV_REMOTE_PTY_ARTIFACTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + ".txt"), pane());
  }
};
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

// All remote data is confined to the disposable SSH container; all grants target this test checkout.
const repo = join(home, "capability-test-repo");
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, "on-demand.txt"), "disposable fixture only\n");
assert.equal(spawnSync("git", ["init", "-q", repo]).status, 0);
assert.equal(spawnSync("git", ["-C", repo, "add", "on-demand.txt"]).status, 0);
const grantDir = join(home, ".bruv/remote/capability-grants");
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
  const rpc = launchRpc(launchRepo, true);
  rpc.send("/remote connect fixture-owner /usr/local/bin/bruv");
  await rpc.wait(() => existsSync(statePath) && !!state().connection, "owner connection");
  // The migrated agent path is independently exercised; never force owned jobs into the legacy diagnostic inbox.
  const owned = launchRpc();
  owned.send("REMOTE_FIXTURE_REPO_PROBE");
  const proof = join(home, "placement-REMOTE_FIXTURE_REPO_PROBE.json");
  await owned.wait(() => existsSync(proof), "normal agent placement", 30000);
  const launched = JSON.parse(readFileSync(proof, "utf8"));
  assert(
    launched.discovery.targets.some(
      (target: any) => target.name === "fixture-owner" && target.authorized && target.kind === "ssh",
    ),
  );
  const ownedId = Buffer.from(launched.launch.id.slice(4), "base64url").toString();
  await owned.wait(
    () => state().tasks[ownedId]?.task?.state === "done",
    "normal destination policy and shell completion",
    30000,
  );
  assert(
    JSON.stringify(state().tasks[ownedId]!.events).includes("REMOTE_REPO_TOOL_DONE"),
    "normal child did not execute on owner",
  );
  console.log(
    "PROOF normal agent jobs.targets/subagent(target): normal/depth1, delegation denied, real destination shell and terminal result",
  );
  owned.child.kill("SIGKILL");

  // Human unowned diagnostic task: legacy capability UI must remain covered, not mapped into owned jobs.
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
  assert.equal(ssh("mkdir -p /root/.bruv/remote-owner/tasks/" + id + "/capability-needs").status, 0);
  const injected = spawnSync(
    "ssh",
    [
      "-F",
      process.env.FIXTURE_SSH_CONFIG!,
      "fixture-owner",
      "cat > /root/.bruv/remote-owner/tasks/" + id + "/capability-needs/fixture_unsupported.json",
    ],
    { input: JSON.stringify(unsupported), encoding: "utf8", timeout: 6000 },
  );
  assert.equal(injected.status, 0, injected.stderr);
  rpc.send("/remote sync " + id);
  await rpc.wait(() => needs(id).some((n) => n.kind === "shell.execute"), "unsupported owner fixture surfaced");
  const cmd = [
    "env",
    "HOME=" + home,
    "BRUV_CODING_AGENT_DIR=" + agentDir,
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
  const extraFile = "/root/.bruv/remote-owner/tasks/" + id + "/capability-needs/fixture_new_request.json";
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
  const capFile = "/root/.bruv/remote-owner/tasks/" + id + "/capability-needs/fixture_cap_file.json";
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
  spawnSync("tmux", ["-L", "bruv-capability-pty-" + process.pid, "kill-server"]);
}
