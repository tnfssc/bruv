import { networkNoneFixture, assertFixtureOutputExternal, quote, wait } from "./network-none-fixture";
/** Typed remote root acceptance. Host tmux is presentation automation ONLY, never server ownership. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { ALIAS, ANSWER, questionText } from "../tests/fixtures/remote-typed-root-placement/scenario";
import {
  assertOnePrompt,
  assertQuestion,
  assertSameRoot,
  assertSnapshot,
  assertWorkOnce,
  completedCommands,
  questionsFromReceipt,
  assertReplyRecovered,
  assertCancelledJob,
} from "../tests/fixtures/remote-typed-root-placement/proof";

const probe = process.argv.slice(2).includes("--probe");
assert(
  process.argv.slice(2).every((arg) => arg === "--probe"),
  "Only --probe is supported",
);
const source = resolve(import.meta.dir, "..");
const fixture = join(source, "tests/fixtures/remote-typed-root-placement");
const bun = resolve(process.env.BUN_BIN ?? "/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun");
assert(probe || process.env.BRUV_BIN, "Set BRUV_BIN to the actual combined compiled CLI; no implicit candidate");
const binary = process.env.BRUV_BIN ? resolve(process.env.BRUV_BIN) : "";
const base = process.env.REMOTE_ROOT_PLACEMENT_BASE_IMAGE ?? "bruv-remote-e2e-2434886-5027:latest";
assert(
  base,
  "Supply REMOTE_ROOT_PLACEMENT_BASE_IMAGE: a cached local OS/SSH fixture image. No pulls/apt/WAN are allowed.",
);

const tmpBase = resolve(process.env.TMPDIR ?? "/home/tnfssc/.bruv/tmp-pi-removal");
assertFixtureOutputExternal(source, tmpBase);
if (process.env.REMOTE_ROOT_PLACEMENT_ARTIFACTS)
  assertFixtureOutputExternal(source, process.env.REMOTE_ROOT_PLACEMENT_ARTIFACTS);
mkdirSync(tmpBase, { recursive: true });
const root = mkdtempSync(join(tmpBase, "remote-root-placement-e2e-"));
const artifacts = process.env.REMOTE_ROOT_PLACEMENT_ARTIFACTS
  ? resolve(process.env.REMOTE_ROOT_PLACEMENT_ARTIFACTS)
  : mkdtempSync(join(tmpBase, "remote-root-placement-artifacts-"));
mkdirSync(artifacts, { recursive: true });
const name = "bruv-root-placement-" + process.pid + "-" + Date.now();
const harness = networkNoneFixture({
  root,
  name,
  alias: ALIAS,
  bun,
  binary: probe ? undefined : binary,
  base: base!,
  buildArg: "ROOT_PLACEMENT_BASE",
  files: {
    Dockerfile: join(fixture, "Dockerfile"),
    "entrypoint.sh": join(fixture, "entrypoint.sh"),
    sshd_config: join(fixture, "sshd_config"),
    "models.json": join(fixture, "models.json"),
    "subagents.json": join(fixture, "subagents.json"),
    "settings.json": join(fixture, "settings.json"),
    "fake-provider.ts": join(fixture, "fake-provider.ts"),
    "scenario.ts": join(fixture, "scenario.ts"),
    "ssh-proxy.ts": join(fixture, "ssh-proxy.ts"),
  },
  replyLoss: join(fixture, "reply-loss.ts"),
});
const { home, agent, repo, env, raw, run, docker, faultDir } = harness;
const socket = join(root, "tmux.sock");
const tmux = (...args: string[]) => run("tmux", ["-f", "/dev/null", "-S", socket, ...args]);
const pane = () => tmux("capture-pane", "-p", "-S", "-", "-t", "root-placement");
const screen = () => tmux("capture-pane", "-p", "-t", "root-placement");
const capture = (label: string) => writeFileSync(join(artifacts, label + ".txt"), pane());
const type = (message: string) => {
  tmux("send-keys", "-t", "root-placement", "-l", message);
  tmux("send-keys", "-t", "root-placement", "Enter");
};
const key = (...keys: string[]) => tmux("send-keys", "-t", "root-placement", ...keys);
const files = (dir: string): string[] =>
  !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? files(join(dir, d.name)) : d.isFile() ? [join(dir, d.name)] : [],
      );
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const statePath = join(home, ".bruv", "remote", "state.json");
const rootsDir = join(home, ".bruv", "remote", "roots");
const rootFiles = () => files(rootsDir).filter((f) => f.endsWith("/root.json"));
const rootState = (id?: string): any => {
  const rows = rootFiles().map(json);
  const found = id ? rows.find((s) => s.intent.sessionId === id) : rows.at(-1);
  assert(found, "missing durable root presentation pointer");
  return found;
};
let ptyStarted = false;
let passed = false;
console.log("Typed root placement artifacts:", artifacts);
try {
  if (!probe)
    assert(existsSync(binary), "Build the final combined compiled CLI and set BRUV_BIN; probe is not acceptance");
  const { imageId, ssh } = await harness.start();
  const receipt: any = {
    schema: "typed-root-placement-proof-v1",
    mode: probe ? "fixture-probe-only" : "acceptance-in-progress",
    sourceCommit: run("git", ["-C", source, "rev-parse", "HEAD"]),
    sourceDirty: run("git", ["-C", source, "status", "--porcelain"]),
    baseImageId: imageId,
    bunSha256: createHash("sha256").update(readFileSync(bun)).digest("hex"),
    binarySha256: probe ? null : createHash("sha256").update(readFileSync(binary)).digest("hex"),
    networkMode: JSON.parse(docker("inspect", name))[0].HostConfig.NetworkMode,
    localInference: "none",
    authorization: probe
      ? "not performed (infrastructure only)"
      : "one-time fixture human authorization seeded explicitly via pinned RemoteClient.connect",
    actualMissingProof: [
      "server crash with durable dispatching-to-unknown command (reply loss is not owner crash)",
      "abort of an actively streaming root turn (running shell-job cancellation is separate)",
      "unsupported modes rejected by server protocol (CLI rejects full-history/worktree requests only)",
    ],
    scenarios: [],
  };
  assert.equal(receipt.networkMode, "none");
  const saveReceipt = () => writeFileSync(join(artifacts, "receipt.json"), JSON.stringify(receipt, null, 2));
  saveReceipt();
  if (probe) {
    assert.equal(ssh("cat /opt/fixture/typed-root-host"), "isolated typed root fixture");
    receipt.actualMissingProof = ["ALL compiled CLI root behavior; infrastructure probe only"];
    saveReceipt();
    console.log("PASS infrastructure probe ONLY: SSH/git and server fake inference; no root acceptance claim");
    passed = true;
  } else {
    // EXPLICIT FIXTURE HUMAN AUTHORIZATION. It is not agent permission or inferred approval.
    // Seed only this temporary HOME's alias + owner/epoch using the real pinned SSH hello.
    run(bun, [
      "-e",
      "import {RemoteClient} from " +
        JSON.stringify(join(source, "src/remote/client.ts")) +
        ";console.log(await new RemoteClient().connect(" +
        JSON.stringify(ALIAS) +
        ',"/usr/local/bin/bruv"));',
    ]);
    assert.equal(json(statePath).connection.host, ALIAS);
    const pinned = JSON.stringify(json(statePath).connection);
    // The presentation must start from EMPTY local provider/model configuration.
    assert.deepEqual(files(agent), []);
    assert(
      !files(home).some((f) => /\/(auth|models|settings|subagents)\.json$/.test(f)),
      "local provider/profile config leaked into fixture",
    );
    assert(!Object.keys(env).some((k) => /API_KEY|TOKEN|SECRET|BRUV_SUBAGENT|BRUV_REMOTE_OWNER/.test(k)));
    run("git", ["-C", repo, "init", "-q"]);
    run("git", ["-C", repo, "config", "user.email", "fixture@invalid"]);
    run("git", ["-C", repo, "config", "user.name", "Typed root fixture"]);
    writeFileSync(join(repo, "tracked.txt"), "ROOT_BASE\n");
    writeFileSync(join(repo, "guard.txt"), "ROOT_GUARD_BASE\n");
    run("git", ["-C", repo, "add", "."]);
    run("git", ["-C", repo, "commit", "-qm", "fixture baseline"]);
    writeFileSync(join(repo, "guard.txt"), "ROOT_GUARD_HEAD\n");
    run("git", ["-C", repo, "commit", "-qam", "fixture history is intentionally not uploaded"]);
    const localHead = run("git", ["-C", repo, "rev-parse", "HEAD"]);
    assert.equal(run("git", ["-C", repo, "rev-list", "--count", "HEAD"]), "2");
    writeFileSync(join(repo, "tracked.txt"), "ROOT_TRACKED_DIRTY\n");
    writeFileSync(join(repo, "never-upload.txt"), "ROOT_MUST_STAY_LOCAL\n");
    writeFileSync(join(repo, "authorized.txt"), "ROOT_INCLUDED_BY_HUMAN\n");
    const start = (extra: string[] = []) => {
      const command = [
        "env",
        "-i",
        ...Object.entries(env).map(([k, v]) => k + "=" + v),
        binary,
        "--offline",
        "--no-approve",
        "--place",
        ALIAS,
        ...extra,
      ]
        .map(quote)
        .join(" ");
      tmux(
        "new-session",
        "-d",
        "-s",
        "root-placement",
        "-x",
        "120",
        "-y",
        "44",
        "-c",
        repo,
        command,
        ";",
        "set-option",
        "-w",
        "-t",
        "root-placement",
        "remain-on-exit",
        "on",
      );
      ptyStarted = true;
    };
    const ready = async () =>
      wait("typed root terminal controls", () => screen().includes("/questions") && screen().includes("/close"));
    const detach = async () => {
      key("C-d");
      await wait(
        "presentation exit/detach",
        () => tmux("display-message", "-p", "-t", "root-placement", "#{pane_dead}") === "1",
      );
      assert.equal(
        tmux("display-message", "-p", "-t", "root-placement", "#{pane_dead_status}"),
        "0",
        "local presentation failed to detach cleanly",
      );
      tmux("kill-session", "-t", "root-placement");
      ptyStarted = false;
    };
    const journal = (s: any): string => {
      assert(s.record?.sessionFile?.startsWith("/"), "no authoritative server sessionFile");
      return ssh("cat " + quote(s.record.sessionFile));
    };
    const workRows = (side: string) =>
      ssh("cat /tmp/root-proof-" + side + ".jsonl")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    const currentQuestion = (s: any, side: string) =>
      questionsFromReceipt(s).find((q) => q.text === questionText(side));
    const showQuestion = async (id: string, side: string) => {
      const count = completedCommands(rootState(id), "questions.list").length;
      type("/questions");
      await wait(
        "normal human question picker",
        () =>
          screen().includes("Human questions") &&
          pane().includes(questionText(side)) &&
          completedCommands(rootState(id), "questions.list").length > count,
        90000,
      );
      const q = currentQuestion(rootState(id), side);
      assertQuestion(q, questionText(side));
      return q;
    };
    const proveScenario = async (side: string, extra: string[]) => {
      const upper = side.toUpperCase();
      const first = "ROOT_START_" + upper + " execute tools and a normal server worktree child, then ask me";
      const second = "ROOT_SECOND_" + upper + " continue the same root journal and edit again";
      const existing = rootFiles().length;
      start(extra);
      await ready();
      await wait("one new root pointer", () => rootFiles().length === existing + 1);
      const candidates = rootFiles()
        .map(json)
        .filter((s) => !receipt.scenarios.some((r: any) => r.rootID === s.intent.sessionId));
      assert.equal(candidates.length, 1);
      const id = candidates[0].intent.sessionId;
      await wait(
        "authoritative server root running",
        () => rootState(id).record?.state === "running" && !!rootState(id).record?.sessionFile,
      );
      assertSnapshot(rootState(id), localHead, side === "drift" ? ["authorized.txt"] : []);
      assert.equal(rootState(id).source.localRoot, repo);
      if (side === "drift") {
        // Drift occurs AFTER capture and AFTER our prior successful return. No reset/replay.
        writeFileSync(join(repo, "guard.txt"), "ROOT_PARENT_DRIFT\n");
      }
      const activeLocalDiff = run("git", ["-C", repo, "diff"]);
      type(first);
      await wait(
        "server child completed and real root question saved",
        () => raw("docker", ["exec", name, "test", "-f", "/tmp/root-question-" + side + ".json"]).status === 0,
        120000,
      );
      const q = await showQuestion(id, side);
      capture(side + "-01-question-picker");
      key("Escape");
      await wait("picker dismissed", () => screen().includes("/close"));
      const before = rootState(id),
        beforeJournal = journal(before);
      assertOnePrompt(before, first);
      assert.equal(
        readFileSync(join(repo, "tracked.txt"), "utf8"),
        side === "clean" ? "ROOT_TRACKED_DIRTY\n" : "ROOT_RETURN_TWO\n",
        "remote work returned before successful close",
      );
      // Disconnect while the real question remains pending. No local session/inference exists.
      await detach();
      await Bun.sleep(1200);
      const serverWhileDetached = journal(before);
      assert(serverWhileDetached.startsWith(beforeJournal), "server journal lost history on detach");
      assert.equal(rootFiles().length, existing + 1);
      start();
      await ready();
      assertSameRoot(before, rootState(id));
      const q2 = await showQuestion(id, side);
      assert.deepEqual(
        { id: q2.id, owner: q2.owner, version: q2.version },
        { id: q.id, owner: q.owner, version: q.version },
        "reattach changed saved question",
      );
      capture(side + "-02-reattached-same-question");
      // REAL HUMAN PICKER ACTION, not /questions answer ID, agent tool, or remote.answer.
      key("Enter");
      await wait("normal answer picker", () => pane().includes(questionText(side)) && pane().includes(ANSWER));
      capture(side + "-03-human-answer-choice");
      key("Enter");
      await wait("human answer continues same root", () => pane().includes("ROOT_ANSWER_DONE_" + upper), 120000);
      await wait(
        "human answer command acknowledgement",
        () => completedCommands(rootState(id), "questions.answer").length === 1,
      );
      const answered = rootState(id);
      const answers = completedCommands(answered, "questions.answer");
      assert.equal(answers.length, 1);
      assert.equal(answers[0].command.id, q.id);
      assert.equal(answers[0].command.text, ANSWER);
      assert(answers[0].command.replyId);
      assertSameRoot(before, answered);
      assert.equal(answered.outcome, undefined, "first turn returned source before close");
      assert.equal(run("git", ["-C", repo, "diff"]), activeLocalDiff, "first turn mutated local source");
      type(second);
      await wait("second explicit real root turn", () => pane().includes("ROOT_SECOND_DONE_" + upper), 120000);
      assertOnePrompt(rootState(id), second);
      assertSameRoot(before, rootState(id));
      assert.equal(rootState(id).outcome, undefined, "second turn returned source before close");
      assert.equal(run("git", ["-C", repo, "diff"]), activeLocalDiff, "second turn mutated local source");
      assertWorkOnce(workRows(side));
      const afterJournal = journal(rootState(id));
      assert(afterJournal.startsWith(beforeJournal), "second turn replaced server journal");
      assert(afterJournal.includes("ROOT_SECOND_TOOL_" + upper));
      assert(afterJournal.includes("ROOT_ANSWER_USED_" + upper));
      capture(side + "-04-second-root-turn");
      // /ps is the ordinary tasks picker backed by the root jobs facet.
      type("/ps");
      await wait("normal tasks picker", () => screen().includes("Jobs"));
      const lists = completedCommands(rootState(id), "jobs.list");
      assert(lists.length);
      const jobs = lists.at(-1).receipt.result;
      const rows = Array.isArray(jobs) ? jobs : jobs?.jobs;
      assert(Array.isArray(rows) && rows.length, "server child missing from normal jobs facet");
      const child = JSON.parse(ssh("cat /tmp/root-child-" + side + ".json"));
      const childIndex = rows.findIndex((j: any) => j.id === child.id);
      assert(childIndex >= 0, "server normal child absent from task picker");
      for (let n = 0; n < childIndex; n++) key("Down");
      capture(side + "-05-task-picker");
      key("Enter");
      await wait(
        "normal selected task inspection",
        () => completedCommands(rootState(id), "jobs.inspect").length > 0 && screen().includes("Back"),
      );
      const inspection = completedCommands(rootState(id), "jobs.inspect").at(-1);
      assert.equal(inspection.command.id, child.id, "task picker inspected the wrong job");
      const inspected = inspection.receipt.result;
      assert(
        String(inspected.output).includes("ROOT_NORMAL_DONE_" + upper),
        "normal job inspect lost server child output",
      );
      capture(side + "-06-task-inspection");
      key("Escape");
      await ready();
      type("/abort");
      await wait("typed idle abort receipt", () => completedCommands(rootState(id), "abort").length === 1);
      assert.equal(rootState(id).record.state, "running", "abort detached/closed presentation");
      type("/close");
      await wait(
        "successful authoritative root close and safe source return",
        () =>
          rootState(id).record?.state === "closed" && rootState(id).record?.exitCode === 0 && !!rootState(id).outcome,
        90000,
      );
      const closed = rootState(id);
      assert.equal(completedCommands(closed, "prompt").length, 2, "extra or missing root conversation prompt");
      assertSameRoot(before, closed);
      assert.equal(closed.outcome.status, side === "clean" ? "applied" : "review");
      if (side === "clean") {
        assert.equal(readFileSync(join(repo, "tracked.txt"), "utf8"), "ROOT_RETURN_TWO\n");
        assert.equal(readFileSync(join(repo, "guard.txt"), "utf8"), "ROOT_GUARD_HEAD\n");
      } else {
        assert.equal(readFileSync(join(repo, "tracked.txt"), "utf8"), "ROOT_RETURN_TWO\n");
        assert.equal(readFileSync(join(repo, "guard.txt"), "utf8"), "ROOT_PARENT_DRIFT\n");
      }
      assert.equal(readFileSync(join(repo, "authorized.txt"), "utf8"), "ROOT_INCLUDED_BY_HUMAN\n");
      assert.equal(readFileSync(join(repo, "never-upload.txt"), "utf8"), "ROOT_MUST_STAY_LOCAL\n");
      const patch = readFileSync(closed.outcome.artifact, "utf8");
      assert(patch.includes(side === "clean" ? "ROOT_RETURN_TWO" : "ROOT_DRIFT_RETURN_TWO"));
      if (side === "drift") {
        assert(
          patch.includes("-ROOT_RETURN_TWO"),
          "second source did not use our prior successful integration as baseline",
        );
        assert(!patch.includes("ROOT_TRACKED_DIRTY"), "cumulative first-root patch replayed");
      }
      copyFileSync(closed.outcome.artifact, join(artifacts, side + "-return.patch"));
      capture(side + "-07-closed-source-return");
      const integrated = run("git", ["-C", repo, "diff"]),
        outcome = JSON.stringify(closed.outcome);
      await detach();
      start();
      await ready();
      await Bun.sleep(3500);
      assertSameRoot(closed, rootState(id));
      assert.equal(rootFiles().length, existing + 1);
      assert.equal(JSON.stringify(rootState(id).outcome), outcome, "reattach reintegrated returned patch");
      assert.equal(run("git", ["-C", repo, "diff"]), integrated, "reattach cumulatively replayed patch");
      assertWorkOnce(workRows(side));
      assertOnePrompt(rootState(id), first);
      assertOnePrompt(rootState(id), second);
      capture(side + "-08-closed-reattach-no-replay");
      await detach();
      writeFileSync(join(artifacts, side + "-server-session.jsonl"), journal(closed) + "\n");
      writeFileSync(join(artifacts, side + "-root-state.json"), JSON.stringify(rootState(id), null, 2));
      writeFileSync(join(artifacts, side + "-remote-work.json"), JSON.stringify(workRows(side), null, 2));
      receipt.scenarios.push({
        side,
        rootID: id,
        sessionFile: closed.record.sessionFile,
        question: { id: q.id, owner: q.owner, version: q.version },
        outcome: closed.outcome.status,
        twoExplicitPrompts: true,
        sameJournal: true,
        workExecutedOnce: true,
      });
      saveReceipt();
      assert.equal(JSON.stringify(json(statePath).connection), pinned, "pinned owner identity changed");
      assert.deepEqual(json(statePath).tasks, {}, "root was implemented as a finite SSH child task");
      assert(
        !files(agent).some((f) => /\/(auth|models)\.json$/.test(f)),
        "root startup required/wrote local provider config",
      );
    };
    await proveScenario("clean", []);
    // Explicit HUMAN CLI include permission; fresh new root on the prior source result.
    await proveScenario("drift", ["--remote-fresh", "--remote-include", "authorized.txt"]);
    assert.equal(rootFiles().length, 2);

    // Unsupported requests must fail before startup, inference, or source capture.
    const untouched = {
      roots: rootFiles().map(json),
      diff: run("git", ["-C", repo, "diff"]),
      inference: ssh("cat /tmp/root-placement-inference.jsonl"),
      connection: json(statePath),
    };
    for (const extra of [
      ["--remote-history", "full"],
      ["--remote-workspace", "worktree"],
      ["--remote-repo", "/tmp/unsupported", "--remote-source", repo],
    ]) {
      const r = raw(binary, ["--place", ALIAS, ...extra], { cwd: repo });
      assert(r.status !== null && r.status !== 0, "unsupported mode was accepted");
      assert.match(r.stderr + r.stdout, /Unsupported remote main-session argument|different source choices/);
      assert.deepEqual(rootFiles().map(json), untouched.roots, "unsupported mode changed root pointers");
      assert.equal(run("git", ["-C", repo, "diff"]), untouched.diff);
      assert.equal(ssh("cat /tmp/root-placement-inference.jsonl"), untouched.inference);
      assert.deepEqual(json(statePath), untouched.connection);
      writeFileSync(join(artifacts, "unsupported-" + extra[0].slice(2) + ".txt"), r.stdout + r.stderr);
    }
    receipt.scenarios.push({
      side: "unsupported-cli-modes",
      fullHistory: "rejected",
      worktree: "rejected",
      conflictingSource: "rejected",
      noStartupOrInference: true,
    });
    saveReceipt();

    // Lose an ACTUAL successful SSH reply, not a mocked transport result or edited ledger.
    const priorRootIDs = new Set(rootFiles().map((f) => json(f).intent.sessionId));
    writeFileSync(join(faultDir, "armed"), "fixture only");
    start(["--remote-fresh"]);
    await ready();
    await wait("third root pointer", () => rootFiles().length === 3);
    const faultID = rootFiles()
      .map(json)
      .find((s) => !priorRootIDs.has(s.intent.sessionId)).intent.sessionId;
    await wait("third root running", () => rootState(faultID).record?.state === "running");
    const beforeLoss = rootState(faultID);
    const faultLocalDiff = run("git", ["-C", repo, "diff"]);
    const lostPrompt = "ROOT_REPLY_LOSS execute once while my SSH reply is discarded";
    type(lostPrompt);
    await wait("actual discarded SSH reply", () => existsSync(join(faultDir, "lost.json")));
    const lost = json(join(faultDir, "lost.json"));
    assert.equal(lost.request.command.text, lostPrompt);
    assert.equal(lost.response.commandId, lost.request.commandId);
    await wait(
      "durable unknown local receipt",
      () => rootState(faultID).commands[lost.request.commandId]?.receipt.state === "unknown",
    );
    copyFileSync(
      rootFiles().find((f) => json(f).intent.sessionId === faultID)!,
      join(artifacts, "reply-loss-unknown-root.json"),
    );
    await wait(
      "lost-reply work actually ran",
      () => ssh("test ! -f /tmp/root-reply-loss-work.jsonl || wc -l < /tmp/root-reply-loss-work.jsonl") === "1",
    );
    capture("reply-loss-unknown-before-detach");
    await detach();
    rmSync(join(faultDir, "armed"));
    start();
    await ready();
    await wait(
      "reattach reconciles same command identity",
      () => rootState(faultID).commands[lost.request.commandId]?.receipt.state === "completed",
    );
    assertSameRoot(beforeLoss, rootState(faultID));
    assert.equal(rootFiles().length, 3, "reattach created another root");
    await wait("same root finished lost-reply turn", () => pane().includes("ROOT_REPLY_LOSS_DONE"));
    const work = ssh("cat /tmp/root-reply-loss-work.jsonl")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const requests = readFileSync(join(faultDir, "requests.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assertReplyRecovered(rootState(faultID), lost.request, requests, work);
    assert.equal(rootState(faultID).outcome, undefined, "reply reconciliation returned active source");
    copyFileSync(join(faultDir, "lost.json"), join(artifacts, "reply-loss-discarded-response.json"));
    copyFileSync(join(faultDir, "requests.jsonl"), join(artifacts, "reply-loss-ssh-requests.jsonl"));
    capture("reply-loss-reconciled-no-resend");

    // Real background process stays live until the HUMAN /ps Cancel + confirmation.
    type("ROOT_RUNNING_JOB launch a long-lived server shell job for human cancellation");
    await wait("running shell job saved", () =>
      ssh("test ! -f /tmp/root-running-job.json || cat /tmp/root-running-job.json").startsWith("{"),
    );
    const running = JSON.parse(ssh("cat /tmp/root-running-job.json"));
    assert(running.background, "job finished before cancellation");
    await wait(
      "server job process live",
      () => ssh("test ! -f /tmp/root-running-pid || { kill -0 $(cat /tmp/root-running-pid) && echo live; }") === "live",
    );
    type("/ps");
    await wait("normal running job picker", () => screen().includes("Jobs on "));
    key("Enter");
    await wait(
      "running shell inspection and cancel action",
      () => pane().includes("ROOT_CANCEL_RUNNING") && screen().includes("Cancel "),
    );
    const pre = completedCommands(rootState(faultID), "jobs.inspect").at(-1);
    assert.equal(pre.command.id, running.id);
    assert.equal(pre.receipt.result.status, "running");
    key("Down", "Enter");
    await wait("normal human cancellation confirmation", () => screen().includes("Cancel this job?"));
    key("Down", "Enter");
    await wait("typed running job stop receipt", () => completedCommands(rootState(faultID), "jobs.stop").length === 1);
    await wait(
      "real server process exited",
      () => ssh("if kill -0 $(cat /tmp/root-running-pid) 2>/dev/null; then echo live; else echo gone; fi") === "gone",
    );
    type("/ps");
    await wait("post-cancel job picker", () => screen().includes("Jobs on "));
    key("Enter");
    await wait(
      "post-cancel authoritative inspect",
      () => completedCommands(rootState(faultID), "jobs.inspect").length > 1 && screen().includes("Back"),
    );
    const post = completedCommands(rootState(faultID), "jobs.inspect").at(-1);
    writeFileSync(
      join(artifacts, "running-cancel-receipt.json"),
      JSON.stringify({ state: rootState(faultID), result: post.receipt.result }, null, 2),
    );
    assertCancelledJob(rootState(faultID), running.id, post.receipt.result);
    assert.equal(ssh("test ! -e /tmp/root-running-finished && echo unfinished"), "unfinished");
    assert.equal(rootState(faultID).record.state, "running", "job cancellation closed root");
    assert.equal(rootState(faultID).outcome, undefined, "job cancellation returned active source");
    capture("running-job-cancelled");
    key("Escape");
    await ready(); // Keep Escape and Ctrl-D separate; an Alt/control chord is not two human actions.
    await detach(); // No successful close: this root must not export/integrate source.
    assert.equal(run("git", ["-C", repo, "diff"]), faultLocalDiff, "fault root returned source without close");
    writeFileSync(join(artifacts, "fault-root-state.json"), JSON.stringify(rootState(faultID), null, 2));
    receipt.scenarios.push({
      side: "reply-loss-and-running-job",
      rootID: faultID,
      commandID: lost.request.commandId,
      unknownPersisted: true,
      reconciledWithoutResend: true,
      workExecutedOnce: true,
      cancelledJobID: running.id,
      processExited: true,
      sourceReturned: false,
    });
    saveReceipt();
    const inference = ssh("cat /tmp/root-placement-inference.jsonl");
    assert(inference.includes('"model":"typed-root"'));
    assert(inference.includes('"model":"typed-root-normal"'));
    assert(inference.includes("ROOT_SERVER_ROLE0_OK_CLEAN"));
    assert(inference.includes("ROOT_NORMAL_SERVER_WORKTREE_OK_CLEAN"));
    assert.equal(ssh("test ! -e /tmp/root-placement-provider-errors || cat /tmp/root-placement-provider-errors"), "");
    assert.deepEqual(json(statePath).tasks, {});
    receipt.mode = "acceptance-passed";
    saveReceipt();
    passed = true;
    console.log(
      "PASS actual combined CLI: typed server root, empty local models/auth, two turns per root, same journal/question after detach, normal question/jobs pickers, role0 shell + server child worktree, tracked orphan snapshot, safe close return and explicit include/drift review, no cumulative replay, actual lost SSH reply reconciliation, running shell cancellation, unsupported CLI modes",
    );
    console.log("Not proved by this run:", receipt.actualMissingProof.join("; "));
  }
} catch (error) {
  writeFileSync(
    join(artifacts, "failure.txt"),
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  throw error;
} finally {
  if (harness.containerStarted) {
    for (const file of [
      "root-placement-inference.jsonl",
      "root-placement-provider-errors",
      "root-placement-provider.log",
    ]) {
      const r = raw("docker", ["cp", name + ":/tmp/" + file, join(artifacts, file)]);
      if (r.status !== 0 && file !== "root-placement-provider-errors")
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
  for (const [i, file] of rootFiles().entries()) copyFileSync(file, join(artifacts, "final-root-" + i + ".json"));
  harness.cleanup();
  console.log(
    "Preserved text/JSON artifacts outside repo (no video, SSH private keys, or real credentials):",
    artifacts,
  );
}
