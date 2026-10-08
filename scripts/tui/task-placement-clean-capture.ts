import { networkNoneFixture, assertFixtureOutputExternal, quote, wait } from "../fixtures/network-none-fixture";
/** One bounded clean product presentation. Acceptance fixtures remain unchanged. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALIAS, ANSWER, QUESTION } from "../fixtures/task-placement-clean/scenario";

/** PTY lifetime and its unfiltered presentation evidence; server state stays outside. */
export class PresentationTerminal {
  private started = false;
  private readonly shots: Array<{ step: string; caption: string; t: number; path: string; capturedAt: string }> = [];

  constructor(
    private readonly tmux: (...args: string[]) => string,
    private readonly stopServer: () => unknown,
    private readonly artifacts: string,
  ) {}

  start(command: string, repo: string) {
    this.tmux(
      "new-session",
      "-d",
      "-s",
      "root-placement",
      "-x",
      "120",
      "-y",
      "40",
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
      ";",
      "set-option",
      "-w",
      "-t",
      "root-placement",
      "remain-on-exit-format",
      "",
    );
    this.started = true;
  }

  ready() {
    return wait("root controls", () => this.screen().includes("/questions") && this.screen().includes("/close"));
  }

  scrollback() {
    return this.tmux("capture-pane", "-e", "-p", "-S", "-", "-t", "root-placement");
  }

  private screen() {
    return this.tmux("capture-pane", "-e", "-p", "-t", "root-placement");
  }

