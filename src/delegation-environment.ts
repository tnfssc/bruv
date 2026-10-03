export const T3_MCP_URL_ENV = "T3_MCP_URL";
export const T3_MCP_BEARER_ENV = "T3_MCP_BEARER_TOKEN";

/** Copy an environment for model-directed code without delegation credentials. */
export function scrubT3BridgeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...env };
  delete scrubbed[T3_MCP_URL_ENV];
  delete scrubbed[T3_MCP_BEARER_ENV];
  // Human presentation authority is not a model-directed tool capability.
  delete scrubbed.BRUV_ROOT_RUNTIME_SOCKET;
  delete scrubbed.BRUV_ROOT_RUNTIME_TOKEN;
  return scrubbed;
}

/** A child is a distinct session. Do not let its checkpoints overwrite its SSH owner parent. */
export function childAgentEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child = scrubT3BridgeEnvironment(env);
  delete child.BRUV_REMOTE_RUNTIME_STATE;
  for (const name of Object.keys(child))
    if (name.startsWith("BRUV_REMOTE_ROOT_") || name.startsWith("BRUV_ROOT_")) delete child[name];
  delete child.BRUV_SUBAGENT_NATIVE_FAST;
  return child;
}
