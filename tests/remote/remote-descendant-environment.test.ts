import { expect, test } from "bun:test";
import { childAgentEnvironment, scrubT3BridgeEnvironment } from "../../src/delegation-environment";
test("remote orchestrator descendants keep destination environment but never checkpoint their parent session", () => {
  const parent = {
    BRUV_ROOT_RUNTIME_DIR: "/owner/root",
    BRUV_REMOTE_ROOT_SESSION: "root-session",
    BRUV_AGENT_PLACE: "server",
    HOME: "/server",
    PATH: "/server/bin",
    BRUV_REMOTE_RUNTIME_STATE: "/owner/runtime.json",
    T3_MCP_URL: "http://bridge",
    T3_MCP_BEARER_TOKEN: "secret",
    BRUV_SUBAGENT_TYPE: "orchestrator",
  };
  expect(childAgentEnvironment(parent)).toEqual({
    BRUV_AGENT_PLACE: "server",
    HOME: "/server",
    PATH: "/server/bin",
    BRUV_SUBAGENT_TYPE: "orchestrator",
  });
  expect(parent.BRUV_REMOTE_RUNTIME_STATE).toBe("/owner/runtime.json");
  // Execute helpers still need the current owner's capability checkpoint.
  expect(scrubT3BridgeEnvironment(parent).BRUV_REMOTE_RUNTIME_STATE).toBe(parent.BRUV_REMOTE_RUNTIME_STATE);
});

test("human root facet authority is absent from all model-directed tool environments", () => {
  const parent = {
    BRUV_ROOT_RUNTIME_SOCKET: "/private/root.sock",
    BRUV_ROOT_RUNTIME_TOKEN: "human-authority",
    HOME: "/server",
  };
  expect(scrubT3BridgeEnvironment(parent)).toEqual({ HOME: "/server" });
  expect(childAgentEnvironment(parent)).toEqual({ HOME: "/server" });
  expect(parent.BRUV_ROOT_RUNTIME_TOKEN).toBe("human-authority");
});
