import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const guidance = readFileSync(new URL("../prompts/system.md", import.meta.url), "utf8").trim();
const withoutFinish = guidance.replace(/^End your work by writing your reply and calling finish.*\n/m, "");

const examples = readFileSync(new URL("../prompts/codemode.md", import.meta.url), "utf8").trim();

export function registerPrompt(pi: ExtensionAPI): void {
  let history = "";
  pi.on("session_start", (_event, ctx) => {
    // Old sessions are plain JSONL; telling the model where they are is enough to search them.
    history = `\n- Earlier sessions in this project are saved as JSONL files in \`${ctx.sessionManager.getSessionDir()}\`. When the user refers to past work that isn't in this conversation, search them with rg.`;
  });
  pi.on("before_agent_start", (event) => {
    // Pi lists every skill once read or bash is active. Leave them out; the model looks them up when needed.
    event.systemPromptOptions.skills = [];
    const text = (pi.getActiveTools().includes("finish") ? guidance : withoutFinish) + history;
    event.systemPromptOptions.sections.bruv = pi.getActiveTools().includes("codemode")
      ? `${text}\n\n${examples}`
      : text;
  });
}
