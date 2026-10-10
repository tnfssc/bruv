import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const guidance = readFileSync(new URL("../prompts/system.md", import.meta.url), "utf8").trim();
const withoutFinish = guidance.replace(/^End your work by writing your reply and calling finish.*\n/m, "");

const examples = readFileSync(new URL("../prompts/codemode.md", import.meta.url), "utf8").trim();

export function registerPrompt(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const text = pi.getActiveTools().includes("finish") ? guidance : withoutFinish;
    event.systemPromptOptions.sections.bruv = pi.getActiveTools().includes("codemode")
      ? `${text}\n\n${examples}`
      : text;
  });
}
