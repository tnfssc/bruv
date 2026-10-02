import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import wisdomGuidance from "../prompts/wisdom.md" with { type: "text" };

export interface ProjectWisdomOptions {
  isRoot: () => boolean;
}

function rootAllowed(callback: () => boolean): boolean {
  try {
    return callback() === true;
  } catch {
    return false;
  }
}

export function registerProjectWisdom(pi: ExtensionAPI, options: ProjectWisdomOptions): void {
  pi.registerCommand("wisdom", {
    description: "Show where project wisdom lives",
    async handler(_args, ctx) {
      if (!rootAllowed(options.isRoot))
        return ctx.ui.notify("Project wisdom is unavailable outside the root agent.", "warning");
      return ctx.ui.notify("Project wisdom lives in wisdom/. Put it with the feature or system it explains.");
    },
  });

  pi.on("before_agent_start", (event) => {
    if (!rootAllowed(options.isRoot)) return;
    return {
      systemPrompt: event.systemPrompt + "\n\n" + wisdomGuidance.trimEnd(),
    };
  });
}
