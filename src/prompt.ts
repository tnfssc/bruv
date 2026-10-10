import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const guidance = readFileSync(new URL("../prompts/system.md", import.meta.url), "utf8").trim();

export function registerPrompt(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.bruv = guidance;
  });
}
