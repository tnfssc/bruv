/** One bounded clean product presentation. Acceptance fixtures remain unchanged. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { ALIAS, ANSWER, QUESTION } from "./fixtures/task-placement-clean/scenario";

assert.equal(process.argv.length, 2, "No CLI arguments are supported");
const source = resolve(import.meta.dir, "..");
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
function assertExternal(path: string) {
  let parent = resolve(path);
  const tail: string[] = [];
  while (!existsSync(parent)) {
    tail.unshift(parent.slice(dirname(parent).length + 1));
    parent = dirname(parent);
  }
  const canonical = resolve(realpathSync(parent), ...tail);
  const r = relative(realpathSync(source), canonical);
  assert(r && (r === ".." || r.startsWith("../") || isAbsolute(r)), "Fixture output must be outside the repository");
}
const tmpBase = resolve(process.env.TMPDIR ?? "/home/tnfssc/.bruv/tmp-pi-removal");
assertExternal(tmpBase);
if (process.env.REMOTE_ROOT_PLACEMENT_ARTIFACTS) assertExternal(process.env.REMOTE_ROOT_PLACEMENT_ARTIFACTS);
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
  "scripts/task-placement-clean-capture.ts",
  "scripts/task-placement-clean-video.py",
  "scripts/fixtures/task-placement-clean/scenario.ts",
]) {
  const contents = readFileSync(join(source, file));
  writeFileSync(join(artifacts, "tooling-sources", file.split("/").at(-1)!), contents);
  toolingSourcesSha256[file] = createHash("sha256").update(contents).digest("hex");
}
const name = "bruv-root-placement-" + process.pid + "-" + Date.now();
const home = join(root, "home"),
  agent = join(home, "agent"),
  build = join(root, "build"),
  repo = join(root, "repo");
const socket = join(root, "tmux.sock");
for (const dir of [
  home,
  agent,
  build,
  repo,
  join(home, ".ssh"),
  join(home, ".bruv"),
  join(root, "keys"),
  join(root, "bin"),
  join(build, "runtime"),
])
  mkdirSync(dir, { recursive: true, mode: 0o700 });
// Deliberately do not inherit BRUV_*, provider tokens, SSH agents, or a worker's role/depth.
const env: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: home,
  TMPDIR: root,
  SHELL: "/bin/sh",
  TERM: "xterm-256color",
  LANG: "C.UTF-8",
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_CACHE_HOME: join(home, "cache"),
  XDG_STATE_HOME: join(home, "state"),
  BRUV_CODING_AGENT_DIR: agent,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};
const raw = (
  command: string,
  args: string[],
  options: { timeout?: number; env?: Record<string, string>; cwd?: string } = {},
) =>
  spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 15000,
    maxBuffer: 16 * 1024 * 1024,
    env: options.env ?? env,
    cwd: options.cwd ?? root,
  });
const run = (command: string, args: string[], options: Parameters<typeof raw>[2] = {}) => {
  const r = raw(command, args, options);
  assert.equal(r.status, 0, command + " " + args.join(" ") + "\n" + (r.error ?? "") + r.stderr + r.stdout);
  return r.stdout.trim();
};
const docker = (...args: string[]) => run("docker", args);
const tmux = (...args: string[]) => run("tmux", ["-f", "/dev/null", "-S", socket, ...args]);
const pane = () => tmux("capture-pane", "-e", "-p", "-S", "-", "-t", "root-placement");
const screen = () => tmux("capture-pane", "-e", "-p", "-t", "root-placement");
const shots: any[] = [];
const capture = (label: string, caption = "", t = 0) => {
  mkdirSync(join(artifacts, "diagnostics"), { recursive: true });
  writeFileSync(join(artifacts, "diagnostics", label + ".scrollback.txt"), pane());
  writeFileSync(join(artifacts, label + ".viewport.txt"), screen());
  if (caption) {
    shots.push({ step: label, caption, t, path: label + ".viewport.txt", capturedAt: new Date().toISOString() });
    writeFileSync(join(artifacts, "timeline.json"), JSON.stringify(shots, null, 2));
  }
};
const type = (message: string) => {
  tmux("send-keys", "-t", "root-placement", "-l", message);
  tmux("send-keys", "-t", "root-placement", "Enter");
};
const key = (...keys: string[]) => tmux("send-keys", "-t", "root-placement", ...keys);
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
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
const wait = async (label: string, fn: () => boolean, timeout = 60000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw Error("Timed out: " + label);
    await Bun.sleep(100);
  }
};
let containerStarted = false,
  imageBuilt = false,
  ptyStarted = false;
let passed = false;
console.log("Clean presentation artifacts:", artifacts);
try {
  // Resolve Docker endpoint before changing HOME; do not read a real Bruv/SSH/provider config.
  const dockerHost =
    process.env.DOCKER_HOST ??
    run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], {
      env: { PATH: env.PATH, HOME: process.env.HOME ?? "/nonexistent" },
    });
  env.DOCKER_HOST = dockerHost;
  for (const tool of ["docker", "ssh", "ssh-keygen", "tmux", "git"])
    run("/bin/sh", ["-c", 'command -v "$1"', "check", tool]);
  assert(existsSync(bun), "BUN_BIN is missing");
  assert(existsSync(binary), "Set BRUV_BIN to the reviewed compiled CLI");
  const imageId = docker("image", "inspect", base!, "--format", "{{.Id}}");
  assert.match(imageId, /^sha256:[0-9a-f]{64}$/);
  docker(
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "/bin/sh",
    imageId,
    "-c",
    "test -x /usr/sbin/sshd && command -v git >/dev/null",
  );
  run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(root, "client")]);
  run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(root, "hostkey")]);
  for (const file of [
    "Dockerfile",
    "entrypoint.sh",
    "sshd_config",
    "models.json",
    "subagents.json",
    "settings.json",
    "fake-provider.ts",
    "scenario.ts",
    "ssh-proxy.ts",
  ])
    copyFileSync(
      join(
        ["scenario.ts", "fake-provider.ts", "models.json", "settings.json", "subagents.json"].includes(file)
          ? presentation
          : fixture,
        file,
      ),
      join(build, file),
    );
  copyFileSync(bun, join(build, "runtime", "bun"));
  chmodSync(join(build, "runtime", "bun"), 0o755);
  copyFileSync(binary, join(build, "runtime", "bruv"));
  chmodSync(join(build, "runtime", "bruv"), 0o755);
  copyFileSync(join(root, "hostkey"), join(root, "keys", "hostkey"));
  copyFileSync(join(root, "client.pub"), join(root, "keys", "client.pub"));
  run(
    "docker",
    ["build", "--network", "none", "--pull=false", "--build-arg", "ROOT_PLACEMENT_BASE=" + imageId, "-t", name, build],
    { timeout: 180000 },
  );
  imageBuilt = true;
  docker(
    "run",
    "-d",
    "--pull=never",
    "--name",
    name,
    "--network",
    "none",
    "--memory",
    "1g",
    "--cpus",
    "2",
    "--pids-limit",
    "256",
    "--mount",
    "type=bind,src=" + join(root, "keys") + ",dst=/keys,readonly",
    name,
  );
  containerStarted = true;
  const sshPort = "2222";
  const dockerBin = run("/bin/sh", ["-c", "command -v docker"]);
  const proxy = [
    dockerBin,
    "--host",
    env.DOCKER_HOST,
    "exec",
    "-i",
    name,
    "/usr/local/bin/bun",
    "/opt/fixture/ssh-proxy.ts",
  ]
    .map(quote)
    .join(" ");
  const sshConfig = join(home, ".ssh", "config");
  writeFileSync(
    join(home, ".ssh", "known_hosts"),
    "[127.0.0.1]:" + sshPort + " " + readFileSync(join(root, "hostkey.pub"), "utf8"),
    { mode: 0o600 },
  );
  writeFileSync(
    sshConfig,
    [
      "Host " + ALIAS,
      "  HostName 127.0.0.1",
      "  User root",
      "  Port " + sshPort,
      "  ProxyCommand " + proxy,
      "  IdentityFile " + join(root, "client"),
      "  IdentitiesOnly yes",
      "  IdentityAgent none",
      "  ForwardAgent no",
      "  StrictHostKeyChecking yes",
      "  UserKnownHostsFile " + join(home, ".ssh", "known_hosts"),
      "  GlobalKnownHostsFile /dev/null",
      "  UpdateHostKeys no",
      "  BatchMode yes",
      "  ConnectTimeout 3",
      "  ControlMaster no",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const sshBin = run("/bin/sh", ["-c", "command -v ssh"]);
  writeFileSync(
    join(root, "bin", "ssh"),
    "#!/bin/sh\nexec " + [sshBin, "-F", sshConfig].map(quote).join(" ") + ' "$@"\n',
    {
      mode: 0o755,
    },
  );
  env.PATH = join(root, "bin") + ":" + env.PATH;
  const ssh = (...args: string[]) => run(sshBin, ["-F", sshConfig, ALIAS, ...args]);
  await wait(
    "isolated SSH ready",
    () => raw(sshBin, ["-F", sshConfig, ALIAS, "true"], { timeout: 5000 }).status === 0,
    20000,
  );
  await wait(
    "fake inference ready",
    () => {
      const r = raw("docker", [
        "exec",
        name,
        "/usr/local/bin/bun",
        "-e",
        'const r=await fetch("http://127.0.0.1:18765/health");process.exit(r.ok?0:1)',
      ]);
      return r.status === 0;
    },
    20000,
  );

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
  const start = () => {
    const command = [
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
    tmux(
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
    ptyStarted = true;
  };
  const ready = () => wait("root controls", () => screen().includes("/questions") && screen().includes("/close"));
  const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
  const view = () => strip(screen());
  start();
  await ready();
  await wait("root record", () => !!rootState().record?.sessionFile);
  const initial = rootState(),
    id = initial.intent.sessionId;
  capture("01-start", "Start a root session on studio · authorization already completed", 0);
  type("Please add getting-started notes. Ask a helper to review the guide first.");
  await wait("saved question", () => view().includes("saved a question"), 120000);
  assert.equal(
    view()
      .split("\n")
      .filter((line) => line.trim() === "↗ Review the project guide").length,
    1,
    "one active canonical helper row",
  );
  assert(!view().includes("✓ Ask a helper to review the guide"), "no separate checked helper-launch action");
  capture("02-work", "The root asks a normal helper to review the guide in a server worktree", 8);
  // Verify actual server child placement in its authoritative journal, offscreen.
  await wait(
    "child finished",
    () => ssh("cat /tmp/root-placement-inference.jsonl").includes("suggest a short getting-started"),
    120000,
  );
  type("/ps");
  await wait("jobs menu", () => view().includes("Jobs"));
  capture("03-jobs", "/ps · ordinary task list for the server-local helper", 18);
  key("Escape");
  await Bun.sleep(300);
  type("/questions");
  await wait("questions menu", () => view().includes("Human questions") && view().includes(QUESTION));
  capture("04-questions", "/questions · a saved preference waiting for your answer", 26);
  key("Escape");
  await Bun.sleep(300);
  key("C-d");
  await wait("detach", () => tmux("display-message", "-p", "-t", "root-placement", "#{pane_dead}") === "1");
  assert.equal(tmux("display-message", "-p", "-t", "root-placement", "#{pane_dead_status}"), "0");
  capture("05-detached", "Detach locally · the server root and saved question are retained", 34); // Last actual terminal view; successful detach verified above.
  tmux("kill-session", "-t", "root-placement");
  ptyStarted = false;
  start();
  await ready();
  assert.equal(rootState().intent.sessionId, id);
  type("/questions");
  await wait("reopened question", () => view().includes("Human questions") && view().includes(QUESTION));
  capture("06-reopened", "Reopen on studio · the same saved question is still waiting", 40);
  key("Enter");
  await wait("answer choices", () => view().includes(ANSWER));
  capture("07-choice", "Choose the level of detail using the normal question picker", 48);
  key("Enter");
  await wait("notes written", () => pane().includes("Added concise getting-started notes"), 120000);
  await Bun.sleep(200);
  assert(!view().includes("Execution failed"), "Do not capture a failed tool as success");
  assert.equal(
    view()
      .split("\n")
      .filter((line) => line.trim() === "✓ Review the project guide").length,
    1,
    "one successful canonical helper row after reopen",
  );
  assert(!view().includes("✓ Ask a helper to review the guide"), "reopen must not duplicate helper-launch success");
  capture("08-written", "The root writes NOTES.md after your answer", 56);
  assert.equal(readFileSync(join(repo, "NOTES.md"), "utf8"), "# Getting started\n\nNotes to follow.\n");
  type("/close");
  await wait("source return", () => view().includes("Source return: applied"), 120000);
  capture("09-return", "/close · changes return safely to the local project", 65);
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
  const child = jobLists.flat().find((j: any) => j.title === "Review the project guide");
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
          "scripts/task-placement-clean-capture.ts",
          "scripts/task-placement-clean-video.py",
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
  if (containerStarted) {
    for (const file of [
      "root-placement-inference.jsonl",
      "root-placement-provider-errors",
      "root-placement-provider.log",
    ])
      raw("docker", ["cp", name + ":/tmp/" + file, join(artifacts, file)]);
    writeFileSync(join(artifacts, "docker.log"), raw("docker", ["logs", name]).stderr);
  }
  if (ptyStarted) {
    try {
      capture(passed ? "final-pane" : "failure-pane");
    } catch {}
    raw("tmux", ["-S", socket, "kill-server"]);
  }
  for (const [i, file] of rootFiles().entries())
    copyFileSync(file, join(artifacts, "diagnostics", "final-root-" + i + ".json"));
  if (containerStarted) raw("docker", ["rm", "-f", name]);
  if (imageBuilt) raw("docker", ["image", "rm", name]);
  rmSync(root, { recursive: true, force: true });
  console.log("Clean presentation artifacts:", artifacts);
}
