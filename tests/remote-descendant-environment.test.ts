import { expect, test } from "bun:test";
import { childAgentEnvironment, scrubT3BridgeEnvironment } from "../src/delegation-environment";
test("remote orchestrator descendants keep destination environment but never checkpoint their parent session", () => {
  const parent = {
    DIE_ROOT_RUNTIME_DIR: "/owner/root",
    DIE_REMOTE_ROOT_SESSION: "root-session",
    DIE_AGENT_PLACE: "server",
    HOME: "/server",
    PATH: "/server/bin",
    DIE_REMOTE_RUNTIME_STATE: "/owner/runtime.json",
    T3_MCP_URL: "http://bridge",
    T3_MCP_BEARER_TOKEN: "secret",
    DIE_SUBAGENT_TYPE: "orchestrator",
  };
  expect(childAgentEnvironment(parent)).toEqual({
    DIE_AGENT_PLACE: "server",
    HOME: "/server",
    PATH: "/server/bin",
    DIE_SUBAGENT_TYPE: "orchestrator",
  });
  expect(parent.DIE_REMOTE_RUNTIME_STATE).toBe("/owner/runtime.json");
  // Execute helpers still need the current owner's capability checkpoint.
  expect(scrubT3BridgeEnvironment(parent).DIE_REMOTE_RUNTIME_STATE).toBe(parent.DIE_REMOTE_RUNTIME_STATE);
});
