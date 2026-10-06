import { describe, expect, test } from "bun:test";
import {
  budgetFailures,
  compareRuns,
  distribution,
  summarizeCase,
  textReport,
  type PerfRun,
} from "../scripts/terminal-perf/report.js";
import { dashboard } from "../scripts/terminal-perf/dashboard.js";

function fixture(): PerfRun {
  const frame = (durationMs: number, index = 0) => ({
    index,
    action: "type",
    durationMs,
    phases: { layout: durationMs / 2 },
    bytes: 10,
    writes: 1,
    changed: true,
  });
  return {
    schemaVersion: 1,
    startedAt: "2026-10-05T00:00:00Z",
    budgetMs: 8,
    environment: {
      revision: "abc",
      dirty: false,
      bun: "1.4.2",
      platform: "linux",
      arch: "x64",
      cpu: "test",
      dependencies: {},
    },
    config: { samples: 3, warmup: 1, width: 120, height: 40, scales: [100] },
    cases: [
      {
        id: "input-100",
        description: "Typing",
        parameters: { scale: 100 },
        cold: [frame(9)],
        frames: [frame(1), frame(2, 1), frame(8, 2)],
      },
    ],
  };
}
describe("terminal performance reports", () => {
  test("retains spikes, strict under-budget boundary and nearest-rank percentiles", () => {
    const stats = distribution([1, 2, 3, 4, 20], 8);
    expect(stats).toMatchObject({ p50: 3, p95: 20, p99: 20, max: 20, count: 5, overBudget: 1 });
    expect(distribution([8], 8).overBudget).toBe(1);
    expect(() => distribution([], 8)).toThrow();
    expect(() => distribution([NaN], 8)).toThrow();
  });
  test("cold frames cannot hide behind warmup or steady-state percentiles", () => {
    const run = fixture();
    expect(budgetFailures(run)).toEqual(["input-100 (cold)", "input-100 (steady)"]);
    const result = summarizeCase(run.cases[0]!, 8);
    expect(result.cold.timing.max).toBe(9);
    expect(result.steady.timing.p50).toBe(2);
    expect(result.steady.changed).toBe(3);
    expect(result.steady.phases.layout!.max).toBe(4);
    expect(textReport(run)).toContain("OVER BUDGET");
  });
  test("matches workloads and warns on unlike machines or missing cases", () => {
    const run = fixture(),
      baseline = fixture();
    baseline.cases[0]!.frames[2]!.durationMs = 6;
    expect(compareRuns(run, baseline).cases[0]).toMatchObject({ maxDeltaMs: 2, p95DeltaMs: 2, missesDelta: 1 });
    baseline.environment.cpu = "other";
    baseline.cases[0]!.parameters.scale = 500;
    expect(compareRuns(run, baseline)).toMatchObject({
      warnings: ["Different cpu", "Different parameters for input-100"],
      cases: [],
    });
  });
  test("dashboard is offline and embedded run strings cannot break out of its script", () => {
    const run = fixture();
    run.cases[0]!.description = "</script><script>alert(1)</script>";
    const html = dashboard(run);
    expect(html).toContain("Every frame counts.");
    expect(html).not.toContain(run.cases[0]!.description);
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain('src="http');
    run.cases[0]!.description = "literal $& replacement";
    expect(dashboard(run)).toContain("literal $& replacement");
  });
});

test("cold deltas require the same preceding-case warming context", () => {
  const current = fixture(),
    baseline = fixture();
  baseline.cases.unshift({ ...baseline.cases[0]!, id: "earlier-case" });
  const compared = compareRuns(current, baseline);
  expect(compared.cases[0]!.coldMaxDeltaMs).toBeNull();
  expect(compared.warnings).toContain("Different process-warming context for input-100; cold delta suppressed");
  expect(textReport(current, baseline)).toContain("cold max n/a");
});
test("cold content differences and missing mount fingerprints remain visible", () => {
  const current = fixture(),
    baseline = fixture();
  current.cases[0]!.cold[0]!.screenHash = "new";
  expect(compareRuns(current, baseline).warnings).toContain("Baseline has no cold content evidence for input-100");
  baseline.cases[0]!.cold[0]!.screenHash = "old";
  expect(compareRuns(current, baseline).warnings).toContain("Cold screen content differs for input-100: 1 frames");
});
