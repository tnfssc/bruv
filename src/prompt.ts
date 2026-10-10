import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const guidance = readFileSync(new URL("../prompts/system.md", import.meta.url), "utf8").trim();

const examples = readFileSync(new URL("../prompts/codemode.md", import.meta.url), "utf8").trim();

export function registerPrompt(pi: ExtensionAPI, extra: () => string = () => ""): void {
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.bruv = pi.getActiveTools().includes("codemode")
      ? `${guidance}\n\n${examples}`
      : guidance;
  });
  pi.on("context_with_system", (event) => {
    const text = extra();
    for (const message of event.messages) {
      if (message.role === "system") {
        message.sections = { ...message.sections, bruv_goal: text || null };
      }
    }
    return { messages: event.messages };
  });
}
