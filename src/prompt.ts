import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  getDocsPath,
  getExamplesPath,
} from "@earendil-works/pi-coding-agent";

const guidance = readFileSync(new URL("../prompts/system.md", import.meta.url), "utf8").trim();
const withoutFinish = guidance.replace(/^End your work by writing your reply and calling finish.*\n/m, "");

export const examples = readFileSync(new URL("../prompts/codemode.md", import.meta.url), "utf8").trim();
const piDocs = fileURLToPath(new URL("../prompts/pi-docs.md", import.meta.url));

type Options = BeforeAgentStartEvent["systemPromptOptions"];

/** The tool rules Pi would list for declared tools, without its two general ones. */
export function toolRules(options: Options) {
  const declared = options.selectedTools.filter((name) => !options.hiddenTools.includes(name));
  const rules = [...declared.flatMap((name) => options.toolGuidelines[name] ?? []), ...options.promptGuidelines];
  return [...new Set(rules.map((rule) => rule.trim()).filter(Boolean))].map((rule) => `- ${rule}`).join("\n");
}

export function registerPrompt(pi: ExtensionAPI): void {
  let history = "";
  pi.on("session_start", (_event, ctx) => {
    // Sessions are plain JSONL; telling the model where they are is enough to search them.
    const file = ctx.sessionManager.getSessionFile();
    history = [
      file &&
        `- This session is saved in \`${file}\`. Compaction leaves only a summary of earlier messages in context; when you need something from before it, search that file with rg.`,
      `- Earlier sessions in this project are saved as JSONL files in \`${ctx.sessionManager.getSessionDir()}\`. When the user refers to past work that isn't in this conversation, search them with rg.`,
      `- For questions about Pi itself, read \`${piDocs}\` first. Pi's docs are in \`${getDocsPath()}\` and its examples in \`${getExamplesPath()}\`.`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  pi.on("before_agent_start", (event) => {
    const options = event.systemPromptOptions;
    // Pi lists every skill once read or bash is active. Leave them out; the model looks them up when needed.
    options.skills = [];
    // bruv's guidance replaces Pi's opening line, tool list, general rules and docs list. The tools'
    // own rules stay, and the docs list moves to a file the model reads when it needs it.
    const rules = toolRules(options);
    if (rules) options.sections.tool_rules = rules;
    const text = `${pi.getActiveTools().includes("finish") ? guidance : withoutFinish}\n${history}`;
    options.customPrompt = pi.getActiveTools().includes("codemode") ? `${text}\n\n${examples}` : text;
  });
}
