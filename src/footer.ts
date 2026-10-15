import { basename } from "node:path";
import type { Model, Usage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readConfig } from "./config";
import { agentTotals, type Jobs } from "./jobs";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function columns(left: string, right: string, width: number) {
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap >= 2) return left + " ".repeat(gap) + right;
  return truncateToWidth(left, width, "…");
}

/** Session cost, summed once per new entry instead of on every frame. */
function costTracker(ctx: ExtensionContext) {
  let counted = 0;
  let total = 0;
  return () => {
    const entries = ctx.sessionManager.getEntries();
    if (entries.length < counted) counted = total = 0;
    for (; counted < entries.length; counted++) {
      const entry = entries[counted];
      if (entry.type === "message" && entry.message.role === "assistant") total += entry.message.usage.cost.total;
    }
    return total;
  };
}

/** Time left on the provider's prompt cache, counted from the last answer from this model, and how much of that answer's prompt was read from it. */
export function cacheBadge(last: number | undefined, ttlMinutes: number, now: number, theme: Theme, hit?: number) {
  if (last === undefined) return "";
  const left = last + ttlMinutes * 60_000 - now;
  if (left <= 0) return theme.fg("error", "cache expired");
  const minutes = Math.ceil(left / 60_000);
  const read = hit === undefined ? "" : `${Math.round(hit * 100)}% · `;
  return theme.fg(minutes <= 5 ? "error" : minutes <= 15 ? "warning" : "dim", `cache ${read}${minutes}m`);
}

/** Minutes the provider keeps this model's prompt cache: the user's setting, then the model's own, then a guess. */
export function cacheTtl(model: Model<string>, configured: number | undefined) {
  if (configured) return configured;
  if (model.promptCache?.short) return model.promptCache.short / 60;
  // Codex keeps Luna's cache for about five minutes and the larger models' for about an hour.
  return /luna/i.test(model.id) ? 5 : 60;
}

export function compactFooter(
  ctx: ExtensionContext,
  data: ReadonlyFooterDataProvider,
  theme: Theme,
  width: number,
  cost: number,
  cache = "",
): string[] {
  if (width < 1) return [];
  const project = basename(ctx.sessionManager.getCwd()) || "/";
  const branch = data.getGitBranch();
  const statuses = data.getExtensionStatuses();
  const bruv = oneLine(statuses.get("bruv") ?? "");
  const others = [...statuses.keys()].filter((key) => key !== "bruv").length;
  const model = ctx.model;
  const subscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
  const percent = ctx.getContextUsage()?.percent;
  const context = (label: string) =>
    theme.fg(
      percent != null && percent > 90 ? "error" : percent != null && percent > 70 ? "warning" : "dim",
      `${label}${percent == null ? "?" : `${Math.round(percent)}%`}`,
    );
  // What the work would cost at API prices, agents included. On a subscription it is only that: a price.
  const price = cost >= 0.005 ? `$${cost.toFixed(2)}${subscription ? " api" : ""}` : "";
  const extra = others ? `+${others} status` : "";
  const name = oneLine(model?.id ?? "no model");
  const thinking = model?.reasoning ? ` · ${ctx.thinkingLevel ?? "off"}` : "";
  const accent = (text: string) => (text ? theme.fg("accent", text) : "");
  const tries: [string[], string][] = [
    [
      [branch ? `${project}:${oneLine(branch)}` : project, accent(bruv), price, context("ctx "), cache, extra],
      name + thinking,
    ],
    [[project, accent(bruv), price, context("ctx "), cache, extra], name + thinking],
    [[accent(bruv), price, context("ctx "), cache], name],
    [[context("ctx ")], name],
  ];
  for (const [parts, right] of tries) {
    const left = parts.filter(Boolean).join(theme.fg("dim", " · "));
    if (visibleWidth(left) + 2 + visibleWidth(right) <= width)
      return [columns(theme.fg("dim", left), theme.fg("dim", right), width)];
  }
  return [truncateToWidth(theme.fg("dim", name), width, "…")];
}

/** One-line footer with the cache countdown. */
export function registerFooter(pi: ExtensionAPI, jobs?: Jobs) {
  // When each provider/model last answered; the cache countdown starts there.
  const answered = new Map<string, { at: number; hit?: number }>();
  const hit = (usage: Usage) => {
    const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
    return prompt ? usage.cacheRead / prompt : undefined;
  };
  const key = (model: { provider: string; id?: string; model?: string }) =>
    `${model.provider}/${model.id ?? model.model}`;
  pi.on("session_start", (_event, ctx) => {
    answered.clear();
    for (const entry of ctx.sessionManager.getBranch())
      if (entry.type === "message" && entry.message.role === "assistant" && entry.message.stopReason !== "error")
        answered.set(key(entry.message), { at: entry.message.timestamp, hit: hit(entry.message.usage) });
    if (ctx.mode !== "tui") return;
    const cost = costTracker(ctx);
    const configured = readConfig().cacheTtlMinutes;
    ctx.ui.setFooter((tui, theme, data) => {
      const stop = data.onBranchChange(() => tui.requestRender());
      // The countdown moves by the minute; nothing else redraws an idle screen.
      const timer = setInterval(() => tui.requestRender(), 30_000);
      timer.unref();
      return {
        render: (width) => {
          const model = ctx.model;
          const last = model && answered.get(key(model));
          const cache =
            model && last ? cacheBadge(last.at, cacheTtl(model, configured), Date.now(), theme, last.hit) : "";
          return compactFooter(ctx, data, theme, width, cost() + (jobs ? agentTotals(jobs).cost : 0), cache);
        },
        invalidate() {},
        dispose() {
          stop();
          clearInterval(timer);
        },
      };
    });
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant" && event.message.stopReason !== "error")
      answered.set(key(event.message), { at: Date.now(), hit: hit(event.message.usage) });
  });
  // Codex ignores the output cap on Pi's cache warming requests, so a warm-up would be a full, paid reply.
  pi.on("cache_warming_decision", (_event, ctx) =>
    ctx.model?.api === "openai-codex-responses" ? { action: "stop" } : undefined,
  );
}
