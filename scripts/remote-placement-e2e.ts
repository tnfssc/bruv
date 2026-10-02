import { networkNoneFixture, quote, wait } from "./network-none-fixture";
/** Isolated, offline Docker SSH + compiled CLI PTY acceptance. See fixture README. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { ALIAS, ANSWER, QUESTION, stream } from "../tests/fixtures/remote-placement-e2e/scenario";

const probe = process.argv.slice(2).includes("--probe");
assert(
  process.argv.slice(2).every((arg) => arg === "--probe"),
  "Only --probe is supported",
);
const source = resolve(import.meta.dir, "..");
const fixture = join(source, "tests/fixtures/remote-placement-e2e");
const bun = resolve(process.env.BUN_BIN ?? "/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun");
const binary = resolve(process.env.BRUV_BIN ?? join(source, "dist/bruv"));
const base = process.env.REMOTE_PLACEMENT_BASE_IMAGE;
assert(base, "Supply REMOTE_PLACEMENT_BASE_IMAGE: a cached local OS/SSH fixture image. No pulls/apt/WAN are allowed.");
const tmpBase = process.env.TMPDIR ?? "/home/tnfssc/.bruv/tmp-pi-removal";
mkdirSync(tmpBase, { recursive: true });
const root = mkdtempSync(join(tmpBase, "remote-placement-e2e-"));
const artifacts = process.env.REMOTE_PLACEMENT_ARTIFACTS
  ? resolve(process.env.REMOTE_PLACEMENT_ARTIFACTS)
  : mkdtempSync(join(tmpBase, "remote-placement-artifacts-"));
mkdirSync(artifacts, { recursive: true });
const name = "bruv-placement-" + process.pid + "-" + Date.now();
const harness = networkNoneFixture({
  root,
  name,
  alias: ALIAS,
  bun,
  binary: probe ? undefined : binary,
  base: base!,
  buildArg: "PLACEMENT_BASE",
  files: {
    Dockerfile: join(fixture, "Dockerfile"),
    "entrypoint.sh": join(fixture, "entrypoint.sh"),
    sshd_config: join(fixture, "sshd_config"),
    "models.json": join(fixture, "models.json"),
    "subagents.json": join(fixture, "subagents.json"),
    "fake-provider.ts": join(fixture, "fake-provider.ts"),
    "scenario.ts": join(fixture, "scenario.ts"),
    "ssh-proxy.ts": join(fixture, "ssh-proxy.ts"),
  },
});
const { home, agent, repo, env, raw, run, docker } = harness;
const socket = join(root, "tmux.sock");
const session = join(home, "parent.jsonl");
const tmux = (...args: string[]) => run("tmux", ["-f", "/dev/null", "-S", socket, ...args]);
const pane = () => tmux("capture-pane", "-p", "-S", "-", "-t", "placement");
const capture = (label: string) => writeFileSync(join(artifacts, label + ".txt"), pane());
const type = (message: string) => {
  tmux("send-keys", "-t", "placement", "-l", message);
  tmux("send-keys", "-t", "placement", "Enter");
};
const key = (...keys: string[]) => tmux("send-keys", "-t", "placement", ...keys);
const files = (dir: string): string[] =>
  !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? files(join(dir, d.name)) : d.isFile() ? [join(dir, d.name)] : [],
      );
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const statePath = join(home, ".bruv", "remote", "state.json");
const state = () => (existsSync(statePath) ? json(statePath) : { tasks: {} });
const questionRows = () => {
  const file = join(home, "placement-human-questions.json");
  if (!existsSync(file)) return [];
  const result = json(file);
  return Array.isArray(result) ? result : (result.questions ?? []);
};
const question = (name: string) =>
  questionRows().find((q: any) => q.text === name && q.status !== "resolved" && q.status !== "cancelled");
let ptyStarted = false;
let parentProvider: ReturnType<typeof Bun.serve> | undefined;
let passed = false;
console.log("Placement artifacts:", artifacts);
try {
  const { imageId, ssh } = await harness.start();
  const receipt: any = {
    mode: probe ? "fixture-probe-only" : "acceptance",
    sourceCommit: run("git", ["-C", source, "rev-parse", "HEAD"]),
    sourceDirty: run("git", ["-C", source, "status", "--porcelain"]),
    baseImageId: imageId,
    bunSha256: createHash("sha256").update(readFileSync(bun)).digest("hex"),
    binarySha256: !probe ? createHash("sha256").update(readFileSync(binary)).digest("hex") : null,
    networkMode: JSON.parse(docker("inspect", name))[0].HostConfig.NetworkMode,
  };
  assert.equal(receipt.networkMode, "none");
  writeFileSync(join(artifacts, "receipt.json"), JSON.stringify(receipt, null, 2));
  if (probe) {
    assert.equal(ssh("cat /opt/fixture/placement-host"), "isolated placement fixture");
    console.log("PASS fixture probe only: no compiled CLI, placement, questions, jobs or return claim");
    passed = true;
  } else {
    const models = json(join(fixture, "models.json"));
    parentProvider = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (request.method !== "POST") return new Response("not found", { status: 404 });
        const body = (await request.json()) as Parameters<typeof stream>[0];
        assert.equal(body.model, "placement-parent", "a descendant escaped to the parent inference runtime");
        const { appendFileSync } = await import("node:fs");
        appendFileSync(join(artifacts, "parent-inference.jsonl"), JSON.stringify(body) + "\n");
        return new Response(stream(body), { headers: { "content-type": "text/event-stream" } });
      },
    });
    models.providers.fixture.baseUrl = "http://127.0.0.1:" + parentProvider.port + "/v1";
    writeFileSync(join(agent, "models.json"), JSON.stringify(models));
    // If the destination accidentally inherits the parent's profile, inference fails loudly.
    writeFileSync(
      join(home, ".bruv", "subagents.json"),
      JSON.stringify({
        normal: { model: "fixture/placement-local-wrong" },
        orchestrator: { model: "fixture/placement-local-wrong" },
      }),
    );
    const git = (...args: string[]) => run("git", ["-C", repo, ...args]);
    git("init", "-q");
    git("config", "user.email", "placement@example.invalid");
    git("config", "user.name", "Placement Fixture");
    writeFileSync(join(repo, "tracked.txt"), "base\n");
    git("add", "tracked.txt");
    git("commit", "-qm", "first local history");
    writeFileSync(join(repo, "guard.txt"), "guard base\n");
    git("add", "guard.txt");
    git("commit", "-qm", "second local history");
    const localHead = git("rev-parse", "HEAD");
    assert.equal(git("rev-list", "--count", "HEAD"), "2");
    writeFileSync(join(repo, "tracked.txt"), "PLACEMENT_TRACKED_DIRTY\n");
    writeFileSync(join(repo, "never-upload.txt"), "PLACEMENT_NEVER_UPLOAD\n");
    const command = [
      "env",
      "-i",
      ...Object.entries(env).map(([k, v]) => k + "=" + v),
      binary,
      "--offline",
      "--no-approve",
      "--provider",
      "fixture",
      "--model",
      "placement-parent",
      "--session",
      session,
    ]
      .map(quote)
      .join(" ");
    const start = () => {
      tmux("new-session", "-d", "-s", "placement", "-x", "120", "-y", "40", "-c", repo, command);
      ptyStarted = true;
    };
    start();
    await wait("compiled CLI initial model", () => pane().includes("placement-parent"));
    await Bun.sleep(2000);
    type("/remote connect " + ALIAS + " /usr/local/bin/bruv");
    await wait("one human pinned connection", () => state().connection?.host === ALIAS);
    const pinned = JSON.stringify(state().connection);
    capture("01-human-connect");
    let queryIndex = 0;
    const captureQuestions = async () => {
      const index = ++queryIndex;
      type("PLACEMENT_QUERY_QUESTIONS_" + index);
      await wait("ordinary questions API capture", () => pane().includes("PLACEMENT_QUESTIONS_CAPTURED_" + index));
    };
    const ownerQuestions = (id: string) =>
      JSON.parse(ssh("cat /root/.bruv/remote-owner/tasks/" + id + "/session.jsonl.questions.json"));
    const waitOwnerQuestion = async (id: string) => {
      await wait(
        "real server question persisted",
        () =>
          raw("docker", [
            "exec",
            name,
            "test",
            "-f",
            "/root/.bruv/remote-owner/tasks/" + id + "/session.jsonl.questions.json",
          ]).status === 0,
        90000,
      );
      await Bun.sleep(6000);
      await captureQuestions();
    };
    type("PLACEMENT_START_CLEAN launch normal subagent to pinned target");
    await wait("exactly one normal placed task", () => Object.keys(state().tasks).length === 1);
    const cleanId = Object.keys(state().tasks)[0];
    await waitOwnerQuestion(cleanId);
    assert(question(QUESTION), "ordinary questions.list omitted the remote child question");
    const q = question(QUESTION);
    assert.equal(q.status, "pending");
    assert(q.owner && Number.isInteger(q.version), "question lost owner/version provenance");
    const remoteQ = ownerQuestions(cleanId).find((row: any) => row.text === QUESTION);
    assert(remoteQ, "missing source remote question");
    for (const identity of [cleanId, remoteQ.id, remoteQ.owner.sessionId, remoteQ.owner.branchId])
      assert(JSON.stringify(q).includes(identity), "ordinary question lost remote provenance: " + identity);
    const objects = (value: any): any[] =>
      value && typeof value === "object" ? [value, ...Object.values(value).flatMap(objects)] : [];
    assert(
      objects(q).some(
        (row) =>
          Object.entries(row).some(
            ([key, value]) => key.toLowerCase().includes("version") && value === remoteQ.version,
          ) &&
          JSON.stringify(row).includes(remoteQ.owner.sessionId) &&
          JSON.stringify(row).includes(remoteQ.owner.branchId),
      ),
      "ordinary question lost source owner/version routing",
    );
    writeFileSync(join(artifacts, "question-provenance.json"), JSON.stringify({ parent: q, remote: remoteQ }, null, 2));
    assert.equal(
      ssh("cat /tmp/placement-orchestrator-clean-cwd").startsWith("/root/"),
      true,
      "orchestrator did not use isolated server snapshot",
    );
    const orchCwd = ssh("cat /tmp/placement-orchestrator-clean-cwd"),
      childCwd = ssh("cat /tmp/placement-normal-clean-cwd");
    assert.notEqual(childCwd, orchCwd, "normal child failed to create its own worktree");
    const childResult = JSON.parse(ssh("cat /tmp/placement-child-result-clean.json"));
    assert.equal(childResult.status, "completed");
    assert(JSON.stringify(childResult).includes("PLACEMENT_NORMAL_DONE_CLEAN"));
    capture("02-question-before-restart");
    // Kill only the parent client. Server work must retain the same task and question.
    tmux("kill-session", "-t", "placement");
    ptyStarted = false;
    await Bun.sleep(500);
    start();
    await wait("compiled client restarted", () => pane().includes("placement-parent"));
    await Bun.sleep(2000);
    assert.equal(JSON.stringify(state().connection), pinned);
    assert.deepEqual(Object.keys(state().tasks), [cleanId]);
    await captureQuestions();
    assert.equal(question(QUESTION)?.id, q.id, "restart changed ordinary question identity");
    assert.equal(question(QUESTION).status, "pending");
    assert.deepEqual(question(QUESTION).owner, q.owner);
    assert.equal(question(QUESTION).version, q.version);
    type("/questions");
    await wait("ordinary questions menu", () => pane().includes("Questions ·") && pane().includes(QUESTION));
    capture("03-ordinary-questions-menu");
    key("Escape");
    await Bun.sleep(150);
    assert.equal(
      ownerQuestions(cleanId).find((row: any) => row.id === remoteQ.id).status,
      "pending",
      "Escape guessed an answer",
    );
    type("/questions");
    await wait("ordinary question picker", () => pane().includes("Questions ·"));
    key("Enter");
    await wait("human answer choice", () => pane().includes("→ " + ANSWER));
    capture("04-explicit-human-choice");
    key("Enter");
    await wait(
      "safe clean result returned",
      () => readFileSync(join(repo, "tracked.txt"), "utf8") === "PLACEMENT_REMOTE_RETURN\n",
      90000,
    );
    await wait("ordinary jobs result", () => existsSync(join(home, "placement-result-clean.json")), 60000);
    const result = json(join(home, "placement-result-clean.json"));
    assert.equal(result.result.status, "completed");
    assert(JSON.stringify(result.result).includes("PLACEMENT_ORCHESTRATOR_DONE_CLEAN"));
    assert.equal(readFileSync(join(repo, "never-upload.txt"), "utf8"), "PLACEMENT_NEVER_UPLOAD\n");
    assert.equal(git("rev-parse", "HEAD"), localHead, "return rewrote parent history");
    const descriptors = () =>
      files(join(home, ".bruv"))
        .filter((f) => f.endsWith("handoff.json"))
        .map((f) => ({ file: f, data: json(f) }));
    const cleanDescriptor = descriptors().find((d) => d.data.prompt?.includes("PLACEMENT_ORCHESTRATOR_CLEAN"));
    assert(cleanDescriptor, "missing durable snapshot provenance descriptor");
    assert.equal(cleanDescriptor.data.snapshot.head, localHead);
    assert.notEqual(cleanDescriptor.data.snapshot.snapshot, localHead);
    assert.deepEqual(cleanDescriptor.data.snapshot.selectedUntracked, []);
    assert(cleanDescriptor.data.snapshot.omittedUntracked.includes("never-upload.txt"));
    assert.equal(cleanDescriptor.data.outcome.status, "applied");
    capture("05-jobs-clean-safe-return");
    // A separate launch proves drift is review-only, not overwritten by a convenient patch.
    type("PLACEMENT_START_DRIFT launch a second normal placed task");
    await wait("two placements", () => Object.keys(state().tasks).length === 2);
    const driftId = Object.keys(state().tasks).find((id) => id !== cleanId)!;
    await waitOwnerQuestion(driftId);
    assert(question("PLACEMENT_DRIFT_QUESTION"), "ordinary questions.list omitted drift question");
    const dq = question("PLACEMENT_DRIFT_QUESTION");
    writeFileSync(join(repo, "guard.txt"), "PLACEMENT_PARENT_DRIFT\n");
    type("/questions answer " + dq.id + " " + ANSWER);
    await wait("drift job result", () => existsSync(join(home, "placement-result-drift.json")), 90000);
    await wait("drift review artifact", () =>
      descriptors().some(
        (d) => d.data.prompt?.includes("PLACEMENT_ORCHESTRATOR_DRIFT") && d.data.outcome?.status === "review",
      ),
    );
    const driftDescriptor = descriptors().find((d) => d.data.prompt?.includes("PLACEMENT_ORCHESTRATOR_DRIFT"))!;
    assert.equal(readFileSync(join(repo, "guard.txt"), "utf8"), "PLACEMENT_PARENT_DRIFT\n");
    assert.equal(readFileSync(join(repo, "tracked.txt"), "utf8"), "PLACEMENT_REMOTE_RETURN\n");
    assert(existsSync(driftDescriptor.data.outcome.artifact));
    assert(readFileSync(driftDescriptor.data.outcome.artifact, "utf8").includes("PLACEMENT_REMOTE_DRIFT_RETURN"));
    capture("06-drift-review-only");
    // Repeat synchronization and client reconnect cannot manufacture a second completion.
    const journal = () =>
      readFileSync(session, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const completions = () =>
      journal().filter(
        (e) =>
          ((e.type === "custom_message" && e.customType === "task-complete") ||
            (e.type === "message" && e.message?.customType === "task-complete")) &&
          String(e.type === "custom_message" ? e.content : e.message?.content).includes("PLACEMENT_ORCHESTRATOR_DONE_"),
      );
    const count = completions().length;
    assert.equal(count, 2, "expected one normal completion per placement");
    // Ordinary background observation must not redeliver already consumed results.
    // No manual remote sync/answer/inbox is part of this task lifecycle.
    await Bun.sleep(12000);
    assert.equal(completions().length, count, "repeat automatic observation delivered duplicate normal completion");
    tmux("kill-session", "-t", "placement");
    ptyStarted = false;
    await Bun.sleep(500);
    start();
    await wait("second reconnect", () => pane().includes("placement-parent"));
    await Bun.sleep(6000);
    assert.equal(completions().length, count, "reconnect replayed a consumed completion");
    assert.equal(Object.keys(state().tasks).length, 2, "restart duplicated remote task");
    const ownerCount = ssh("find /root/.bruv/remote-owner/tasks -mindepth 1 -maxdepth 1 -type d | wc -l");
    assert.equal(ownerCount, "2", "server descendants became extra SSH placements or restart duplicated owner launch");
    const requestLog = ssh("cat /tmp/placement-inference.jsonl");
    assert(!requestLog.includes("placement-local-wrong"), "destination inherited local profile");
    assert(requestLog.includes('"model":"placement-orchestrator"'), "missing destination orchestrator inference");
    assert(requestLog.includes('"model":"placement-normal"'), "missing destination normal inference");
    assert(requestLog.includes("PLACEMENT_NORMAL_REMOTE_WORKTREE_OK"));
    const providerErrors = ssh("test ! -e /tmp/placement-provider-errors || cat /tmp/placement-provider-errors");
    assert.equal(providerErrors, "");
    cpSync(session, join(artifacts, "parent-session.jsonl"));
    copyFileSync(join(home, "placement-human-questions.json"), join(artifacts, "ordinary-questions-api.json"));
    copyFileSync(statePath, join(artifacts, "remote-client.json"));
    for (const side of ["clean", "drift"])
      for (const kind of ["job", "result"])
        copyFileSync(
          join(home, "placement-" + kind + "-" + side + ".json"),
          join(artifacts, "placement-" + kind + "-" + side + ".json"),
        );
    for (const d of descriptors()) {
      const id = JSON.parse(readFileSync(d.file, "utf8")).prompt.includes("DRIFT") ? "drift" : "clean";
      writeFileSync(join(artifacts, "snapshot-" + id + ".json"), JSON.stringify(d.data, null, 2));
      if (d.data.outcome?.artifact && existsSync(d.data.outcome.artifact))
        copyFileSync(d.data.outcome.artifact, join(artifacts, "return-" + id + ".patch"));
    }
    for (const [i, file] of files(home)
      .filter((f) => f.endsWith(".questions.json"))
      .entries())
      copyFileSync(file, join(artifacts, "questions-" + i + ".json"));
    capture("07-reconnect-no-duplicates");
    console.log(
      "PASS compiled CLI PTY normal placement: tracked snapshot/provenance, destination orchestrator profile/role, omitted-target server child/worktree, ordinary human questions, restart identity, jobs result, safe apply and drift review",
    );
    passed = true;
  }
} catch (error) {
  writeFileSync(
    join(artifacts, "failure.txt"),
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  throw error;
} finally {
  if (harness.containerStarted) {
    for (const file of ["placement-inference.jsonl", "placement-provider-errors", "placement-provider.log"]) {
      const r = raw("docker", ["cp", name + ":/tmp/" + file, join(artifacts, file)]);
      if (r.status !== 0 && file !== "placement-provider-errors")
        writeFileSync(join(artifacts, file + ".unavailable.txt"), r.stderr);
    }
    writeFileSync(join(artifacts, "docker.log"), raw("docker", ["logs", name]).stderr);
  }
  if (ptyStarted) {
    try {
      capture(passed ? "final-pane" : "failure-pane");
    } catch {}
    raw("tmux", ["-S", socket, "kill-server"]);
  }
  if (!passed && existsSync(session)) copyFileSync(session, join(artifacts, "failed-parent-session.jsonl"));
  if (!passed && existsSync(statePath)) copyFileSync(statePath, join(artifacts, "failed-remote-client.json"));
  parentProvider?.stop(true);
  harness.cleanup();
  console.log("Preserved text/JSON artifacts (no video or private keys):", artifacts);
}
