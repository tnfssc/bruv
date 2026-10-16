import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { codexAccountId } from "./codex-compaction";
import { readJson } from "./config";
import { agentTotals, type Jobs } from "./jobs";
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
  const credits = data.credits.unlimited
    ? "unlimited credits"
    : data.credits.balance === null
      ? ""
      : `${Math.round(Number(data.credits.balance)).toLocaleString()} credits`;
  return [
    [`Plan: ${data.plan_type}`, credits].filter(Boolean).join(" · "),
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
      const label = name(w);
      return `${label[0].toUpperCase()}${label.slice(1)}: ${Math.round(w.used_percent)}% [${"#".repeat(filled)}${"-".repeat(10 - filled)}] resets ${reset} (in ${relative})`;
    }),
    // Only worth a line when it is true.
    ...(data.rate_limits.limit_reached || usingCredits(data)
      ? [
          [data.rate_limits.limit_reached && "Limit reached", usingCredits(data) && "using credits"]
            .filter(Boolean)
            .join(" · "),
        ]
      : []),
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
/** Banked plan resets, which only the usage endpoint reports. Undefined when it can't be read. */
async function resetCredits(ctx: ExtensionContext, fetch: typeof globalThis.fetch): Promise<number | undefined> {
  const model = ctx.model;
  if (model?.api !== "openai-codex-responses") return;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  const accountId = auth.ok && auth.apiKey ? codexAccountId(auth.apiKey) : undefined;
  if (!auth.ok || !accountId) return;
  const base = (auth.baseUrl || model.baseUrl || "https://chatgpt.com/backend-api")
    .replace(/\/+$/, "")
    .replace(/\/codex(?:\/responses)?$/, "");
  try {
    const response = await fetch(`${base}/wham/usage`, {
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        "chatgpt-account-id": accountId,
        accept: "application/json",
        originator: "pi",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const count = (await response.json())?.rate_limit_reset_credits?.available_count;
    return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
  } catch {
    return undefined;
  }
}

export function registerUsage(
  pi: ExtensionAPI,
  agentDir = getAgentDir(),
  jobs?: Jobs,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
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
      const lines: string[] =
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
      const credits = data ? await resetCredits(ctx, fetch) : undefined;
      if (credits) lines.push(`Plan resets banked: ${credits}`);
      const agents = jobs ? agentTotals(jobs) : { tokens: 0, cost: 0 };
      const total = `This session: ${(tokens + agents.tokens).toLocaleString()} tokens · $${(cost + agents.cost).toFixed(2)} at API prices`;
      const split = agents.tokens
        ? ` (agents ${agents.tokens.toLocaleString()} tokens · $${agents.cost.toFixed(2)})`
        : "";
      ctx.ui.notify([...lines, total + split].join("\n"), "info");
    },
  });
  return (ctx: ExtensionContext) => state(ctx).data;
}
