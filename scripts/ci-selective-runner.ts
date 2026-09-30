import { remoteSourceCommands } from "./ci-remote-source";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The only overlapping batch is the three audited remote-source-only processes.
 * Prerequisites and mixed selections stay serial. No intra-Bun concurrency flags. */
export function remoteBatchStart(p: { selected: string[]; commands: string[][] }): number | undefined {
  if (p.selected.length !== 1 || p.selected[0] !== "remote-source" || p.commands.length !== 9) return;
  const base = p.commands[7].at(-1)?.match(/^--changed=([a-f0-9]{40,64})$/)?.[1];
  if (!base) return;
  const expected = [
    ...remoteSourceCommands(base, "bun")
      .slice(1)
      .map((c) => c.argv),
    ["bun", "test", "./tests/pi-host.test.ts", "--test-name-pattern", "^source CLI"],
  ];
  return JSON.stringify(p.commands.slice(6)) === JSON.stringify(expected) ? 6 : undefined;
}

export async function runSelectedCommands(
  commands: string[][],
  options: { parallelStart?: number; preparedDeps?: boolean; cwd?: string; logDir?: string } = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const logDir = resolve(cwd, options.logDir ?? "artifacts/ci/groups");
  mkdirSync(logDir, { recursive: true });
  rmSync(join(logDir, "summary.log"), { force: true });
  const root = mkdtempSync(join(tmpdir(), "die-selective-"));
  const active = new Set<ChildProcess>();
  const groups = new Set<number>();
  let cancelled = 0;
  let cancellationCleanup: Promise<void> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    if (process.platform !== "win32") {
      for (const pid of groups) {
        try {
          process.kill(-pid, signal);
        } catch {
          /* already exited */
        }
      }
    } else {
      for (const child of active) child.kill(signal);
    }
  };
  const interrupt = (signal: NodeJS.Signals) => {
    cancelled = signal === "SIGINT" ? 130 : 143;
    kill("SIGTERM");
    // Keep group IDs even when a leader exits before its descendants. This
    // grace is cancellation-only, never a shorter test deadline.
    cancellationCleanup ??= new Promise<void>((done) => {
      setTimeout(() => {
        kill("SIGKILL");
        done();
      }, 2000);
    });
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const run = async (command: string[], index: number): Promise<number> => {
    const group = String(index + 1).padStart(2, "0");
    const temp = mkdtempSync(join(root, "group-"));
    const path = join(logDir, `${group}.log`);
    const fd = openSync(path, "w");
    const started = performance.now();
    console.error(`==> group ${group} ${JSON.stringify(command)} log=${path}`);
    let status = 1;
    try {
      status = await new Promise<number>((done) => {
        const child = spawn(command[0], command.slice(1), {
          cwd,
          detached: process.platform !== "win32",
          stdio: ["ignore", fd, fd],
          env: {
            ...process.env,
            TMPDIR: temp,
            TMUX_TMPDIR: temp,
            DIE_RUN_LLM_TESTS: "0",
            DIE_PROBE_EXECUTABLE: join(cwd, "tests/fixtures/live-execute-cli.sh"),
          },
        });
        active.add(child);
        if (child.pid) groups.add(child.pid);
        child.on("error", (error) => appendFileSync(path, `spawn error: ${error.message}\n`));
        child.on("close", (code, signal) => {
          active.delete(child);
          // Retain group IDs through the run: a leader can exit before descendants.
          if (signal) console.error(`group ${group} signal: ${signal}`);
          done(code !== null && code >= 0 ? code : 1);
        });
      });
    } finally {
      closeSync(fd);
      console.error(`==> group ${group} output`);
      // Keep complete logs on disk and replay without capture/buffer limits.
      process.stderr.write(readFileSync(path));
      const summary = `group ${group} exit=${status} elapsed ms: ${Math.round(performance.now() - started)}\n`;
      console.error(summary.trimEnd());
      appendFileSync(join(logDir, "summary.log"), summary);
    }
    return status;
  };
  try {
    for (let i = 0; i < commands.length; i++) {
      if (cancelled) return cancelled;
      if (options.preparedDeps && commands[i][1] === "install") continue;
      if (i === options.parallelStart) {
        const results = await Promise.all(commands.slice(i).map((command, offset) => run(command, i + offset)));
        const status = cancelled || results.find((status) => status !== 0) || 0;
        const summary = `remote batch exits: ${results.join(", ")}; overall exit=${status}\n`;
        console.error(summary.trimEnd());
        appendFileSync(join(logDir, "summary.log"), summary);
        return status;
      }
      const status = await run(commands[i], i);
      if (status) return cancelled || status;
    }
    return cancelled;
  } finally {
    if (cancellationCleanup) await cancellationCleanup;
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    // tmux deliberately daemonizes outside the test process group. Its sockets
    // are confined to our group temp directories; stop only those servers.
    for (const group of readdirSync(root)) {
      const sockets = join(root, group, `tmux-${process.getuid?.()}`);
      try {
        for (const socket of readdirSync(sockets, { withFileTypes: true })) {
          if (socket.isSocket())
            spawnSync("tmux", ["-S", join(sockets, socket.name), "kill-server"], { stdio: "ignore" });
        }
      } catch {
        /* no tmux server in this group */
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
}
