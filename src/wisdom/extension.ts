import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import wisdomGuidance from "../prompts/wisdom.md" with { type: "text" };
import { projectWisdomDir } from "./location";

export interface ProjectWisdomOptions {
  isRoot: (ctx: ExtensionContext) => boolean;
}

function rootAllowed(callback: ProjectWisdomOptions["isRoot"], ctx: ExtensionContext): boolean {
  try {
    return callback(ctx) === true;
  } catch {
    return false;
  }
}

export function registerProjectWisdom(pi: ExtensionAPI, options: ProjectWisdomOptions): void {
  pi.registerCommand("wisdom", {
    description: "Show where project wisdom lives",
    async handler(_args, ctx) {
      if (!rootAllowed(options.isRoot, ctx))
        return ctx.ui.notify("Project wisdom is unavailable outside the root agent.", "warning");
      const directory = projectWisdomDir(ctx.cwd, ctx.isProjectTrusted());
      return ctx.ui.notify(`Project wisdom lives in ${directory}/. Put it with the feature or system it explains.`);
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (!rootAllowed(options.isRoot, ctx)) return;
    const directory = projectWisdomDir(ctx.cwd, ctx.isProjectTrusted());
    const guidance = wisdomGuidance
      .trimEnd()
      .replaceAll("{{wisdomDir}}", () => directory)
      .replaceAll("{{valuesPath}}", () => join(directory, "values.md"));
    return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
  });
}
