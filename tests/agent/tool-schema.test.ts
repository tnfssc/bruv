import { test, expect } from "bun:test";
import * as z from "zod/mini";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import { toolParameters } from "../../src/typescript/tool-schema";
import extension from "../../src/agent/extension";
import { setupProbeOrchestration } from "../../src/live/setup-probe";

function registeredTools() {
  const tools: any[] = [];
  extension({
    registerTool: (t: any) => tools.push(t),
    registerCommand() {},
    registerFlag() {},
    getFlag() {
      return false;
    },
    registerMessageRenderer() {},
    on() {},
  } as any);
  return tools;
}

test("only execute is registered and setup probes share its declaration", () => {
  const tools = registeredTools();
  expect(tools.map((t) => t.name)).toEqual(["execute"]);
  expect(setupProbeOrchestration().tools).toEqual(
    tools.map(({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })),
  );
});

test("registered execute has a provider-friendly schema", () => {
  const [execute] = registeredTools();
  expect(execute.promptSnippet).toBe("Run JS/TS.");
  expect(execute.parameters).toMatchObject({
    type: "object",
    required: ["code"],
    properties: { code: { type: "string" }, timeoutSeconds: { type: "number", minimum: 0.1 } },
  });
  expect(execute.parameters.properties.code.description).toBeUndefined();
  expect(execute.parameters.properties.timeoutSeconds.description).toBeUndefined();
});

test("toolParameters preserves enum choices in JSON Schema", () => {
  expect(toolParameters(z.object({ choice: z.enum(["one", "two"]) }))).toMatchObject({
    properties: { choice: { enum: ["one", "two"] } },
  });
});

test("registered execute coerces valid arguments and rejects missing or out-of-range values", () => {
  const [execute] = registeredTools();
  expect(
    validateToolArguments(execute, {
      type: "toolCall",
      id: "t",
      name: "execute",
      arguments: { code: "console.log(1)", timeoutSeconds: "2" },
    }),
  ).toEqual({ code: "console.log(1)", timeoutSeconds: 2 });
  const invalidArgs: JsonObject[] = [{}, { code: "ok", timeoutSeconds: 0 }];
  for (const args of invalidArgs)
    expect(() =>
      validateToolArguments(execute, { type: "toolCall", id: "t", name: "execute", arguments: args }),
    ).toThrow();
});
