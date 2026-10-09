/** Classification is trusted binding policy, never inferred from source or MCP annotations. */
export type ToolEffect = "arbitrary-typescript" | "mcp" | "read-only" | "edit" | "other";
export type ToolOwner = "bruv" | "app_owned" | "external";
export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  effect: ToolEffect;
  owner: ToolOwner;
  signal: AbortSignal;
}
export type PermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };
export type PermissionMode = "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions";
export interface PermissionOptions {
  mode: PermissionMode;
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  allowDangerouslySkipPermissions?: boolean;
  canUseTool?: (request: PermissionRequest) => Promise<PermissionDecision>;
}

/** Exact names and native MCP server wildcards only. No Bash-to-execute aliases. */
export function matchesToolRule(name: string, rule: string): boolean {
  if (name === rule) return true;
  return rule.startsWith("mcp__") && rule.endsWith("__*") && name.startsWith(rule.slice(0, -1));
}

/** Tool selection is handled separately by the binding/registry. */
export function createPermissionPolicy(options: PermissionOptions) {
  if (!["default", "acceptEdits", "dontAsk", "plan", "bypassPermissions"].includes(options.mode))
    throw new Error("Unsupported permission mode");
  if (options.mode === "bypassPermissions" && !options.allowDangerouslySkipPermissions)
    throw new Error("bypassPermissions requires explicit dangerous-permissions opt-in");
  // Snapshot thread policy; changing policy requires a new policy object, not mutation.
  const policy = {
    ...options,
    allowedTools: [...(options.allowedTools ?? [])],
    disallowedTools: [...(options.disallowedTools ?? [])],
  };
  return async (request: PermissionRequest): Promise<PermissionDecision> => {
    request.signal.throwIfAborted();
    const deny = (message: string): PermissionDecision => ({ behavior: "deny", message });
    if (policy.disallowedTools.some((rule) => matchesToolRule(request.toolName, rule)))
      return deny("Tool is disallowed");
    if (policy.mode === "plan" && request.effect !== "read-only")
      return deny("Plan mode needs an enforced read-only tool. Arbitrary TypeScript and MCP are not read-only");
    if (
      policy.mode === "bypassPermissions" ||
      policy.allowedTools.some((rule) => matchesToolRule(request.toolName, rule))
    )
      return { behavior: "allow" };
    if (policy.mode === "acceptEdits" && request.effect === "edit") return { behavior: "allow" };
    if (policy.mode === "plan" && request.effect === "read-only") return { behavior: "allow" };
    if (policy.mode === "dontAsk" || !policy.canUseTool) return deny("Tool needs explicit permission");
    const decision = await policy.canUseTool(request);
    request.signal.throwIfAborted();
    return decision;
  };
}
