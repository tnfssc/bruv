import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Checker } from "./check";
import { type Config, readConfig, saveConfig } from "./config";
import { toolResult } from "./jobs";

const parameters = Type.Object({
  status: Type.Union([Type.Literal("done"), Type.Literal("need_you"), Type.Literal("blocked")]),
  note: Type.Optional(Type.String()),
});

export function registerFinish(pi: ExtensionAPI, agentDir = getAgentDir(), check?: Checker, hasGoal = () => false) {
  let mode: NonNullable<Config["keepGoing"]> = "auto";
  let active = false;
  let goalRun = false;
  let finished = false;
  let continued = false;
  let empty = 0;
  const reset = () => {
    finished = false;
    continued = false;
    empty = 0;
  };
  const select = (ctx: ExtensionContext) => {
    active =
      hasGoal() ||
      mode === "on" ||
      (mode === "auto" && (ctx.model?.api === "openai-codex-responses" || ctx.model?.api === "openai-responses"));
    // Model-only tools stay declared when codemode hides its callable tools.
    pi.registerTool({
      name: "finish",
      label: "Finish",
      description:
        "End the run after writing your reply in the same message. Use done when work is done and checked, need_you for a user choice, or blocked when you cannot go on. Call this tool alone after other tools have finished; every tool in a batch must agree to end the run.",
      exposure: active ? "model-only" : "hidden",
      parameters,
      outputSchema: parameters,
      async execute(_id, args, signal, _update, ctx) {
        if (active && args.status === "done") {
          const retry = await check?.run(ctx, signal);
          if (retry) return toolResult({ status: args.status, note: retry });
        }
        signal?.throwIfAborted();
        finished = true;
        return { ...toolResult(args), terminate: true };
      },
    });
  };
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    mode = readConfig(agentDir).keepGoing ?? "auto";
    reset();
    select(ctx);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("before_agent_start", (_event, ctx) => {
    goalRun = hasGoal();
    select(ctx);
  });
  pi.on("model_select", (_event, ctx) => select(ctx));
  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "user") return;
    reset();
    goalRun ||= hasGoal();
    select(ctx);
  });
  pi.on("tool_call", () => {
    continued = false;
    empty = 0;
  });
  pi.registerCommand("keep-going", {
    description: "Show or save when runs must call finish: on, off, or auto.",
    async handler(args, ctx) {
      const option = args.trim();
      if (option) {
        if (option !== "on" && option !== "off" && option !== "auto")
          throw new Error("Use /keep-going on, off, or auto.");
        mode = option;
        saveConfig({ keepGoing: mode }, agentDir);
        select(ctx);
      }
      ctx.ui.notify(`Keep going: ${mode} (${active ? "on" : "off"} for this model).`, "info");
    },
  });
  pi.on("agent_before_settle", (event) => {
    if (goalRun && !hasGoal()) return {};
    if (!active || event.outcome === "aborted" || event.continue || event.entries.length || finished) return {};
    if (continued) empty++;
    if (empty >= 2) return {};
    continued = true;
    return {
      entries: [
        {
          type: "custom_message" as const,
          customType: "bruv-keep-going",
          display: false,
          content:
            "You ended your turn without calling finish. If everything asked is done and checked, or you need the user, write your reply and call finish. Otherwise keep going.",
        },
      ],
      continue: true,
    };
  });
  return () => active && finished;
}
