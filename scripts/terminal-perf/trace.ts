import type { PerfRun } from "./report.js";
/** Import in Perfetto or Chrome's trace viewer. Phase totals are args, not fake ordered spans. */
export function chromeTrace(run: PerfRun) {
  let cursor = 0;
  const traceEvents: Record<string, unknown>[] = [
    { name: "process_name", ph: "M", pid: 1, tid: 1, args: { name: "Bruv terminal frame lab" } },
  ];
  for (const result of run.cases)
    for (const [state, frames] of [
      ["cold", result.cold],
      ["steady", result.frames],
    ] as const) {
      for (const frame of frames) {
        const start = frame.startedAtMs ?? cursor;
        cursor = start + frame.durationMs;
        traceEvents.push({
          name: `${result.id} / ${frame.action}`,
          cat: `terminal.${state}`,
          ph: "X",
          pid: 1,
          tid: 1,
          ts: start * 1000,
          dur: frame.durationMs * 1000,
          args: {
            index: frame.index,
            budgetMs: run.budgetMs,
            overBudget: frame.durationMs >= run.budgetMs,
            phases: frame.phases,
            bytes: frame.bytes,
            writes: frame.writes,
            changed: frame.changed,
            requestDelayMs: frame.requestDelayMs,
            inputDelayMs: frame.inputDelayMs,
            work: frame.work,
          },
        });
      }
    }
  return { displayTimeUnit: "ms", traceEvents, metadata: { environment: run.environment, config: run.config } };
}
