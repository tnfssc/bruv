import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCodemodeExtension, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readJson } from "./config";

const examples = readFileSync(new URL("../prompts/codemode.md", import.meta.url), "utf8").trim();

export function enableCodemode(agentDir = getAgentDir()): void {
  const path = join(agentDir, "settings.json");
  const settings = readJson<ReturnType<ExtensionAPI["getSettings"]>>(path, {});
  const updated = {
    ...settings,
    defaultTools: ["+codemode"],
    codemode: { ...settings.codemode, mode: "only" },
  };
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
}

export async function registerCodemode(pi: ExtensionAPI): Promise<void> {
  // Use Pi's factory and keep its tool execution and loadout rules.
  await createCodemodeExtension()({
    ...pi,
    registerTool(tool) {
      pi.registerTool({
        ...tool,
        prepareLoadout(loadout) {
          const changes = tool.prepareLoadout?.(loadout);
          return {
            ...changes,
            descriptions: {
              ...changes?.descriptions,
              codemode: `${changes?.descriptions?.codemode ?? tool.description}\n\n${examples}`,
            },
          };
        },
      });
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!pi.getActiveTools().includes("codemode") || pi.getSettings().codemode?.mode !== "only") {
      ctx.ui.notify("bruv works best with codemode only. Run /bruv-setup to turn it on.", "info");
    }
  });

  pi.registerCommand("bruv-setup", {
    description: "Use codemode for all tool calls",
    handler: async (_args, ctx) => {
      if (!(await ctx.ui.confirm("Set up bruv?", "Enable codemode only in your Pi settings?"))) return;
      enableCodemode();
      ctx.ui.notify("Codemode only is saved. Run /reload to use it.", "info");
    },
  });
}
