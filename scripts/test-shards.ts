import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Rounded seconds from ci-speed-expanded-full.log. Everything else gets the
// same small weight; this balances work, never selects/skips tests.
const costs: Record<string, number> = {
  "tests/live-speaker-check.test.ts": 18,
  "tests/ci-remote-cli-source.test.ts": 12,
  "tests/task-monitor-tui.test.ts": 10,
  "tests/job-bridge.test.ts": 8,
  "tests/typescript-images.test.ts": 7,
  "tests/pi-host.test.ts": 6,
  "tests/t3/web-launcher-process.test.ts": 6,
  "tests/live-picker-tui.test.ts": 5,
  "tests/live-main-integration.test.ts": 5,
  "tests/typescript-execution.test.ts": 5,
  "tests/t3/web-runtime.test.ts": 5,
  "tests/typescript-runner.test.ts": 5,
};

export async function discoverTests(root: string): Promise<string[]> {
  return Array.from(new Bun.Glob("tests/**/*.test.ts").scanSync({ cwd: root, onlyFiles: true })).sort();
}

export function assertPartition(files: string[], shards: string[][]): void {
  const all = shards.flat().sort();
  const expected = [...files].sort();
  if (
    new Set(all).size !== all.length ||
    new Set(expected).size !== expected.length ||
    all.length !== expected.length ||
    all.some((file, i) => file !== expected[i])
  ) {
    throw new Error("Shard partition has duplicates, omissions or unexpected tests");
  }
}

export function partitionTests(files: string[], count: number): string[][] {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("shards must be 1..4");
  if (!files.length) throw new Error("No tests discovered");
  const shards: string[][] = Array.from({ length: Math.min(count, files.length) }, () => []);
  const weights = shards.map(() => 0);
  const weight = (file: string) => costs[file] ?? 0.25;
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0))) {
    const index = weights.indexOf(Math.min(...weights));
    shards[index]?.push(file);
    weights[index] = (weights[index] ?? 0) + weight(file);
  }
  for (const shard of shards) shard.sort();
  assertPartition(files, shards);
  return shards;
}

export function logResult(text: string, files: string[]) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Bun terminal coloring is not test coverage.
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
  const observed = Array.from(clean.matchAll(/^tests\/.*\.test\.ts:$/gm), (m) => m[0].slice(0, -1));
  let complete = true;
  try {
    assertPartition(files, [observed]);
  } catch {
    complete = false;
  }
  const total = (kind: string) => Number(clean.match(new RegExp(`^\\s*(\\d+) ${kind}\\s*$`, "m"))?.[1] ?? 0);
  const summary = clean.match(/Ran (\d+) tests? across (\d+) files?\./);
  const pass = total("pass"),
    skip = total("skip"),
    fail = total("fail");
  complete &&= !!summary && Number(summary[1]) === pass + skip + fail && Number(summary[2]) === files.length;
  return { pass, skip, fail, complete };
}