  view() {
    return this.screen().replace(/\x1b\[[0-9;]*m/g, "");
  }

  capture(label: string, caption = "", t = 0) {
    mkdirSync(join(this.artifacts, "diagnostics"), { recursive: true });
    writeFileSync(join(this.artifacts, "diagnostics", label + ".scrollback.txt"), this.scrollback());
    writeFileSync(join(this.artifacts, label + ".viewport.txt"), this.screen());
    if (caption) {
      this.shots.push({ step: label, caption, t, path: label + ".viewport.txt", capturedAt: new Date().toISOString() });
      writeFileSync(join(this.artifacts, "timeline.json"), JSON.stringify(this.shots, null, 2));
    }
  }

  type(message: string) {
    this.tmux("send-keys", "-t", "root-placement", "-l", message);
    this.key("Enter");
  }

  key(...keys: string[]) {
    this.tmux("send-keys", "-t", "root-placement", ...keys);
  }

  async detach(label: string, caption: string, t: number) {
    this.key("C-d");
    await wait("detach", () => this.tmux("display-message", "-p", "-t", "root-placement", "#{pane_dead}") === "1");
    assert.equal(this.tmux("display-message", "-p", "-t", "root-placement", "#{pane_dead_status}"), "0");
    // Preserve the last actual terminal view before removing the detached pane.
    this.capture(label, caption, t);
    this.tmux("kill-session", "-t", "root-placement");
    this.started = false;
  }

  captureFinalAndStop(passed: boolean) {
    if (!this.started) return;
    try {
      this.capture(passed ? "final-pane" : "failure-pane");
    } catch {}
    this.stopServer();
  }
}

async function main() {
  assert.equal(process.argv.length, 2, "No CLI arguments are supported");
  const source = resolve(import.meta.dir, "../..");
  const fixture = join(source, "tests/fixtures/remote-typed-root-placement");
  const presentation = join(source, "scripts/fixtures/task-placement-clean");
  const bun = resolve(process.env.BUN_BIN ?? "/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun");
  assert(process.env.BRUV_BIN, "Set BRUV_BIN to the actual combined compiled CLI; no implicit candidate");
  const binary = process.env.BRUV_BIN ? resolve(process.env.BRUV_BIN) : "";
  const binarySource = process.env.BRUV_BINARY_SOURCE;
  const expectedBinarySha = process.env.BRUV_BINARY_SHA256;
  assert(
    binarySource && /^[0-9a-f]{40}$/.test(binarySource),
    "Set BRUV_BINARY_SOURCE to the reviewed full source commit",
  );
  assert(
    expectedBinarySha && /^[0-9a-f]{64}$/.test(expectedBinarySha),
    "Set BRUV_BINARY_SHA256 to the reviewed binary digest",
  );
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
  assert(
    readdirSync(artifacts).every((name) => name.startsWith("failed-")),
    "Choose an empty artifact directory (or one containing only preserved failed-* takes)",
  );
  const toolingSourcesSha256: Record<string, string> = {};
  mkdirSync(join(artifacts, "tooling-sources"), { recursive: true });
  for (const file of [
    "scripts/tui/task-placement-clean-capture.ts",
    "scripts/tui/task-placement-clean-video.py",
    "scripts/tui/ansi_video_renderer.py",
    "scripts/fixtures/network-none-fixture.ts",
    "scripts/fixtures/task-placement-clean/scenario.ts",
  ]) {
    const contents = readFileSync(join(source, file));
    writeFileSync(join(artifacts, "tooling-sources", file.split("/").at(-1)!), contents);
    toolingSourcesSha256[file] = createHash("sha256").update(contents).digest("hex");
  }
  const name = "bruv-root-placement-" + process.pid + "-" + Date.now();
  const harness = networkNoneFixture({
    root,
    name,
    alias: ALIAS,
    bun,
    binary: binary,
    base: base!,
    buildArg: "ROOT_PLACEMENT_BASE",
    files: {
      Dockerfile: join(fixture, "Dockerfile"),
      "entrypoint.sh": join(fixture, "entrypoint.sh"),
      sshd_config: join(fixture, "sshd_config"),
      "models.json": join(presentation, "models.json"),
      "subagents.json": join(presentation, "subagents.json"),
      "settings.json": join(presentation, "settings.json"),
      "fake-provider.ts": join(presentation, "fake-provider.ts"),
      "scenario.ts": join(presentation, "scenario.ts"),
      "ssh-proxy.ts": join(fixture, "ssh-proxy.ts"),
    },
  });
  const { home, agent, repo, env, raw, run, docker } = harness;
  const socket = join(root, "tmux.sock");
  const terminal = new PresentationTerminal(
    (...args) => run("tmux", ["-f", "/dev/null", "-S", socket, ...args]),
    () => raw("tmux", ["-S", socket, "kill-server"]),
    artifacts,
  );
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
  let passed = false;
  console.log("Clean presentation artifacts:", artifacts);
  try {
    assert(existsSync(binary), "Set BRUV_BIN to the reviewed compiled CLI");
    const { imageId, ssh } = await harness.start();

    const binarySha256 = createHash("sha256").update(readFileSync(binary)).digest("hex");
    assert.equal(binarySha256, expectedBinarySha, "Use only the reviewed final compiled binary");
    assert.equal(JSON.parse(docker("inspect", name))[0].HostConfig.NetworkMode, "none");
    // One-time explicit authorization for this isolated named server; not part of routine work.
    run(bun, [
      "-e",
      "import {RemoteClient} from " +
        JSON.stringify(join(source, "src/remote/client.ts")) +
        ";await new RemoteClient().connect(" +
        JSON.stringify(ALIAS) +
        ',"/usr/local/bin/bruv");',
    ]);
    assert.equal(json(statePath).connection.host, ALIAS);
    assert.deepEqual(files(agent), []);
    run("git", ["-C", repo, "init", "-q"]);
    run("git", ["-C", repo, "config", "user.email", "demo@invalid"]);
    run("git", ["-C", repo, "config", "user.name", "Demo"]);
    writeFileSync(
      join(repo, "README.md"),
      "# Garden planner\n\nInstall dependencies, run the development server, and open the local app.\n",
    );
    writeFileSync(join(repo, "NOTES.md"), "# Getting started\n\nNotes to follow.\n");
    run("git", ["-C", repo, "add", "."]);
    run("git", ["-C", repo, "commit", "-qm", "Start garden planner"]);
    const rootCommand = [
      "env",
      "-i",
      ...Object.entries(env).map(([k, v]) => k + "=" + v),
      binary,
      "--offline",
      "--no-approve",
      "--place",
      ALIAS,
    ]
      .map(quote)
      .join(" ");
    terminal.start(rootCommand, repo);
    await terminal.ready();
    await wait("root record", () => !!rootState().record?.sessionFile);
    const initial = rootState(),
      id = initial.intent.sessionId;
    terminal.capture("01-start", "Start a root session on studio · authorization already completed", 0);
    terminal.type("Please add getting-started notes. Ask a helper to review the guide first.");
    await wait("saved question", () => terminal.view().includes("saved a question"), 120000);
    assert.equal(
      terminal
        .view()
        .split("\n")
        .filter((line) => line.trim() === "↗ Review the project guide").length,
      1,
      "one active canonical helper row",
    );
    assert(!terminal.view().includes("✓ Ask a helper to review the guide"), "no separate checked helper-launch action");
    terminal.capture("02-work", "The root asks a normal helper to review the guide in a server worktree", 8);
    // Verify actual server child placement in its authoritative journal, offscreen.
    await wait(
      "child finished",
      () => ssh("cat /tmp/root-placement-inference.jsonl").includes("suggest a short getting-started"),
      120000,
    );
    terminal.type("/ps");
    await wait("jobs menu", () => terminal.view().includes("Jobs"));
    terminal.capture("03-jobs", "/ps · ordinary task list for the server-local helper", 18);
    terminal.key("Escape");
    await Bun.sleep(300);
    terminal.type("/questions");
    await wait(
      "questions menu",
      () => terminal.view().includes("Human questions") && terminal.view().includes(QUESTION),
    );
    terminal.capture("04-questions", "/questions · a saved preference waiting for your answer", 26);
    terminal.key("Escape");
    await Bun.sleep(300);
    await terminal.detach("05-detached", "Detach locally · the server root and saved question are retained", 34);
    terminal.start(rootCommand, repo);
    await terminal.ready();
    assert.equal(rootState().intent.sessionId, id);
    terminal.type("/questions");
    await wait(
      "reopened question",
      () => terminal.view().includes("Human questions") && terminal.view().includes(QUESTION),
    );
    terminal.capture("06-reopened", "Reopen on studio · the same saved question is still waiting", 40);
    terminal.key("Enter");
    await wait("answer choices", () => terminal.view().includes(ANSWER));
    terminal.capture("07-choice", "Choose the level of detail using the normal question picker", 48);
    terminal.key("Enter");
    await wait("notes written", () => terminal.scrollback().includes("Added concise getting-started notes"), 120000);
    await Bun.sleep(200);
    assert(!terminal.view().includes("Execution failed"), "Do not capture a failed tool as success");
    assert.equal(
      terminal
        .view()
        .split("\n")
        .filter((line) => line.trim() === "✓ Review the project guide").length,
      1,
      "one successful canonical helper row after reopen",
    );
    assert(
      !terminal.view().includes("✓ Ask a helper to review the guide"),
      "reopen must not duplicate helper-launch success",
    );
    terminal.capture("08-written", "The root writes NOTES.md after your answer", 56);
    assert.equal(readFileSync(join(repo, "NOTES.md"), "utf8"), "# Getting started\n\nNotes to follow.\n");
    // /ps was intentionally captured while active. Read a new authoritative terminal snapshot.
    terminal.type("/ps");
    await wait("terminal jobs menu", () => terminal.view().includes("Jobs"));
    terminal.key("Escape");
    await Bun.sleep(300);
    terminal.type("/close");
    await wait("source return", () => terminal.view().includes("Source return: applied"), 120000);
    terminal.capture("09-return", "/close · changes return safely to the local project", 65);
    assert.equal(
      readFileSync(join(repo, "NOTES.md"), "utf8"),
      "# Getting started\n\n1. Install dependencies.\n2. Run the development server.\n3. Open the local app.\n",
    );
    writeFileSync(join(artifacts, "returned-NOTES.md"), readFileSync(join(repo, "NOTES.md")));
    const state = rootState(id);
    writeFileSync(join(artifacts, "server-journal.jsonl"), ssh("cat " + quote(state.record.sessionFile)));
    const jobLists = Object.values(state.commands)
      .filter((c: any) => c.command.kind === "jobs.list")
      .map((c: any) => c.receipt.result.jobs);
    const child = jobLists
      .flat()
      .reverse()
      .find((j: any) => j.title === "Review the project guide");
    assert.equal(child.status, "completed");
    assert.equal(child.agent.type, "normal");
    assert.equal(child.agent.depth, 1);
    assert.equal(child.workspace.kind, "worktree");
    assert(child.cwd.startsWith("/root/.bruv/worktrees/"));
    assert(child.workspace.sourcePath.includes(id));
    writeFileSync(join(artifacts, "child-placement-proof.json"), JSON.stringify(child, null, 2) + "\n");
    assert.equal(ssh("test ! -e /tmp/root-placement-provider-errors || cat /tmp/root-placement-provider-errors"), "");
    writeFileSync(
      join(artifacts, "capture-receipt.json"),
      JSON.stringify(
        {
          schema: "clean-product-capture-v1",
          binaryPath: binary,
          binarySha256,
          binarySource,
          sourceTruth:
            "Local native CLI compiled from the recorded source commit and existing archive; not a hosted release packaging claim. Tooling checkout is separate.",
          toolingCommit: run("git", ["-C", source, "rev-parse", "HEAD"]),
          toolingSourcesSha256,
          toolingTreeDirty: !!run("git", [
            "-C",
            source,
            "status",
            "--porcelain",
            "--",
            "scripts/tui/task-placement-clean-capture.ts",
            "scripts/tui/task-placement-clean-video.py",
            "scripts/tui/ansi_video_renderer.py",
            "scripts/fixtures/network-none-fixture.ts",
            "scripts/fixtures/task-placement-clean",
          ]),
          baseImageId: imageId,
          networkMode: "none",
          localInference: "none",
          serverInference: "deterministic fake inference",
          serverAlias: ALIAS,
          rootId: id,
          oneTimeAuthorization:
            "Explicitly seeded pinned SSH connect in disposable HOME; omitted from routine presentation",
          durationSeconds: 74,
          limits: [
            "Retimed native PTY snapshot replay, not live continuous keystrokes",
            "No real hosts, paid APIs, user credentials, uploads, releases, or production changes",
            "Normal helper inherits server placement, uses worktree; no separate local-parent child scenario",
          ],
          setup: {
            transport: "Docker SSH via local exec proxy",
            terminal: "120x40 tmux PTY throughout; no cropping or viewport expansion to bury transcript",
            localProviderConfig: "empty",
          },
          checks: {
            sameRootAfterReopen: true,
            detachExitCode: 0,
            sourceUnchangedBeforeClose: true,
            sourceReturnedOnClose: true,
            serverProviderErrors: false,
          },
        },
        null,
        2,
      ) + "\n",
    );
    passed = true;
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
      ])
        raw("docker", ["cp", name + ":/tmp/" + file, join(artifacts, file)]);
      writeFileSync(join(artifacts, "docker.log"), raw("docker", ["logs", name]).stderr);
    }
    terminal.captureFinalAndStop(passed);
    for (const [i, file] of rootFiles().entries())
      copyFileSync(file, join(artifacts, "diagnostics", "final-root-" + i + ".json"));
    harness.cleanup();
    console.log("Clean presentation artifacts:", artifacts);
  }
}

if (import.meta.main) await main();
