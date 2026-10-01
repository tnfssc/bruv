/** Isolated compiled CLI -> Docker SSH -> existing jobs task-complete integration proof. */
import { spawn, spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const home = homedir(),
  agentDir = process.env.BRUV_CODING_AGENT_DIR!;
// Parent CLIs are fresh roots in the isolated fixture HOME, not this test worker's role.
// Source artifacts, sessions, configuration and caches must stay outside the Git source.
assert(process.env.FIXTURE_CONTAINER && process.env.FIXTURE_PROVIDER_URL && agentDir.startsWith(home + "/"));
const repo = join(home, "repo");
const cliEnv: Record<string, string> = {
  HOME: home,
  PATH: process.env.PATH!,
  TMPDIR: process.env.TMPDIR!,
  BRUV_CODING_AGENT_DIR: agentDir,
  SHELL: "/bin/sh",
  LANG: "C.UTF-8",
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_CACHE_HOME: join(home, "cache"),
  XDG_STATE_HOME: join(home, "state"),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};
mkdirSync(repo, { recursive: true });
const git = (...args: string[]) => {
  const r = spawnSync("git", ["-C", repo, ...args], { env: cliEnv, encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 0, "fixture Git: " + r.stderr);
  return r.stdout;
};
git("init", "-q");
git("config", "user.name", "Fixture");
git("config", "user.email", "fixture@example.invalid");
writeFileSync(join(repo, "README.md"), "fixture base\n");
git("add", "README.md");
git("commit", "-qm", "initial");
// A tracked dirty edit proves placement uses current source, not the owner's pre-existing repo.
writeFileSync(join(repo, "README.md"), "REMOTE_JOBS_CURRENT_SOURCE\n");
assert(!existsSync(join(home, ".git")), "must never Git-init HOME");
const statePath = join(home, ".bruv/remote/state.json");
const clients: ReturnType<typeof spawn>[] = [];
// The only provider lives in the Docker fixture. This host process is a real CLI client.
mkdirSync(agentDir, { recursive: true });
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: process.env.FIXTURE_PROVIDER_URL!,
        api: "openai-completions",
        apiKey: "fixture-only",
        models: [{ id: "fixture-parent", name: "parent fixture", contextWindow: 32000, maxTokens: 1024 }],
      },
    },
  }),
);
const state = () =>
  JSON.parse(readFileSync(statePath, "utf8")) as {
    tasks: Record<string, { task?: { state: string }; cursor: number; jobSessionFile?: string }>;
  };
function launch(side: string, session: string) {
  const child = spawn(
    process.env.BRUV_BIN!,
    ["--mode", "rpc", "--provider", "fixture", "--model", "fixture-parent", "--session", session],
    { cwd: repo, env: cliEnv, stdio: ["pipe", "pipe", "pipe"] },
  );
  clients.push(child);
  const events: any[] = [];
  let buffer = "",
    err = "";
  child.stdout.on("data", (data: Buffer) => {
    buffer += String(data);
    for (let pos; (pos = buffer.indexOf("\n")) >= 0; ) {
      const line = buffer.slice(0, pos);
      buffer = buffer.slice(pos + 1);
      if (line) events.push(JSON.parse(line));
    }
  });
  child.stderr.on("data", (data: Buffer) => (err += String(data)));
  const send = (message: string) => child.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n");
  const wait = async (test: () => boolean, label: string, ms = 60000) => {
    const start = Date.now();
    while (!test()) {
      if (child.exitCode !== null) throw Error(side + " exited: " + err);
      if (Date.now() - start > ms)
        throw Error(
          side +
            " timed out " +
            label +
            "; stderr=" +
            err +
            "; events=" +
            JSON.stringify(events.slice(-8)) +
            "; recent=" +
            JSON.stringify(events.slice(-20)),
        );
      await Bun.sleep(100);
    }
  };
  return { child, events, send, wait };
}
const ssh = (command: string) =>
  spawnSync("ssh", ["-F", process.env.FIXTURE_SSH_CONFIG!, "fixture-owner", command], {
    encoding: "utf8",
    timeout: 6000,
  });
