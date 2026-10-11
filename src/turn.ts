import type { AgentMessage } from "@earendil-works/pi-agent-core";
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
type Assistant = Extract<AgentMessage, { role: "assistant" }>;
function phase(block: Assistant["content"][number]) {
  if (block.type !== "text" || !block.textSignature) return undefined;
  try {
    return (JSON.parse(block.textSignature) as { phase?: string }).phase;
  } catch {
    return undefined;
  }
}

/**
 * GPT models sometimes write a "commentary" draft and then a "final_answer" that says the same
 * thing in one message. Keep the final answer so the reply shows once.
 */
export function dropDraft(message: Assistant): Assistant | undefined {
  const blocks = message.content;
  if (blocks.some((block) => block.type === "toolCall") || !blocks.some((block) => phase(block) === "final_answer"))
    return undefined;
  const content = blocks.filter((block) => phase(block) !== "commentary");
  return content.length === blocks.length ? undefined : { ...message, content };
}

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
        .map((key) => `${data[key]} ${data[key] === 1 ? key.slice(0, -1) : key}`);
      if (seconds >= 1) parts.push(elapsed);
      if (data.weekPercent !== undefined && data.weekPercent > 0) parts.push(`+${data.weekPercent}% week`);
      return [` ${truncateToWidth(theme.fg("dim", parts.join(" · ")), Math.max(0, width - 1))}`];
    },
  }));
  // Reasoning summaries become one title row plus a blank row per step in the terminal, and the
  // activity line already says what is happening. Skip them unless the user chose to see thinking.
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.mode !== "tui" || pi.getSettings().hideThinkingBlock === false) return;
    const reasoning = (event.payload as { reasoning?: { summary?: unknown } }).reasoning;
    if (reasoning && typeof reasoning === "object") delete reasoning.summary;
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const message = dropDraft(event.message);
    return message && { message };
  });
  let hasReceipt = false;
  const reset = () => {
    hasReceipt = false;
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
  pi.on("tool_execution_end", (event) => {
    if (event.toolName === "finish" && event.result.details?.receipt) hasReceipt = true;
  });
  const summary = (ctx: ExtensionContext): TurnSummary | undefined => {
    const finished = run;
    if (!finished) return;
    const latest = week(usage(ctx));
    const delta =
      latest && finished.week && latest.reset_at === finished.week.reset_at
        ? Math.round(latest.used_percent - finished.week.used_percent)
        : 0;
    return {
      scripts: finished.scripts,
      calls: finished.calls,
      agents: [...jobs.items.values()].filter(
        (item) => item.kind === "agent" && !item.checker && !finished.agents.has(item.id),
      ).length,
      elapsedSeconds: Math.floor((Date.now() - finished.start) / 1000),
      ...(delta > 0 ? { weekPercent: delta } : {}),
    };
  };
  pi.on("agent_settled", (event, ctx) => {
    const data = summary(ctx);
    if (data && !event.aborted && !hasReceipt && data.scripts + data.calls > 0)
      pi.appendEntry<TurnSummary>("bruv-turn", data);
    reset();
  });
  return summary;
}
