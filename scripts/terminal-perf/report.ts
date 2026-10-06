/** The portable result contract. Keep raw frames: a mean hides the stalls we care about. */
export interface FrameSample {
  index: number;
  action: string;
  durationMs: number;
  startedAtMs?: number;
  phases: Record<string, number>;
  bytes: number;
  writes: number;
  changed: boolean;
  screenHash?: string;
  outputHash?: string;
  requestDelayMs?: number;
  inputDelayMs?: number;
  work?: Record<string, number>;
}
export interface Distribution {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  overBudget: number;
}
export interface CaseResult {
  id: string;
  description: string;
  parameters: Record<string, string | number | boolean>;
  cold: FrameSample[];
  frames: FrameSample[];
}
export interface PerfRun {
  schemaVersion: 1;
  startedAt: string;
  budgetMs: number;
  environment: {
    revision: string;
    dirty: boolean;
    bun: string;
    platform: string;
    arch: string;
    cpu: string;
    dependencies: Record<string, string>;
  };
  config: { samples: number; warmup: number; width: number; height: number; scales: number[] };
  cases: CaseResult[];
}
export function distribution(values: number[], budgetMs: number): Distribution {
  if (!values.length) throw new Error("Cannot summarize zero samples");
  if (values.some((n) => !Number.isFinite(n) || n < 0)) throw new Error("Invalid timing sample");
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    overBudget: sorted.filter((n) => n >= budgetMs).length,
  };
}
export function summarizeCase(result: CaseResult, budgetMs: number) {
  const summarize = (frames: FrameSample[]) => ({
    timing: distribution(
      frames.map((frame) => frame.durationMs),
      budgetMs,
    ),
    changed: frames.filter((frame) => frame.changed).length,
    bytes: frames.reduce((n, frame) => n + frame.bytes, 0),
    writes: frames.reduce((n, frame) => n + frame.writes, 0),
    phases: Object.fromEntries(
      [...new Set(frames.flatMap((frame) => Object.keys(frame.phases)))].sort().map((name) => [
        name,
        distribution(
          frames.map((frame) => frame.phases[name] ?? 0),
          budgetMs,
        ),
      ]),
    ),
    worst: [...frames].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
  });
  return { cold: summarize(result.cold), steady: summarize(result.frames) };
}
export function budgetFailures(run: PerfRun): string[] {
  return run.cases.flatMap((result) => {
    const summary = summarizeCase(result, run.budgetMs);
    return (["cold", "steady"] as const)
      .filter((phase) => summary[phase].timing.overBudget > 0)
      .map((phase) => `${result.id} (${phase})`);
  });
}
export function compareRuns(current: PerfRun, baseline: PerfRun) {
  // Timings from a different CPU/runtime or a different workload are not a clean before/after.
  const warnings: string[] = [];
  for (const key of ["bun", "platform", "arch", "cpu", "dependencies"] as const) {
    if (JSON.stringify(current.environment[key]) !== JSON.stringify(baseline.environment[key]))
      warnings.push(`Different ${key}`);
  }
  if (JSON.stringify(current.config) !== JSON.stringify(baseline.config)) warnings.push("Different run config");
  if (current.budgetMs !== baseline.budgetMs) warnings.push("Different budget");
  const cases = current.cases.flatMap((result) => {
    const old = baseline.cases.find((entry) => entry.id === result.id);
    if (!old) {
      warnings.push(`No baseline for ${result.id}`);
      return [];
    }
    if (JSON.stringify(old.parameters) !== JSON.stringify(result.parameters)) {
      warnings.push(`Different parameters for ${result.id}`);
      return [];
    }
    const contentDifferences = result.frames.filter(
      (frame, index) =>
        frame.screenHash && old.frames[index]?.screenHash && frame.screenHash !== old.frames[index].screenHash,
    ).length;
    if (contentDifferences) warnings.push(`Screen content differs for ${result.id}: ${contentDifferences} frames`);
    const prefix = (run: PerfRun, id: string) =>
      run.cases
        .slice(
          0,
          run.cases.findIndex((entry) => entry.id === id),
        )
        .map((entry) => ({ id: entry.id, parameters: entry.parameters }));
    const sameColdContext =
      JSON.stringify(current.config) === JSON.stringify(baseline.config) &&
      JSON.stringify(prefix(current, result.id)) === JSON.stringify(prefix(baseline, result.id));
    if (!sameColdContext) warnings.push(`Different process-warming context for ${result.id}; cold delta suppressed`);
    const coldContentDifferences = result.cold.filter(
      (frame, index) =>
        frame.screenHash && old.cold[index]?.screenHash && frame.screenHash !== old.cold[index].screenHash,
    ).length;
    if (coldContentDifferences)
      warnings.push(`Cold screen content differs for ${result.id}: ${coldContentDifferences} frames`);
    if (result.cold.some((frame, index) => frame.screenHash && !old.cold[index]?.screenHash))
      warnings.push(`Baseline has no cold content evidence for ${result.id}`);
    const now = summarizeCase(result, current.budgetMs);
    const before = summarizeCase(old, current.budgetMs);
    return [
      {
        id: result.id,
        coldMaxDeltaMs: sameColdContext ? now.cold.timing.max - before.cold.timing.max : null,
        p95DeltaMs: now.steady.timing.p95 - before.steady.timing.p95,
        maxDeltaMs: now.steady.timing.max - before.steady.timing.max,
        missesDelta: now.steady.timing.overBudget - before.steady.timing.overBudget,
      },
    ];
  });
  for (const old of baseline.cases)
    if (!current.cases.some((entry) => entry.id === old.id)) warnings.push(`Not run: ${old.id}`);
  return { warnings, cases };
}
const ms = (n: number) => n.toFixed(3);
export function textReport(run: PerfRun, baseline?: PerfRun): string {
  const lines = [
    `Terminal main-thread render budget: < ${run.budgetMs} ms`,
    "Case | cold max | p50 | p95 | p99 | max | misses cold/steady | changed",
    ...run.cases.map((result) => {
      const { cold, steady } = summarizeCase(result, run.budgetMs);
      const s = steady.timing;
      return [
        result.id,
        ms(cold.timing.max),
        ms(s.p50),
        ms(s.p95),
        ms(s.p99),
        ms(s.max),
        `${cold.timing.overBudget}/${s.overBudget}`,
        `${steady.changed}/${s.count}`,
      ].join(" | ");
    }),
  ];
  const failures = budgetFailures(run);
  lines.push(failures.length ? `OVER BUDGET: ${failures.join(", ")}` : "All sampled frames under budget.");
  lines.push("CPU/layout/diff/write-call time only. Not terminal paint or a guarantee about unsampled frames.");
  if (baseline) {
    const comparison = compareRuns(run, baseline);
    lines.push("", "Baseline deltas (ms; positive is slower):");
    lines.push(...comparison.warnings.map((warning) => `WARNING: ${warning}`));
    lines.push(
      ...comparison.cases.map(
        (entry) =>
          entry.id +
          ": p95 " +
          ms(entry.p95DeltaMs) +
          ", max " +
          ms(entry.maxDeltaMs) +
          ", cold max " +
          (entry.coldMaxDeltaMs === null ? "n/a" : ms(entry.coldMaxDeltaMs)),
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}