export async function runShards(root: string, count: number, logRoot: string, bun = process.execPath) {
  const files = await discoverTests(root);
  const shards = partitionTests(files, count);
  await mkdir(logRoot, { recursive: true });
  const logs = await mkdtemp(join(logRoot, "run-"));
  const sandbox = await mkdtemp(join(tmpdir(), "die-tests-"));
  // Keep tmux Unix sockets short even with a long TMPDIR.
  const sockets = await mkdtemp("/tmp/die-tmux-");
  await writeFile(join(logs, "partition.json"), JSON.stringify({ files, shards }, null, 2));
  const groups = new Set<number>();
  let interrupted = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    for (const pid of groups) {
      try {
        process.kill(-pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") console.error(error);
      }
    }
  };
  const cancel = () => {
    interrupted = true;
    kill("SIGTERM");
    escalation ??= setTimeout(() => kill("SIGKILL"), 2_000);
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  const started = performance.now();
  console.log(`Running ${files.length} files in ${shards.length} processes; logs: ${logs}`);
  try {
    const results = await Promise.all(
      shards
        .map(async (shard, index) => {
          const base = join(sandbox, String(index + 1));
          for (const dir of ["home", "tmp"]) await mkdir(join(base, dir), { recursive: true });
          await mkdir(join(sockets, String(index + 1)));
          const log = join(logs, `shard-${index + 1}.log`);
          const fd = openSync(log, "w");
          let error: string | undefined;
          let code: number | null = null;
          const start = performance.now();
          try {
            if (interrupted) throw new Error("Cancelled before spawn");
            code = await new Promise<number | null>((done) => {
              const child = spawn(bun, ["test", ...shard.map((file) => `./${file}`)], {
                cwd: root,
                detached: true,
                stdio: ["ignore", fd, fd],
                env: {
                  ...process.env,
                  DIE_RUN_LLM_TESTS: "0",
                  HOME: join(base, "home"),
                  TMPDIR: join(base, "tmp"),
                  TMP: join(base, "tmp"),
                  TEMP: join(base, "tmp"),
                  TMUX_TMPDIR: join(sockets, String(index + 1)),
                  NO_COLOR: "1",
                  FORCE_COLOR: "0",
                },
              });
              if (child.pid) groups.add(child.pid);
              child.once("error", (err) => {
                error = String(err);
                done(null);
              });
              child.once("close", (exitCode) => {
                done(exitCode);
              });
            });
          } catch (err) {
            error = String(err);
          } finally {
            closeSync(fd);
          }
          const totals = logResult(await readFile(log, "utf8"), shard);
          const result = { shard: index + 1, code, error, seconds: (performance.now() - start) / 1000, ...totals };
          console.log(
            `Shard ${index + 1}: exit=${code}, ${totals.pass} pass, ${totals.skip} skip, ${totals.fail} fail; ${log}`,
          );
          return result;
        })
        .map((task, index) =>
          task.catch((error) => {
            console.error(`Shard ${index + 1} failed:`, error);
            return {
              shard: index + 1,
              code: null,
              error: String(error),
              seconds: 0,
              pass: 0,
              skip: 0,
              fail: 0,
              complete: false,
            };
          }),
        ),
    );
    const ok = !interrupted && results.every((r) => r.code === 0 && !r.error && r.complete && r.fail === 0);
    const summary = {
      ok,
      interrupted,
      seconds: (performance.now() - started) / 1000,
      pass: results.reduce((n, r) => n + r.pass, 0),
      skip: results.reduce((n, r) => n + r.skip, 0),
      fail: results.reduce((n, r) => n + r.fail, 0),
      results,
    };
    await writeFile(join(logs, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(
      `${summary.pass} pass, ${summary.skip} skip, ${summary.fail} fail in ${summary.seconds.toFixed(2)}s; ${ok ? "PASS" : "FAIL (see logs/summary.json)"}`,
    );
    return { ...summary, logs };
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    if (escalation) clearTimeout(escalation);
    kill("SIGKILL");
    // tmux daemonizes outside the test process group. Only inspect owned sockets.
    for (const entry of readdirSync(sockets, { recursive: true, withFileTypes: true })) {
      if (entry.isSocket())
        spawnSync("tmux", ["-S", join(entry.parentPath, entry.name), "kill-server"], { stdio: "ignore" });
    }
    await rm(sandbox, { recursive: true, force: true });
    await rm(sockets, { recursive: true, force: true });
  }
}

export async function verifyBuild(root: string) {
  const pkg = await Bun.file(join(root, "package.json")).json();
  const assets = await Bun.file(join(root, "runtime-assets/package.json")).json();
  if (assets.version !== pkg.version) throw new Error("Prepare assets/build once before running shards");
  const home = await mkdtemp(join(tmpdir(), "die-version-"));
  try {
    const child = Bun.spawn([join(root, "dist/die"), "--version"], {
      cwd: root,
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0 || stdout.trim() !== pkg.version) {
      throw new Error(`dist/die must match package.json; build once before sharding: ${stdout}${stderr}`);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    let count = 4,
      logs = "artifacts/ci/test-shards";
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      const value = args[i + 1];
      if (args[i] === "--shards" && value) count = Number(value);
      else if (args[i] === "--log-dir" && value) logs = value;
      else throw new Error("usage: bun scripts/test-shards.ts [--shards 1..4] [--log-dir PATH]");
    }
    await verifyBuild(process.cwd());
    const result = await runShards(process.cwd(), count, resolve(logs));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
