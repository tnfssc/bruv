import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function registerFast(pi: ExtensionAPI) {
  let on = false;
  let confirmed = process.env.BRUV_FAST === "1";
  const supported = (ctx: ExtensionContext) =>
    ctx.model?.api === "openai-responses" || ctx.model?.api === "openai-codex-responses";
  const show = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus("bruv-fast", on ? "fast" : undefined);
  };
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    const entry = ctx.sessionManager
      .getBranch()
      .reverse()
      .find((e) => e.type === "custom" && e.customType === "bruv-fast");
    on =
      supported(ctx) && (entry?.type === "custom" ? (entry.data as { on: boolean }).on : process.env.BRUV_FAST === "1");
    confirmed = process.env.BRUV_FAST === "1" || on;
    show(ctx);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("model_select", (_event, ctx) => {
    if (on && !supported(ctx)) {
      on = false;
      pi.appendEntry("bruv-fast", { on });
      show(ctx);
    }
  });
  pi.registerCommand("fast", {
    description: "Toggle the priority tier for OpenAI and Codex models.",
    async handler(args, ctx) {
      const option = args.trim();
      if (option && option !== "on" && option !== "off") throw new Error("Use /fast, /fast on, or /fast off.");
      const next = option ? option === "on" : !on;
      if (next && !supported(ctx)) {
        ctx.ui.notify("Fast mode only works with OpenAI and Codex models.", "warning");
        return;
      }
      if (next && !confirmed) {
        confirmed = await ctx.ui.confirm(
          "Fast mode",
          "Fast mode uses the priority tier. It is faster and uses more of your quota, including subagents. Turn it on?",
        );
        if (!confirmed) return;
      }
      on = next;
      pi.appendEntry("bruv-fast", { on });
      show(ctx);
    },
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (on && supported(ctx)) (event.payload as Record<string, unknown>).service_tier = "priority";
  });
  return () => on;
}
