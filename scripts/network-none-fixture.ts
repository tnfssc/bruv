/** Owned offline Docker/SSH lifecycle. Scenario assertions and evidence stay with callers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
export const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export const wait = async (label: string, fn: () => boolean, timeout = 60000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw Error("Timed out: " + label);
    await Bun.sleep(100);
  }
};
export function networkNoneFixture(options: {
  root: string;
  name: string;
  alias: string;
  bun: string;
  binary?: string;
  base: string;
  buildArg: string;
  files: Record<string, string>;
  replyLoss?: string;
}) {
  const { root, name, bun, binary, base } = options;
  const home = join(root, "home"),
    agent = join(home, "agent"),
    build = join(root, "build"),
    repo = join(root, "repo");
  const faultDir = join(root, "reply-loss");
  for (const dir of [
    home,
    agent,
    build,
    repo,
    join(home, ".ssh"),
    join(home, ".bruv"),
    join(root, "keys"),
    join(root, "bin"),
    ...(options.replyLoss ? [faultDir] : []),
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

  let containerStarted = false,
    imageBuilt = false;
  return {
    home,
    agent,
    repo,
    env,
    raw,
    run,
    docker,
    faultDir,
    get containerStarted() {
      return containerStarted;
    },
    async start() {
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
      if (binary) assert(existsSync(binary), "BRUV_BIN is missing");
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
      for (const [file, path] of Object.entries(options.files)) copyFileSync(path, join(build, file));
      copyFileSync(bun, join(build, "runtime", "bun"));
      chmodSync(join(build, "runtime", "bun"), 0o755);
      if (binary) {
        copyFileSync(binary, join(build, "runtime", "bruv"));
        chmodSync(join(build, "runtime", "bruv"), 0o755);
      }
      copyFileSync(join(root, "hostkey"), join(root, "keys", "hostkey"));
      copyFileSync(join(root, "client.pub"), join(root, "keys", "client.pub"));
      run(
        "docker",
        [
          "build",
          "--network",
          "none",
          "--pull=false",
          "--build-arg",
          "" + options.buildArg + "=" + imageId,
          "-t",
          name,
          build,
        ],
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
          "Host " + options.alias,
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
        "#!/bin/sh\nexec " +
          (options.replyLoss ? [bun, options.replyLoss, sshBin, sshConfig, faultDir] : [sshBin, "-F", sshConfig])
            .map(quote)
            .join(" ") +
          ' "$@"\n',
        {
          mode: 0o755,
        },
      );
      env.PATH = join(root, "bin") + ":" + env.PATH;
      const ssh = (...args: string[]) => run(sshBin, ["-F", sshConfig, options.alias, ...args]);
      await wait(
        "isolated SSH ready",
        () => raw(sshBin, ["-F", sshConfig, options.alias, "true"], { timeout: 5000 }).status === 0,
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

      return { imageId, ssh };
    },
    cleanup() {
      if (containerStarted) raw("docker", ["rm", "-f", name]);
      if (imageBuilt) raw("docker", ["image", "rm", name]);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function assertFixtureOutputExternal(source: string, path: string) {
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
