import { expect, test } from "bun:test";
import { assertRootStartupContext } from "../src/remote/root-cli";
test("main placement cannot be used to reset child or scoped-native policy", () => {
  expect(() => assertRootStartupContext({})).not.toThrow();
  expect(() => assertRootStartupContext({ DIE_SUBAGENT_DEPTH: "0", DIE_AGENT_PLACE: "server" })).not.toThrow();
  for (const env of [
    { DIE_SUBAGENT_DEPTH: "1", DIE_SUBAGENT_TYPE: "orchestrator" },
    { DIE_SUBAGENT_DEPTH: "2" },
    { DIE_SUBAGENT_DEPTH: "invalid" },
    { T3_MCP_URL: "http://scoped" },
    { T3_MCP_BEARER_TOKEN: "scoped" },
  ])
    expect(() => assertRootStartupContext(env)).toThrow("cannot reset");
});
