import { calculateCost, type Model, type Usage } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig, saveConfig } from "./config";
import { setStatus } from "./status";

/** Usage priced at the priority tier, using Pi's own multipliers. */
export function priorityUsage(model: Model<string>, usage: Usage): Usage {
  const scale = model.id === "gpt-5.5" ? 2.5 : 2;
  const cost = { ...usage.cost };
  for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) cost[key] *= scale;
  cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
  return { ...usage, cost };
}

export function registerFast(pi: ExtensionAPI, agentDir = getAgentDir()) {
  let preferred = false;
  let on = false;
  let confirmed = false;
  const supported = (ctx: ExtensionContext) =>
    ctx.model?.api === "openai-responses" || ctx.model?.api === "openai-codex-responses";
  const show = (ctx: ExtensionContext) => {
    on = preferred && supported(ctx);
    setStatus(ctx, "fast", on ? "fast" : undefined);
  };
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    const config = readConfig(agentDir);
    preferred = config.fast ?? process.env.BRUV_FAST === "1";
    confirmed = config.fastConfirmed === true || process.env.BRUV_FAST === "1";
    show(ctx);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("model_select", (_event, ctx) => show(ctx));
  pi.registerCommand("fast", {
    description: "Save the priority tier default for OpenAI and Codex models.",
    async handler(args, ctx) {
      const option = args.trim();
      if (option && option !== "on" && option !== "off") throw new Error("Use /fast, /fast on, or /fast off.");
      const next = option ? option === "on" : !on;
      if (next && !supported(ctx)) {
        ctx.ui.notify("Fast mode only works with OpenAI and Codex models.", "warning");
        return;
      }
      confirmed ||= readConfig(agentDir).fastConfirmed === true;
      if (next && !confirmed) {
        confirmed = await ctx.ui.confirm(
          "Fast mode",
          "Fast mode uses the priority tier. It is faster and uses more of your quota, including subagents. Turn it on?",
        );
        if (!confirmed) return;
      }
      saveConfig({ fast: next, fastConfirmed: confirmed }, agentDir);
      preferred = next;
      show(ctx);
      ctx.ui.notify(next ? "Fast mode on: quicker replies, more quota." : "Fast mode off.", "info");
    },
  });
  let priority = false;
  pi.on("before_provider_request", (event, ctx) => {
    priority = on && supported(ctx);
    if (priority) (event.payload as Record<string, unknown>).service_tier = "priority";
  });
  // Pi prices the priority tier only when it set the tier itself or the response names it, and
  // Codex often answers "default". Reprice replies still at the base price.
  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (!priority || message.role !== "assistant" || ctx.model?.id !== message.model) return;
    const base = structuredClone(message.usage);
    calculateCost(ctx.model, base);
    if (base.cost.total <= 0 || Math.abs(base.cost.total - message.usage.cost.total) > 1e-12) return;
    return { message: { ...message, usage: priorityUsage(ctx.model, message.usage) } };
  });
  return () => on;
}
