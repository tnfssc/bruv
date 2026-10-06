import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readRun, writeArtifacts } from "./terminal-perf/artifacts.js";
import { parseOptions, help } from "./terminal-perf/options.js";
import { attachTerminalProfiler, type TerminalProfiler, type TerminalFrameSample } from "./terminal-perf/profiler.js";
import { createWorkloads, type WorkloadSample } from "./terminal-perf/workloads.js";
import { budgetFailures, textReport, type PerfRun, type FrameSample } from "./terminal-perf/report.js";

const root = resolve(import.meta.dir, "..");
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
async function environment(): Promise<PerfRun["environment"]> {
  const dependencies: Record<string, string> = {};
  for (const name of ["pi-tui", "pi-coding-agent"]) {
    const pkg = JSON.parse(await readFile(resolve(root, "node_modules/@earendil-works", name, "package.json"), "utf8"));
    dependencies[name] = pkg.version;
  }
  return {
    revision: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? "unknown",
    dependencies,
  };
}
function normalize(frame: TerminalFrameSample, index: number, action: string, step?: WorkloadSample): FrameSample {
  if (frame.failed) throw new Error(`Renderer threw while measuring ${action}`);
  return {
    index,
    action,
    durationMs: frame.durationMs,
    startedAtMs: frame.startedAtMs,
    phases: { ...frame.phasesMs, inlineLayoutDiffAndOther: frame.unattributedMs },
    bytes: frame.outputBytes,
    writes: frame.writeCount,
    changed: step?.screenChanged ?? frame.outputBytes > 0,
    screenHash: step?.screenHash,
    outputHash: step?.outputHash,
    requestDelayMs: frame.requestDelayMs ?? undefined,
    inputDelayMs: frame.inputDelayMs ?? undefined,
    work: step ? { ...step.work, changedRows: step.changedRows, mutations: step.mutations } : undefined,
  };
}
async function measure(options: ReturnType<typeof parseOptions>): Promise<PerfRun> {
  let profiler: TerminalProfiler | undefined;
  const workloads = createWorkloads({
    sizes: options.scales,
    columns: options.width,
    rows: options.height,
    onTuiReady: (tui, document) => {
      profiler = attachTerminalProfiler(tui, {
        capacity: 16,
        observe: [{ target: document, method: "render", name: "history.document.render" }],
      });
    },
  });
  const selected = workloads.filter(
    (entry) => !options.cases.length || options.cases.some((filter) => entry.name.includes(filter)),
  );
  if (!selected.length) throw new Error("No workloads match --case. Use --list to see IDs.");
  const run: PerfRun = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    budgetMs: options.budgetMs,
    environment: await environment(),
    config: {
      samples: options.samples,
      warmup: options.warmup,
      width: options.width,
      height: options.height,
      scales: options.scales,
    },
    cases: [],
  };
  for (const workload of selected) {
    process.stderr.write(`Measuring ${workload.name} …${String.fromCharCode(10)}`);
    try {
      const mount = workload.setup();
      if (!profiler) throw new Error("Workload did not expose its renderer");
      const coldSnapshot = profiler.snapshot();
      if (!coldSnapshot.frames.length || coldSnapshot.droppedFrames) throw new Error("Missing cold render samples");
      const cold = coldSnapshot.frames.map((frame, index) => normalize(frame, index, "mount", mount));
      for (let index = 0; index < options.warmup; index++) workload.step();
      const frames: FrameSample[] = [];
      for (let index = 0; index < options.samples; index++) {
        profiler.clear();
        const step = workload.step();
        const snapshot = profiler.snapshot();
        if (snapshot.frames.length !== 1 || snapshot.droppedFrames)
          throw new Error(`Expected exactly one complete synchronous render for ${workload.name}`);
        if (!step.screenChanged)
          throw new Error(`Workload did not change the rendered screen: ${workload.name} step ${step.iteration}`);
        frames.push(normalize(snapshot.frames[0], index, workload.mode, step));
      }
      run.cases.push({
        id: workload.name,
        description: workload.description,
        parameters: { mode: workload.mode, size: workload.size, fixtureVersion: 1, renderer: "fullscreen" },
        cold,
        frames,
      });
    } finally {
      try {
        workload.dispose();
      } finally {
        profiler?.dispose();
        profiler = undefined;
      }
    }
    // Drain canceled scheduler callbacks before installing the next process-global adapter.
    await Bun.sleep(0);
  }
  return run;
}
async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help);
    return;
  }
  if (options.list) {
    for (const entry of createWorkloads({ sizes: options.scales, columns: options.width, rows: options.height })) {
      console.log(`${entry.name} — ${entry.description}`);
    }
    return;
  }
  const baseline = options.baseline ? await readRun(options.baseline) : undefined;
  const run = options.report ? await readRun(options.report) : await measure(options);
  if (options.report && options.budgetExplicit) run.budgetMs = options.budgetMs;
  const directory = await writeArtifacts(run, options.out, baseline);
  process.stdout.write(textReport(run, baseline));
  console.log(`Artifacts: ${directory}`);
  console.log("Open index.html for the dashboard; trace.json works in Perfetto.");
  if (options.strict && budgetFailures(run).length) process.exitCode = 1;
}
await main().catch((error: unknown) => {
  console.error(`Terminal frame lab: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
