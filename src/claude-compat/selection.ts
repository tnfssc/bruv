import type { Api, Model } from "@earendil-works/pi-ai";
import nativePermissions from "../prompts/native-permissions.md" with { type: "text" };

const READ_TOOLS = ["read", "grep", "find", "ls"];
const EDIT_TOOLS = ["edit", "write"];

export function nativeDefaultTools(mode: string | undefined, mcpTools: readonly string[]): string[] {
  if (mode === "plan") return [...READ_TOOLS];
  return ["execute", ...(mode === "acceptEdits" ? [...READ_TOOLS, ...EDIT_TOOLS] : []), ...mcpTools];
}

/** Register every inferred mode's tools before selecting the active mode. */
export function nativeToolRegistry(mcpTools: readonly string[]): string[] {
  return ["execute", ...READ_TOOLS, ...EDIT_TOOLS, ...mcpTools];
}

export const NATIVE_PERMISSION_GUIDANCE = nativePermissions.trimEnd();

export function assertNativeThinkingDisplay(model: Model<Api>, thinkingDisplay: string | undefined): void {
  if (
    thinkingDisplay === "summarized" &&
    model.reasoning &&
    !["anthropic-messages", "openai-responses", "openai-codex-responses", "azure-openai-responses"].includes(model.api)
  ) {
    throw new Error("Thinking summaries are unsupported for this reasoning API");
  }
}
