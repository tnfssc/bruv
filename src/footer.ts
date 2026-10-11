import { basename } from "node:path";
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

/** Time left on the provider's prompt cache, counted from the last answer from this model. */
export function cacheBadge(last: number | undefined, ttlMinutes: number, now: number, theme: Theme) {
  if (last === undefined) return "";
  const left = last + ttlMinutes * 60_000 - now;
  if (left <= 0) return theme.fg("error", "cache expired");
  const minutes = Math.ceil(left / 60_000);
  return theme.fg(minutes <= 5 ? "error" : minutes <= 15 ? "warning" : "dim", `cache ${minutes}m`);
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

/** One-line footer with the cache countdown, and no startup banner. */
export function registerFooter(pi: ExtensionAPI, jobs?: Jobs) {
  // When each provider/model last answered; the cache countdown starts there.
  const answered = new Map<string, number>();
  const key = (model: { provider: string; id?: string; model?: string }) =>
    `${model.provider}/${model.id ?? model.model}`;
  pi.on("session_start", (_event, ctx) => {
    answered.clear();
    for (const entry of ctx.sessionManager.getBranch())
      if (entry.type === "message" && entry.message.role === "assistant" && entry.message.stopReason !== "error")
        answered.set(key(entry.message), entry.message.timestamp);
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
    const cost = costTracker(ctx);
    const ttl = readConfig().cacheTtlMinutes ?? 60;
    ctx.ui.setFooter((tui, theme, data) => {
      const stop = data.onBranchChange(() => tui.requestRender());
      // The countdown moves by the minute; nothing else redraws an idle screen.
      const timer = setInterval(() => tui.requestRender(), 30_000);
      timer.unref();
      return {
        render: (width) => {
          const model = ctx.model;
          const cache = model ? cacheBadge(answered.get(key(model)), ttl, Date.now(), theme) : "";
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
      answered.set(key(event.message), Date.now());
  });
}
