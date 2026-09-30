import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertPartition,
  discoverTests,
  logResult,
  partitionTests,
  runShards,
  verifyBuild,
} from "../scripts/test-shards";

test("partition is deterministic, complete and bounded for discovered/new files", async () => {
  const files = await discoverTests(resolve(import.meta.dir, ".."));
  files.push("tests/new/deep/future.test.ts");
  for (const count of [1, 2, 3, 4]) {
    const shards = partitionTests(files, count);
    assertPartition(files, shards);
    expect(shards).toEqual(partitionTests([...files].reverse(), count));
    expect(shards).toHaveLength(count);
    expect(shards.flat()).toContain("tests/new/deep/future.test.ts");
  }
  for (const count of [0, 5, 1.5, NaN]) expect(() => partitionTests(files, count)).toThrow();
  expect(() => partitionTests([], 4)).toThrow();
  expect(() => assertPartition(["a", "b"], [["a"], ["a"]])).toThrow();
  expect(() => assertPartition(["a", "b"], [["a"]])).toThrow();
  expect(() => assertPartition(["a"], [["a", "b"]])).toThrow();
});

test("zero exit without complete test output cannot be green", () => {
  const text = "tests/a.test.ts:\n 1 pass\n 1 skip\n 0 fail\nRan 2 tests across 1 file. [1ms]\n";
  expect(logResult(text, ["tests/a.test.ts"])).toEqual({ pass: 1, skip: 1, fail: 0, complete: true });
  expect(logResult(text, ["tests/a.test.ts", "tests/b.test.ts"]).complete).toBe(false);
  expect(logResult("", ["tests/a.test.ts"]).complete).toBe(false);
  expect(logResult(text.replace("Ran 2", "Ran 3"), ["tests/a.test.ts"]).complete).toBe(false);
});

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "shard-fixture-"));
  await mkdir(join(root, "tests/nested"), { recursive: true });
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("real processes include nested/new tests, preserve skips, isolate state and retain logs", async () => {
  await fixture(async (root) => {
    for (const path of ["tests/a.test.ts", "tests/nested/b.test.ts"]) {
      await writeFile(
        join(root, path),
        "import { expect, test } from 'bun:test';\n" +
          "import { join } from 'node:path';\n" +
          "test('isolated', async () => {\n" +
          "expect(process.env.DIE_RUN_LLM_TESTS).toBe('0');\n" +
          "expect(await Bun.file(join(process.env.HOME!, 'marker')).exists()).toBe(false);\n" +
          "await Bun.write(join(process.env.HOME!, 'marker'), 'mine');\n" +
          "console.log('ISOLATION', process.env.HOME, process.env.TMPDIR, process.env.TMUX_TMPDIR);\n" +
          "});\ntest.skipIf(process.env.DIE_RUN_LLM_TESTS !== '1')('opt in', () => {});\n",
      );
    }
    const result = await runShards(root, 4, join(root, "logs"));
    expect(result.ok).toBe(true);
    expect(result.pass).toBe(2);
    expect(result.skip).toBe(2);
    const texts = await Promise.all([1, 2].map((n) => readFile(join(result.logs, "shard-" + n + ".log"), "utf8")));
    expect(texts[0]).toContain("ISOLATION");
    expect(texts[1]).toContain("ISOLATION");
    expect(texts[0]!.match(/ISOLATION (.+)/)?.[1]).not.toBe(texts[1]!.match(/ISOLATION (.+)/)?.[1]);
    expect(JSON.parse(await readFile(join(result.logs, "partition.json"), "utf8")).files).toHaveLength(2);
  });
});

