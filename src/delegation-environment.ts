export const T3_MCP_URL_ENV = "T3_MCP_URL";
export const T3_MCP_BEARER_ENV = "T3_MCP_BEARER_TOKEN";

/** Root orchestration authority must never become a model-directed child capability. */
function isRootControl(name: string): boolean {
  return (
    name.startsWith("T3_") ||
    name.startsWith("BRUV_T3_") ||
    name.startsWith("BRUV_ROOT_") ||
    name.startsWith("BRUV_REMOTE_ROOT_")
  );
}

/** Copy, preserving configured provider auth and ordinary CLI/workspace environment. */
export function scrubT3BridgeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...env };
  for (const name of Object.keys(scrubbed)) if (isRootControl(name)) delete scrubbed[name];
  return scrubbed;
}

/** Native binding calls this AFTER capturing injected config, BEFORE loading extensions. */
export function scrubRootEnvironmentInPlace(env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(env)) if (isRootControl(name)) delete env[name];
}

/** A child is a distinct session. Never checkpoint its SSH owner parent. */
export function childAgentEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child = scrubT3BridgeEnvironment(env);
  delete child.BRUV_REMOTE_RUNTIME_STATE;
  return child;
}