try {
  assert.equal(ssh("true").status, 0, "pinned fixture SSH unavailable");
  // Exercise the compiled CLI's non-interactive JSON boundary as well as its RPC lifecycle.
  const printed = spawnSync(
    process.env.BRUV_BIN!,
    [
      "--print",
      "--mode",
      "json",
      "--provider",
      "fixture",
      "--model",
      "fixture-parent",
      "--no-session",
      "REMOTE_JOBS_PRINT_BOUNDARY",
    ],
    {
      cwd: repo,
      env: cliEnv,
      encoding: "utf8",
      timeout: 30000,
    },
  );
  assert.equal(printed.status, 0, "print/json CLI failed: " + printed.stderr + printed.stdout);
  assert(printed.stdout.includes("REMOTE_JOBS_PRINT_JSON_OK"), "print/json response missing: " + printed.stdout);
  const a = launch("A", join(home, "a.jsonl")),
    b = launch("B", join(home, "b.jsonl"));
  a.send("/remote connect fixture-owner /usr/local/bin/bruv");
  await a.wait(() => existsSync(statePath) && !!JSON.parse(readFileSync(statePath, "utf8")).connection, "connect");
  a.send("REMOTE_JOBS_PROOF_A launch using execute");
  await a.wait(() => existsSync(join(home, "jobs-A.json")), "first async placement launch");
  const launchA = JSON.parse(readFileSync(join(home, "jobs-A.json"), "utf8"));
  const jobA: string = launchA.launch.id;
  const idA = Buffer.from(jobA.slice(4), "base64url").toString();
  b.send("REMOTE_JOBS_PROOF_B launch using execute");
  await b.wait(() => existsSync(join(home, "jobs-B.json")), "second async placement launch");
  const launchB = JSON.parse(readFileSync(join(home, "jobs-B.json"), "utf8"));
  const jobB: string = launchB.launch.id;
  const idB = Buffer.from(jobB.slice(4), "base64url").toString();
  assert.equal(Object.keys(state().tasks).length, 2, "placement created duplicate tasks");
  assert.equal(state().tasks[idA]?.jobSessionFile, join(home, "a.jsonl"));
  assert.equal(state().tasks[idB]?.jobSessionFile, join(home, "b.jsonl"));
  for (const result of [launchA, launchB]) {
    assert(result.discovery.targets.some((t: any) => t.name === "fixture-owner" && t.authorized && t.kind === "ssh"));
    assert.equal(result.launch.background, true);
  }
  assert(idA && idB && idA !== idB);
  for (const [client, side] of [
    [a, "A"],
    [b, "B"],
  ] as const) {
    await client.wait(
      () => client.events.some((e) => e.type === "tool_execution_end" && e.toolName === "execute" && !e.isError),
      "real execute launch",
    );
    await client.wait(
      () =>
        client.events.some(
          (e) => e.type === "message_end" && JSON.stringify(e).includes("REMOTE_JOBS_PARENT_YIELDED_" + side),
        ),
      "parent yielded",
    );
  }
  await a.wait(() => state().tasks[idA]?.task?.state === "done", "A remote terminal", 90000);
  await b.wait(() => state().tasks[idB]?.task?.state === "done", "B remote terminal", 90000);
  await a.wait(
    () => a.events.some((e) => e.type === "message_end" && JSON.stringify(e).includes("REMOTE_JOBS_PARENT_ACK_A")),
    "A existing completion coordinator wake",
    45000,
  );
  await b.wait(
    () => b.events.some((e) => e.type === "message_end" && JSON.stringify(e).includes("REMOTE_JOBS_PARENT_ACK_B")),
    "B existing completion coordinator wake",
    45000,
  );
  const complete = (client: typeof a) =>
    client.events.filter((e) => e.type === "message_end" && e.message?.customType === "task-complete");
  assert(complete(a).length && complete(b).length, "missing existing task-complete envelope");
  assert(
    JSON.stringify(complete(a)).includes("SSH jobs completed:") &&
      JSON.stringify(complete(b)).includes("SSH jobs completed:"),
    "missing real SSH completion content",
  );
  assert(
    !JSON.stringify(complete(a)).includes(idB) &&
      !JSON.stringify(complete(b)).includes(idA) &&
      !JSON.stringify(complete(a)).includes(jobB) &&
      !JSON.stringify(complete(b)).includes(jobA),
    "cross-session task completion leaked",
  );
  assert(
    JSON.stringify(complete(a)).includes(jobA) && JSON.stringify(complete(b)).includes(jobB),
    "completion lost stable jobs ID",
  );
  for (const [client, side, own, foreign] of [
    [a, "A", jobA, jobB],
    [b, "B", jobB, jobA],
  ] as const) {
    client.send("REMOTE_JOBS_CHECK " + own + " " + foreign);
    await client.wait(
      () => existsSync(join(home, "check-" + side + ".json")),
      "session isolation / unknown job checks",
    );
    const check = JSON.parse(readFileSync(join(home, "check-" + side + ".json"), "utf8"));
    assert.equal(check.inspected.id, own);
    assert.equal(check.rejected.length, 4);
    await client.wait(
      () =>
        client.events.some(
          (e) => e.type === "message_end" && JSON.stringify(e).includes("REMOTE_JOBS_CHECKED_" + side),
        ),
      "probe yielded",
    );
    const sourceProof = ssh(
      "test -f /tmp/fixture-jobs-proof-" + side + " && test -f /tmp/fixture-owner-finished-" + side,
    );
    assert.equal(
      sourceProof.status,
      0,
      "current-source shell and owner continuation did not finish: " + sourceProof.stderr,
    );
    const policy = ssh("cat /tmp/fixture-jobs-policy-" + side);
    assert.equal(policy.status, 0, policy.stderr);
    assert(policy.stdout.includes("Only orchestrator agents can delegate"));
  }
  const countA = complete(a).length,
    countB = complete(b).length;
  a.send("/remote sync " + idA);
  b.send("/remote sync " + idB);
  await Bun.sleep(1500);
  assert.equal(complete(a).length, countA, "repeat sync redelivered A");
  assert.equal(complete(b).length, countB, "repeat sync redelivered B");
  a.child.kill("SIGKILL");
  b.child.kill("SIGKILL");
  const ar = launch("A-reconnect", join(home, "a.jsonl")),
    br = launch("B-reconnect", join(home, "b.jsonl"));
  ar.send("/remote status");
  br.send("/remote status");
  await Bun.sleep(2000);
  assert(!complete(ar).length && !complete(br).length, "reconnect redelivered completed task");
  assert.equal(git("status", "--porcelain").trim(), "M README.md", "cache or artifacts landed inside source");
  console.log(
    "PASS compiled CLI print/json boundary; normal CLI execute jobs.targets/subagent(target) -> two parent yields -> Docker remote terminal -> existing task-complete parent wake, stable IDs, isolated/unknown jobs, normal depth1 role policy, repeat sync and reconnect",
  );
} finally {
  for (const child of clients) if (child.exitCode === null) child.kill("SIGKILL");
}
