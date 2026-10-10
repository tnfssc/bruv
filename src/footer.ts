import { basename } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

export function compactFooter(
  ctx: ExtensionContext,
  data: ReadonlyFooterDataProvider,
  theme: Theme,
  width: number,
  cost: number,
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
  const price = cost && !subscription ? `$${cost.toFixed(2)}` : "";
  const extra = others ? `+${others} status` : "";
  const name = oneLine(model?.id ?? "no model");
  const thinking = model?.reasoning ? ` · ${ctx.thinkingLevel ?? "off"}` : "";
  const accent = (text: string) => (text ? theme.fg("accent", text) : "");
  const tries: [string[], string][] = [
    [
      [branch ? `${project}:${oneLine(branch)}` : project, accent(bruv), price, context("ctx "), extra],
      name + thinking,
    ],
    [[project, accent(bruv), price, context("ctx "), extra], name + thinking],
    [[accent(bruv), price, context("ctx ")], name],
    [[context("ctx ")], name],
  ];
  for (const [parts, right] of tries) {
    const left = parts.filter(Boolean).join(theme.fg("dim", " · "));
    if (visibleWidth(left) + 2 + visibleWidth(right) <= width)
      return [columns(theme.fg("dim", left), theme.fg("dim", right), width)];
  }
  return [truncateToWidth(theme.fg("dim", name), width, "…")];
}

/** One-line footer and no startup banner. /status switches to Pi's full footer. */
export function registerFooter(pi: ExtensionAPI) {
  let detailed = false;
  const install = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    if (detailed) return ctx.ui.setFooter(undefined);
    const cost = costTracker(ctx);
    ctx.ui.setFooter((tui, theme, data) => {
      const stop = data.onBranchChange(() => tui.requestRender());
      return {
        render: (width) => compactFooter(ctx, data, theme, width, cost()),
        invalidate() {},
        dispose: stop,
      };
    });
  };
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
    install(ctx);
  });
  pi.registerCommand("status", {
    description: "Switch between the short footer and Pi's full footer",
    handler: async (_args, ctx) => {
      detailed = !detailed;
      install(ctx);
    },
  });
}
