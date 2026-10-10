import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig, saveConfig } from "./config";

export function registerFast(pi: ExtensionAPI, agentDir = getAgentDir()) {
  let preferred = false;
  let on = false;
  let confirmed = false;
  const supported = (ctx: ExtensionContext) =>
    ctx.model?.api === "openai-responses" || ctx.model?.api === "openai-codex-responses";
  const show = (ctx: ExtensionContext) => {
    on = preferred && supported(ctx);
    if (ctx.hasUI) ctx.ui.setStatus("bruv-fast", on ? "fast" : undefined);
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
    },
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (on && supported(ctx)) (event.payload as Record<string, unknown>).service_tier = "priority";
  });
  return () => on;
}
