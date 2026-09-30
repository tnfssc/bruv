import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteBatchStart, runSelectedCommands } from "../scripts/ci-selective-runner";
import { select } from "../scripts/ci-selective";
import { remoteSourceCommands } from "../scripts/ci-remote-source";

const base = "a".repeat(40);
const plan = select([{ status: "M", paths: ["src/remote/client.ts"] }], undefined, base);
const command = (source: string) => [process.execPath, "-e", source];

test("exact remote-only plan retains all commands; mixed union is serial", () => {
  expect(plan.selected).toEqual(["remote-source"]);
  expect(remoteBatchStart(plan)).toBe(6);
  const changed = structuredClone(plan);
  changed.commands[8].push("--concurrent");
  expect(remoteBatchStart(changed)).toBeUndefined();
  expect(plan.commands.slice(6)).toEqual([
    ...remoteSourceCommands(base, "bun")
      .slice(1)
      .map((c) => c.argv),
    ["bun", "test", "./tests/pi-host.test.ts", "--test-name-pattern", "^source CLI"],
  ]);
  expect(plan.commands.slice(0, 6)).toEqual([
    ["bun", "install", "--frozen-lockfile"],
    ["bun", "run", "prepare:assets"],
    ["node_modules/.bin/biome", "format", "src/remote/client.ts"],
    ["node_modules/.bin/biome", "lint", "src/remote/client.ts"],
    ["bun", "run", "check"],
    ["bun", "test", "./tests/ci-selective.test.ts", "./tests/ci-remote-source.test.ts"],
  ]);
  const mixed = select(
    [
      { status: "M", paths: ["src/remote/client.ts"] },
      { status: "M", paths: ["src/live/waveform.ts"] },
    ],
    undefined,
    base,
  );
  expect(remoteBatchStart(mixed)).toBeUndefined();
  for (const c of plan.commands.slice(6)) expect(mixed.commands).toContainEqual(c);
  expect(mixed.commands.flat()).toContain("./tests/live-waveform.test.ts");
  expect(remoteBatchStart(select([{ status: "M", paths: ["src/remote/human-rendering.ts"] }]))).toBeUndefined();
});

test("serial prerequisites, concurrent workers, no skipping, failure and isolated tmp/logs", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "selective-runner-test-"));
  try {
    const prerequisite = (n: number) =>
      command(
        "import {existsSync,writeFileSync} from 'node:fs'; if (" +
          n +
          " > 0 && !existsSync('pre' + (" +
          n +
          " - 1))) process.exit(8); await Bun.sleep(20); writeFileSync('pre" +
          n +
          "', 'ok');",
      );
    const worker = (n: number) =>
      command(
        "import {existsSync,writeFileSync} from 'node:fs'; if (!existsSync('pre1')) process.exit(9); writeFileSync('start" +
          n +
          "',process.env.TMPDIR); for(let i=0;i<200 && ![0,1,2].every(n=>existsSync('start'+n));i++) await Bun.sleep(10); if(![0,1,2].every(n=>existsSync('start'+n))) process.exit(10); console.log('stdout-" +
          n +
          "'); console.error('stderr-" +
          n +
          "'); writeFileSync('done" +
          n +
          "','ok'); process.exit(" +
          (n === 1 ? 7 : 0) +
          ");",
      );
    expect(
      await runSelectedCommands([prerequisite(0), prerequisite(1), worker(0), worker(1), worker(2)], {
        cwd,
        parallelStart: 2,
      }),
    ).toBe(7);
    const temps = [0, 1, 2].map((n) => readFileSync(join(cwd, "start" + n), "utf8"));
    expect(new Set(temps).size).toBe(3);
    for (const temp of temps) expect(existsSync(temp)).toBe(false);
    for (let n = 0; n < 3; n++) {
      expect(existsSync(join(cwd, "done" + n))).toBe(true);
      const log = readFileSync(join(cwd, "artifacts/ci/groups", String(n + 3).padStart(2, "0") + ".log"), "utf8");
      expect(log).toContain("stdout-" + n);
      expect(log).toContain("stderr-" + n);
    }
    expect(readdirSync(join(cwd, "artifacts/ci/groups")).length).toBe(6);
    expect(readFileSync(join(cwd, "artifacts/ci/groups/summary.log"), "utf8")).toContain("exit=7");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 10000);

test("failed prerequisite never launches workers; spawn errors cannot pass", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "selective-runner-test-"));
  try {
    expect(
      await runSelectedCommands([command("process.exit(4)"), command("await Bun.write('bad','bad')")], {
        cwd,
        parallelStart: 1,
      }),
    ).toBe(4);
    expect(existsSync(join(cwd, "bad"))).toBe(false);
    expect(await runSelectedCommands([[join(cwd, "missing")]], { cwd })).toBe(1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("SIGTERM cancels workers and descendants, cleans TMPDIR, and cannot report success", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "selective-cancel-test-"));
  const helper = join(import.meta.dir, "../scripts/ci-selective-runner.ts");
  const worker = command(
    "const child = Bun.spawn([process.execPath,'-e', \"process.on('SIGTERM',()=>{}); await Bun.sleep(30000)\"],{stdio:['ignore','ignore','ignore']}); const socket='cancel-'+process.pid; if(Bun.spawnSync(['tmux','-L',socket,'new-session','-d','sleep 30']).exitCode) process.exit(5); const tmux=Number(Bun.spawnSync(['tmux','-L',socket,'display-message','-p','#{pid}']).stdout.toString().trim()); await Bun.write('ready',JSON.stringify({pid:process.pid,child:child.pid,tmux,tmp:process.env.TMPDIR})); process.exit(0);",
  );
  const source =
    "import {runSelectedCommands} from " +
    JSON.stringify(helper) +
    "; process.exitCode=await runSelectedCommands(" +
    JSON.stringify([worker, command("await Bun.write('waiting','yes'); await Bun.sleep(30000)")]) +
    ", {cwd:" +
    JSON.stringify(cwd) +
    ",parallelStart:0});";
  const proc = Bun.spawn([process.execPath, "-e", source], { stdout: "ignore", stderr: "pipe" });
  const output = new Response(proc.stderr).text();
  try {
    for (let i = 0; i < 300 && !existsSync(join(cwd, "ready")); i++) await Bun.sleep(10);
    expect(existsSync(join(cwd, "ready"))).toBe(true);
    const state = JSON.parse(readFileSync(join(cwd, "ready"), "utf8"));
    for (let i = 0; i < 300; i++) {
      const summary = join(cwd, "artifacts/ci/groups/summary.log");
      if (
        existsSync(summary) &&
        readFileSync(summary, "utf8").includes("group 01 exit=0") &&
        existsSync(join(cwd, "waiting"))
      )
        break;
      await Bun.sleep(10);
    }
    expect(readFileSync(join(cwd, "artifacts/ci/groups/summary.log"), "utf8")).toContain("group 01 exit=0");
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(143);
    expect(await output).toContain("exit=1");
    expect(existsSync(state.tmp)).toBe(false);
    for (const pid of [state.pid, state.child, state.tmux]) {
      // A killed grandchild may briefly be a zombie awaiting init's reap.
      let alive = false;
      try {
        alive = readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1][0] !== "Z";
      } catch {}
      expect(alive).toBe(false);
    }
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(cwd, { recursive: true, force: true });
  }
}, 10000);
