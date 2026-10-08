import { expect, test } from "bun:test";
import { setupProbeOrchestration } from "../../src/live/setup-probe";
import { bruvSystemPrompt } from "../../src/prompts";

test("setup diagnostics use the ordinary root base and registered execute schema without dispatch", async () => {
  const setup = setupProbeOrchestration();
  expect(setup.instructions).toBe(bruvSystemPrompt());
  expect(setup.tools.map((tool) => tool.name)).toEqual(["execute"]);
  expect(setup.tools[0]!.parametersJsonSchema).toMatchObject({
    type: "object",
    properties: { code: { type: "string" }, label: { type: "string" } },
    required: ["code"],
  });
  expect(await setup.execute({ name: "execute", args: { code: "throw Error('must not run')" } })).toEqual({
    status: "denied",
    reason: "Setup-only diagnostic; no agent work",
  });
});
