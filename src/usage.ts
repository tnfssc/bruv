import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readJson } from "./config";
import { setStatus } from "./status";

type Window = { used_percent: number; window_minutes: number; reset_at: number };
export type PlanUsage = {
  plan_type: string;
  rate_limits: { limit_reached: boolean; primary: Window | null; secondary: Window | null };
  credits: { has_credits: boolean; unlimited: boolean; balance: string | null };
};
const windows = (data: PlanUsage) => [data.rate_limits.primary, data.rate_limits.secondary].filter((w) => w !== null);
const name = (w: Window) => {
  const minutes = w.window_minutes;
  return minutes === 10080 ? "week" : minutes < 1440 ? `${minutes / 60}h` : `${minutes / 1440}d`;
};
const usingCredits = (data: PlanUsage) =>
  data.rate_limits.limit_reached && (data.credits.has_credits || data.credits.unlimited);
export function usageFooter(data: PlanUsage) {
  const text = windows(data)
    .map((w) => `${name(w)} ${w.used_percent >= 100 ? "limit reached" : `${Math.round(w.used_percent)}%`}`)
    .join(" · ");
  return `${text}${usingCredits(data) ? " · using credits" : ""}`;
}
export function usageLines(data: PlanUsage, now = Date.now()) {
  return [
    `Plan: ${data.plan_type}`,
    ...windows(data).map((w) => {
      const filled = Math.min(10, Math.max(0, Math.round(w.used_percent / 10)));
      const minutes = Math.max(0, Math.ceil((w.reset_at * 1000 - now) / 60000));
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const relative = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
      const reset = new Date(w.reset_at * 1000).toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return `${name(w)}: ${Math.round(w.used_percent)}% [${"#".repeat(filled)}${"-".repeat(10 - filled)}] · resets ${reset}, in ${relative}`;
    }),
    `Limits reached: ${data.rate_limits.limit_reached ? "yes" : "no"} · Using credits: ${usingCredits(data) ? "yes" : "no"}`,
    `Credits: ${data.credits.unlimited ? "unlimited" : data.credits.balance === null ? "unavailable" : Math.round(Number(data.credits.balance)).toLocaleString()}`,
  ];
}
function fromHeaders(headers: Record<string, string>): PlanUsage | undefined {
  const plan = headers["x-codex-plan-type"];
  if (!plan) return;
  const window = (key: string): Window | null => {
    const prefix = `x-codex-${key}-`;
    const minutes = Number(headers[`${prefix}window-minutes`]);
    return minutes > 0
      ? {
          window_minutes: minutes,
          used_percent: Number(headers[`${prefix}used-percent`]),
          reset_at: Number(headers[`${prefix}reset-at`]),
        }
      : null;
  };
  const primary = window("primary");
  const secondary = window("secondary");
  return {
    plan_type: plan,
    rate_limits: { primary, secondary, limit_reached: [primary, secondary].some((w) => w && w.used_percent >= 100) },
    credits: {
      has_credits: headers["x-codex-credits-has-credits"]?.toLowerCase() === "true",
      unlimited: headers["x-codex-credits-unlimited"]?.toLowerCase() === "true",
      balance: headers["x-codex-credits-balance"] || null,
    },
  };
}
export function registerUsage(pi: ExtensionAPI, agentDir = getAgentDir()) {
  const path = join(agentDir, "bruv-usage.json");
  const sessions = new Map<string, { data?: PlanUsage; warned: Set<string> }>();
  const state = (ctx: ExtensionContext) => {
    const id = ctx.sessionManager.getSessionId();
    let current = sessions.get(id);
    if (!current) {
      current = { data: readJson<PlanUsage | undefined>(path, undefined), warned: new Set() };
      sessions.set(id, current);
    }
    return current;
  };
  const show = (ctx: ExtensionContext) => {
    const data = state(ctx).data;
    setStatus(ctx, "usage", ctx.model?.api === "openai-codex-responses" && data ? usageFooter(data) : undefined);
  };
  const accept = (data: PlanUsage, ctx: ExtensionContext) => {
    const current = state(ctx);
    current.data = data;
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(data)}\n`);
    show(ctx);
    for (const w of windows(data)) {
      const key = `${w.window_minutes}:90`;
      if (w.used_percent >= 90 && !current.warned.has(key)) {
        current.warned.add(key);
        ctx.ui.notify(`${name(w)} ChatGPT plan use: ${Math.round(w.used_percent)}%.`, "warning");
      }
    }
    if (data.rate_limits.limit_reached && !current.warned.has("limit")) {
      current.warned.add("limit");
      ctx.ui.notify(`ChatGPT plan limit reached.${usingCredits(data) ? " Using credits." : ""}`, "warning");
    }
  };
  pi.on("session_start", (_event, ctx) => show(ctx));
  pi.on("model_select", (_event, ctx) => show(ctx));
  pi.on("provider_stream_event", (event, ctx) => {
    if (event.api !== "openai-codex-responses") return;
    const data = event.data as (PlanUsage & { type?: string }) | null;
    if (data?.type === "codex.rate_limits") accept(data, ctx);
  });
  pi.on("after_provider_response", (event, ctx) => {
    if (ctx.model?.api !== "openai-codex-responses") return;
    const data = fromHeaders(event.headers);
    if (data) accept(data, ctx);
  });
  pi.registerCommand("usage", {
    description: "Show ChatGPT plan limits and session usage.",
    async handler(_args, ctx) {
      const data = state(ctx).data;
      const lines =
        ctx.model?.api !== "openai-codex-responses"
          ? ["Limits are only reported for ChatGPT plan models."]
          : data
            ? usageLines(data)
            : ["No ChatGPT plan data yet. It appears after the first request to a ChatGPT model."];
      let tokens = 0;
      let cost = 0;
      for (const entry of ctx.sessionManager.getBranch()) {
        const usage =
          entry.type === "message" && entry.message.role === "assistant"
            ? entry.message.usage
            : entry.type === "compaction"
              ? entry.usage
              : undefined;
        tokens += usage?.totalTokens ?? 0;
        cost += usage?.cost.total ?? 0;
      }
      ctx.ui.notify([...lines, `Session: ${tokens.toLocaleString()} tokens · $${cost.toFixed(2)}`].join("\n"), "info");
    },
  });
  return (ctx: ExtensionContext) => state(ctx).data;
}
