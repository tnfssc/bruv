import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerExecuteTool } from "../typescript/extension";
import { bruvSystemPrompt } from "../prompts";
import type { VoiceOrchestration } from "./types";

/** Setup-only diagnostics use the registered tool schema, never a parallel companion API. */
export function setupProbeOrchestration(): VoiceOrchestration {
  const tools: VoiceOrchestration["tools"] = [];
  const registration: Pick<ExtensionAPI, "on" | "registerTool"> = {
    on: () => () => {},
    registerTool(tool) {
      tools.push({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters });
    },
  };
  registerExecuteTool(registration as ExtensionAPI);
  return {
    tools,
    instructions: bruvSystemPrompt(),
    execute: async () => ({ status: "denied", reason: "Setup-only diagnostic; no agent work" }),
  };
}
