import { executeDeclaration } from "../typescript/definition";
import { bruvSystemPrompt } from "../prompts";
import type { VoiceOrchestration } from "./types";

/** Setup-only diagnostics use the ordinary execute schema and never run agent work. */
export function setupProbeOrchestration(): VoiceOrchestration {
  const { name, description, parameters } = executeDeclaration();
  return {
    tools: [{ name, description, parametersJsonSchema: parameters }],
    instructions: bruvSystemPrompt(),
    execute: async () => ({ status: "denied", reason: "Setup-only diagnostic; no agent work" }),
  };
}
