import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface Budgets {
  rssBytes: number;
  diskBytes: number;
  journalEntries: number;
  timeoutMs: number;
}
export interface WorkloadMetric {
  type: "sample" | "complete";
  phase: string;
  step: number;
  rssBytes: number;
  heapUsedBytes: number;
  journalBytes: number;
  journalEntries: number;
  elapsedMs: number;
}
export interface ResourceRun {
  phase: string;
  passed: boolean;
  violations: string[];
  exitCode: number | null;
  signal: string | null;
  elapsedMs: number;
  peakRssBytes: number;
  peakHeapUsedBytes: number;
  diskBytes: number;
  journalEntries: number;
  completed: boolean;
  stderr: string;
  metrics: WorkloadMetric[];
  samples: { elapsedMs: number; rssBytes: number | null; diskBytes: number }[];
}

// Only scan the fixture made for this run. Never follow links into user data.
async function fixtureBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await fixtureBytes(path);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

async function residentBytes(pid: number): Promise<number | null> {
  if (process.platform !== "linux") return null;
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^VmRSS:\s+(\d+) kB$/m);
    return match ? Number(match[1]) * 1024 : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function metric(value: unknown): value is WorkloadMetric {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    (row.type === "sample" || row.type === "complete") &&
    typeof row.phase === "string" &&
    ["step", "rssBytes", "heapUsedBytes", "journalBytes", "journalEntries", "elapsedMs"].every(
      (key) => typeof row[key] === "number" && Number.isFinite(row[key]) && (row[key] as number) >= 0,
    )
  );
}

/** Run one model-free workload in a disposable child. A stuck resume cannot hide behind missing metrics. */
export async function supervise(options: {
  command: string[];
  dir: string;
  phase: string;
  budgets: Budgets;
}): Promise<ResourceRun> {
  const started = performance.now();
  const child = spawn(options.command[0], options.command.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  const result: ResourceRun = {
    phase: options.phase,
    passed: false,
    violations: [],
    exitCode: null,
    signal: null,
    elapsedMs: 0,
    peakRssBytes: 0,
    peakHeapUsedBytes: 0,
    diskBytes: 0,
    journalEntries: 0,
    completed: false,
    stderr: "",
    metrics: [],
    samples: [],
  };
  const fail = (reason: string) => {
    if (!result.violations.includes(reason)) result.violations.push(reason);
    // The workload is a single process with no agents or subprocesses. Kill only that child.
    child.kill("SIGKILL");
  };
  const check = () => {
    if (result.peakRssBytes > options.budgets.rssBytes) fail("RSS budget exceeded");
    if (result.diskBytes > options.budgets.diskBytes) fail("Fixture disk budget exceeded");
    if (result.journalEntries > options.budgets.journalEntries) fail("Journal entry budget exceeded");
  };
  let pending = "";
  let stdoutBytes = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > 2 * 1024 * 1024) {
      fail("Metric output budget exceeded");
      return;
    }
    pending += chunk.toString();
    while (pending.includes("\n")) {
      const newline = pending.indexOf("\n");
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        fail("Invalid metric JSON");
        return;
      }
      if (!metric(row) || row.phase !== options.phase) {
        fail("Invalid metric row");
        return;
      }
      if (result.metrics.length >= 2000) {
        fail("Metric row budget exceeded");
        return;
      }
      result.metrics.push(row);
      result.completed ||= row.type === "complete";
      result.peakRssBytes = Math.max(result.peakRssBytes, row.rssBytes);
      result.peakHeapUsedBytes = Math.max(result.peakHeapUsedBytes, row.heapUsedBytes);
      result.diskBytes = Math.max(result.diskBytes, row.journalBytes);
      result.journalEntries = Math.max(result.journalEntries, row.journalEntries);
      check();
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    result.stderr = (result.stderr + chunk.toString()).slice(-8192);
  });
  const timeout = setTimeout(() => fail("Wall time budget exceeded"), options.budgets.timeoutMs);
  let sampling = false;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const rssBytes = child.pid ? await residentBytes(child.pid) : null;
      const diskBytes = await fixtureBytes(options.dir);
      result.peakRssBytes = Math.max(result.peakRssBytes, rssBytes ?? 0);
      result.diskBytes = Math.max(result.diskBytes, diskBytes);
      if (result.samples.length < 2000)
        result.samples.push({ elapsedMs: performance.now() - started, rssBytes, diskBytes });
      check();
    } catch (error) {
      fail(`Resource sampling failed: ${String(error)}`);
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(() => void sample(), 100);
  await new Promise<void>((resolve) => {
    child.on("error", (error) => {
      result.violations.push(`Spawn failed: ${error.message}`);
    });
    child.on("close", (code, signal) => {
      result.exitCode = code;
      result.signal = signal;
      resolve();
    });
  });
  clearTimeout(timeout);
  clearInterval(timer);
  // Finish an in-flight sample before publishing the report.
  while (sampling) await new Promise((resolve) => setTimeout(resolve, 5));
  await sample();
  result.elapsedMs = performance.now() - started;
  if (pending.trim()) result.violations.push("Unterminated metric row");
  if (result.exitCode !== 0) result.violations.push("Workload exited unsuccessfully");
  if (!result.completed) result.violations.push("Workload did not complete");
  result.passed = result.violations.length === 0;
  return result;
}
