import type { BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import handoff from "./prompts/background-handoff.md" with { type: "text" };
import fast from "./prompts/fast.md" with { type: "text" };
import identity from "./prompts/identity.md" with { type: "text" };
import mainOrchestrator from "./prompts/main-orchestrator.md" with { type: "text" };
import normal from "./prompts/normal.md" with { type: "text" };
import orchestrator from "./prompts/orchestrator.md" with { type: "text" };
import system from "./prompts/system.md" with { type: "text" };

// Text imports embed the Markdown in the standalone executable.
const bullets = (text: string): string[] =>
  text
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
export const workingValues = bullets(system);

export function collaborationGuidance(): string {
  return system.trimEnd();
}

export function backgroundHandoff(ids: string[]): string {
  if (!ids.length) return "";
  const names = ids.slice(0, 20).join(", ") + (ids.length > 20 ? " (and " + (ids.length - 20) + " more)" : "");
  return handoff.trimEnd().replace("{{jobs}}", () => names);
}

export function subagentGuidance(role: string): string {
  const template = role === "fast" ? fast : role === "orchestrator" ? orchestrator : normal;
  const guidance = template.trimEnd().replace("{{role}}", () => role);
  return role === "orchestrator" ? `${guidance}\n\n${mainOrchestrator.trimEnd()}` : guidance;
}

export const MAIN_AGENT_MODES = ["fast", "normal", "orchestrator"] as const;
export type MainAgentMode = (typeof MAIN_AGENT_MODES)[number];
function mainModeMarkers(owner: string): [string, string] {
  // owner is generated internally, not derived from project or user text.
  return [`<!-- bruv:main-agent-mode:${owner}:start -->`, `<!-- bruv:main-agent-mode:${owner}:end -->`];
}

export function mainAgentGuidance(mode: MainAgentMode, owner: string): string {
  const source = mode === "orchestrator" ? mainOrchestrator.trimEnd() : "";
  const [start, end] = mainModeMarkers(owner);
  return start + "\n" + source + "\n" + end;
}

/** Replace only the region with this Bruv session's unguessable owner marker. */
export function replaceMainAgentGuidance(prompt: string, mode: MainAgentMode, owner: string): string {
  const [startMarker, endMarker] = mainModeMarkers(owner);
  const start = prompt.indexOf(startMarker);
  if (start < 0) return prompt;
  const end = prompt.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return prompt;
  return prompt.slice(0, start) + mainAgentGuidance(mode, owner) + prompt.slice(end + endMarker.length);
}

/**
 * Give Pi Bruv's base as a structured custom prompt. Pi still adds user text,
 * project context, skills, and cwd.
 */
export function bruvSystemPrompt(): string {
  return identity.trimEnd();
}

/** Return true only for Bruv's injected base. All other custom prompts belong to the user. */
export function isBruvSystemPrompt(options: Pick<BuildSystemPromptOptions, "customPrompt"> | undefined): boolean {
  return options?.customPrompt === bruvSystemPrompt();
}

function hasUserSystemPrompt(options: Pick<BuildSystemPromptOptions, "customPrompt"> | undefined): boolean {
  return !!options?.customPrompt && !isBruvSystemPrompt(options);
}

/** Pi has already assembled context, skills, cwd and append text. Only add Bruv's framing. */
export function withMainAgentGuidance(
  prompt: string,
  options: Pick<BuildSystemPromptOptions, "customPrompt"> | undefined,
  modeGuidance: () => string,
): string {
  // A root custom base owns the entire frame, including whether it has a mode region.
  if (hasUserSystemPrompt(options)) return prompt;
  return `${prompt}\n\n${collaborationGuidance()}\n\n${modeGuidance()}`;
}

export function withSubagentGuidance(
  prompt: string,
  options: Pick<BuildSystemPromptOptions, "customPrompt"> | undefined,
  role: string,
): string {
  // A worker keeps its role on every base; a custom base still owns collaboration policy.
  const roleGuidance = subagentGuidance(role);
  if (hasUserSystemPrompt(options)) return `${prompt}\n\n${roleGuidance}`;
  return `${prompt}\n\n${collaborationGuidance()}\n\n${roleGuidance}`;
}
