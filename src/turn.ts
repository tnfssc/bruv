import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Jobs } from "./jobs";
import type { PlanUsage } from "./usage";

export type TurnSummary = {
  scripts: number;
  calls: number;
  agents: number;
  elapsedSeconds: number;
  weekPercent?: number;
};
const week = (usage?: PlanUsage) =>
  [usage?.rate_limits.primary, usage?.rate_limits.secondary].find((w) => w?.window_minutes === 10080);
export function registerTurn(pi: ExtensionAPI, jobs: Jobs, usage: (ctx: ExtensionContext) => PlanUsage | undefined) {
  let run:
    | { start: number; scripts: number; calls: number; agents: Set<string>; week: ReturnType<typeof week> }
    | undefined;
  pi.registerEntryRenderer<TurnSummary>("bruv-turn", (entry, _options, theme) => ({
    invalidate() {},
    render(width) {
      const data = entry.data as TurnSummary;
      const seconds = data.elapsedSeconds;
      const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
      const parts = (["scripts", "calls", "agents"] as const)
        .filter((key) => data[key] > 0)
        .map((key) => `${data[key]} ${key}`);
      if (seconds >= 1) parts.push(elapsed);
      if (data.weekPercent !== undefined && data.weekPercent > 0) parts.push(`+${data.weekPercent}% week`);
      return [truncateToWidth(theme.fg("dim", parts.join(" · ")), width)];
    },
  }));
  const reset = () => {
    run = undefined;
  };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);
  pi.on("agent_start", (_event, ctx) => {
    run ??= {
      start: Date.now(),
      scripts: 0,
      calls: 0,
      agents: new Set(jobs.items.keys()),
      week: structuredClone(week(usage(ctx))),
    };
  });
  pi.on("tool_execution_start", (event) => {
    if (!run) return;
    if (event.toolName === "codemode") run.scripts++;
    else run.calls++;
  });
  pi.on("agent_settled", (event, ctx) => {
    const finished = run;
    reset();
    if (!finished || event.aborted || finished.scripts + finished.calls === 0) return;
    const latest = week(usage(ctx));
    const delta =
      latest && finished.week && latest.reset_at === finished.week.reset_at
        ? Math.round(latest.used_percent - finished.week.used_percent)
        : 0;
    pi.appendEntry<TurnSummary>("bruv-turn", {
      scripts: finished.scripts,
      calls: finished.calls,
      agents: [...jobs.items.values()].filter((item) => item.kind === "agent" && !finished.agents.has(item.id)).length,
      elapsedSeconds: Math.floor((Date.now() - finished.start) / 1000),
      ...(delta > 0 ? { weekPercent: delta } : {}),
    });
  });
}
