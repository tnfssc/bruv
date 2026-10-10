import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Jobs } from "../src/jobs";

mkdirSync(".tmp", { recursive: true });
const dir = mkdtempSync(resolve(".tmp/jobs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function start(jobs: Jobs, command: string, timeoutSeconds?: number) {
  const item = jobs.create("job", command, dir);
  void jobs.run(item, () => jobs.process(item, "/bin/sh", ["-c", command], dir, { timeoutSeconds }));
  return item;
}

test("registry records output, exit codes, previews, waits and IDs", async () => {
  const jobs = new Jobs();
  const first = start(jobs, "sleep 0.2; echo done; echo err >&2");
  const second = start(jobs, "exit 3");
  expect(jobs.list().map((item) => item.id)).toEqual(["j1", "j2"]);
  const early = await jobs.wait(undefined, false);
  expect(early.done.map((item) => item.exitCode)).toEqual([3]);
  expect(early.running.map((item) => item.id)).toEqual([first.id]);
  await jobs.wait(undefined, true);
  expect(jobs.result(first).output).toBe("done\nerr\n");
  expect(second.status).toBe("failed");
  jobs.append(first, "x".repeat(70000));
  expect(first.tail.byteLength).toBe(65536);
  expect(jobs.result(first).output.length).toBe(4000);
  expect(readFileSync(first.outputPath).length).toBeGreaterThan(70000);
  expect(await jobs.wait([], true)).toEqual({ done: [], running: [], userMessagePending: false });
  expect(() => jobs.get("missing")).toThrow();
});

test("wait returns on timeout, a user message, and abort without stopping work", async () => {
  const jobs = new Jobs();
  const item = start(jobs, "sleep 0.2");
  expect((await jobs.wait([item.id], true, 0)).running).toHaveLength(1);
  expect((await jobs.wait([item.id], true, 600, () => true)).userMessagePending).toBe(true);
  const abort = new AbortController();
  const waiting = jobs.wait([item.id], true, 600, () => false, abort.signal);
  abort.abort();
  expect((await waiting).running).toHaveLength(1);
  await item.completion;
  expect(item.status).toBe("done");
  expect(jobs.listeners.size).toBe(0);
});

test("stop kills the process group including a child that ignores TERM", async () => {
  const jobs = new Jobs();
  const ready = Promise.withResolvers<void>();
  const item = jobs.create("job", "group", dir);
  void jobs.run(item, () =>
    jobs.process(
      item,
      "/bin/sh",
      ["-c", "sh -c 'trap \"\" TERM; echo ready; while :; do sleep 0.1; done' & wait"],
      dir,
      { stdout: () => ready.resolve() },
    ),
  );
  await ready.promise;
  const pid = item.pid as number;
  jobs.stop(item.id);
  await jobs.shutdown();
  expect(item.status).toBe("failed");
  // A reaped or zombie child cannot run more work.
  const ps = Bun.spawnSync(["ps", "-eo", "pgid=,stat="]).stdout.toString();
  expect(
    ps.split("\n").filter((line) => {
      const [group, state] = line.trim().split(/\s+/);
      return Number(group) === pid && !state?.startsWith("Z");
    }),
  ).toEqual([]);
}, 7000);

test("timeouts and shutdown stop jobs, including detached jobs", async () => {
  const jobs = new Jobs();
  const item = start(jobs, "sleep 10", 0.02);
  const detached = jobs.create("job", "server", dir, true);
  void jobs.run(detached, () => jobs.process(detached, "/bin/sh", ["-c", "sleep 10"], dir));
  await item.completion;
  await jobs.shutdown();
  expect([item.status, detached.status]).toEqual(["failed", "failed"]);
}, 7000);
