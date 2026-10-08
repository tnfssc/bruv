import { expect, test } from "bun:test";
import { assertRootStartupContext } from "../../src/remote/root-cli";
test("main placement cannot be used to reset child or scoped-native policy", () => {
  expect(() => assertRootStartupContext({})).not.toThrow();
  expect(() => assertRootStartupContext({ BRUV_SUBAGENT_DEPTH: "0", BRUV_AGENT_PLACE: "server" })).not.toThrow();
  for (const env of [
    { BRUV_SUBAGENT_DEPTH: "1", BRUV_SUBAGENT_TYPE: "orchestrator" },
    { BRUV_SUBAGENT_DEPTH: "2" },
    { BRUV_SUBAGENT_DEPTH: "invalid" },
    { T3_MCP_URL: "http://scoped" },
    { T3_MCP_BEARER_TOKEN: "scoped" },
  ])
    expect(() => assertRootStartupContext(env)).toThrow("cannot reset");
});
