import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Budgets, supervise } from "../scripts/resource-harness/supervisor";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const budgets: Budgets = { rssBytes: 512 * 1024 * 1024, diskBytes: 1024 * 1024, journalEntries: 100, timeoutMs: 3000 };
const complete =
  'console.log(JSON.stringify({type:"complete",phase:"write",step:1,rssBytes:1,heapUsedBytes:1,journalBytes:0,journalEntries:1,elapsedMs:1}));';
async function run(source: string, limits: Partial<Budgets> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resource-supervisor-"));
  dirs.push(dir);
  const script = join(dir, "workload.ts");
  await writeFile(script, source);
  return supervise({
    command: [process.execPath, script, dir],
    phase: "write",
    dir,
    budgets: { ...budgets, ...limits },
  });
}

describe("resource workload supervisor", () => {
  test("records a completed workload and externally measures fixture bytes", async () => {
    const result = await run(complete);
    expect(result.passed).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.diskBytes).toBeGreaterThan(0);
    expect(result.metrics).toHaveLength(1);
    expect(result.samples.length).toBeGreaterThan(0);
  });
  test("kills disk growth even when the child emits no metrics", async () => {
    const result = await run(
      'await Bun.write(process.argv[2]+"/growth",Buffer.alloc(8192));setInterval(()=>{},1000);',
      { diskBytes: 4096 },
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("Fixture disk budget exceeded");
    expect(result.signal).toBe("SIGKILL");
  });
  test("kills a stuck resume without waiting for a metric", async () => {
    const result = await run("setInterval(()=>{},1000);", { timeoutMs: 250 });
    expect(result.violations).toContain("Wall time budget exceeded");
    expect(result.completed).toBe(false);
    expect(result.elapsedMs).toBeLessThan(2500);
  });
  test("checks journal count and child-reported peak RSS", async () => {
    const result = await run(
      complete.replace("rssBytes:1", "rssBytes:999999999").replace("journalEntries:1", "journalEntries:101"),
    );
    expect(result.violations).toContain("RSS budget exceeded");
    expect(result.violations).toContain("Journal entry budget exceeded");
  });
  test("samples Linux RSS independently of workload instrumentation", async () => {
    if (process.platform !== "linux") return;
    const result = await run("setInterval(()=>{},1000);", { rssBytes: 1 });
    expect(result.violations).toContain("RSS budget exceeded");
    expect(result.peakRssBytes).toBeGreaterThan(1);
    expect(result.signal).toBe("SIGKILL");
  });
  test("does not accept a crash or partial stdout as success", async () => {
    const result = await run('process.stdout.write("{broken");process.exit(2);');
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.violations).toContain("Unterminated metric row");
    expect(result.violations).toContain("Workload did not complete");
  });
  test("reports spawn failure without hanging", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-resource-spawn-"));
    dirs.push(dir);
    const result = await supervise({ command: [join(dir, "missing")], phase: "write", dir, budgets });
    expect(result.passed).toBe(false);
    expect(result.violations.some((reason) => reason.startsWith("Spawn failed:"))).toBe(true);
  });
  test("rejects malformed metric rows", async () => {
    const result = await run('console.log(JSON.stringify({type:"complete",phase:"write"}));setInterval(()=>{},1000);');
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("Invalid metric row");
  });
  test("bounds child output and retains only a stderr tail", async () => {
    const result = await run(
      'process.stderr.write("x".repeat(20000));process.stdout.write("x".repeat(3*1024*1024));setInterval(()=>{},1000);',
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("Metric output budget exceeded");
    expect(result.stderr.length).toBeLessThanOrEqual(8192);
  });
});