test("any failure or failed spawn fails without dropping the other shard", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "tests/a.test.ts"),
      "import {expect,test} from 'bun:test'; test('bad',()=>expect(1).toBe(2));",
    );
    await writeFile(join(root, "tests/nested/b.test.ts"), "import {test} from 'bun:test'; test('good',()=>{});");
    const failed = await runShards(root, 2, join(root, "logs"));
    expect(failed.ok).toBe(false);
    expect(failed.fail).toBe(1);
    expect(failed.pass).toBe(1);
    expect(failed.results).toHaveLength(2);
    const missing = await runShards(root, 2, join(root, "logs"), join(root, "nonexistent-bun"));
    expect(missing.ok).toBe(false);
    expect(missing.results.every((r) => r.code === null && r.error)).toBe(true);
    expect(JSON.parse(await readFile(join(missing.logs, "summary.json"), "utf8")).ok).toBe(false);
    await mkdir(join(root, "runtime-assets"));
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    await writeFile(join(root, "runtime-assets/package.json"), JSON.stringify({ version: "old" }));
    await expect(verifyBuild(root)).rejects.toThrow("Prepare assets/build once");
    await writeFile(join(root, "runtime-assets/package.json"), JSON.stringify({ version: "1.2.3" }));
    await writeFile(join(root, "dist/die"), "#!/bin/sh\necho old\n", { mode: 0o755 });
    await expect(verifyBuild(root)).rejects.toThrow("dist/die must match");
    await writeFile(join(root, "dist/die"), "#!/bin/sh\necho 1.2.3\n", { mode: 0o755 });
    await verifyBuild(root);
  });
});

test("cancellation returns failure and terminates the shard process group", async () => {
  await fixture(async (root) => {
    const script = resolve(import.meta.dir, "../scripts/test-shards.ts");
    await writeFile(
      join(root, "run.ts"),
      "import {runShards} from " +
        JSON.stringify(script) +
        ";\n" +
        "const r = await runShards(process.cwd(), 1, './logs'); process.exitCode = r.ok ? 0 : 1;",
    );
    await writeFile(
      join(root, "tests/a.test.ts"),
      "import {test} from 'bun:test';\n" +
        "test('wait', async()=>{ const child=Bun.spawn(['/bin/sh','-c','trap \\\"\\\" TERM; while :; do sleep 1; done'],{stdout:'ignore',stderr:'ignore'});" +
        "const socket='cancel-'+process.pid; let tmux=0; if(Bun.which('tmux')) {" +
        "if(Bun.spawnSync(['tmux','-L',socket,'new-session','-d','sleep 30']).exitCode) throw new Error('tmux spawn');" +
        "tmux=Number(Bun.spawnSync(['tmux','-L',socket,'display-message','-p','#{pid}']).stdout.toString().trim()); }" +
        "await Bun.write('ready', JSON.stringify({pid:child.pid,tmux})); await Bun.sleep(30000); });",
    );
    const child = Bun.spawn([process.execPath, join(root, "run.ts")], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    try {
      const until = Date.now() + 3000;
      while (!(await Bun.file(join(root, "ready")).exists()) && Date.now() < until) await Bun.sleep(20);
      expect(await Bun.file(join(root, "ready")).exists()).toBe(true);
      const state = JSON.parse(await readFile(join(root, "ready"), "utf8"));
      child.kill("SIGTERM");
      expect(await child.exited).not.toBe(0);
      const output = await stdout;
      await stderr;
      const logs = output.match(/logs: (.+)/)![1]!;
      const summary = JSON.parse(await readFile(join(root, logs, "summary.json"), "utf8"));
      expect(summary.interrupted).toBe(true);
      expect(summary.ok).toBe(false);
      await Bun.sleep(50);
      for (const pid of [state.pid, state.tmux].filter(Boolean)) {
        const ps = Bun.spawn(["ps", "-o", "stat=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
        const status = (await new Response(ps.stdout).text()).trim();
        await ps.exited;
        expect(status === "" || status.startsWith("Z")).toBe(true);
      }
    } finally {
      child.kill("SIGKILL");
      await child.exited;
      await Promise.all([stdout, stderr]);
    }
  });
}, 10000);
