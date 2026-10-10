import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readJson } from "./config";

export function enableCodemode(agentDir = getAgentDir()): void {
  const path = join(agentDir, "settings.json");
  const settings = readJson<ReturnType<ExtensionAPI["getSettings"]>>(path, {});
  const defaultTools = [...(settings.defaultTools ?? [])];
  if (!defaultTools.some((tool) => tool === "codemode" || tool === "+codemode")) {
    defaultTools.push(defaultTools.every((tool) => /^[+-]/.test(tool)) ? "+codemode" : "codemode");
  }
  const updated = {
    ...settings,
    defaultTools,
    codemode: { ...settings.codemode, mode: "only" },
  };
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
}

export function registerCodemode(pi: ExtensionAPI): void {
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
