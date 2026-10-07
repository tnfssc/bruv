import { describe, expect, test } from "bun:test";
import { assertLaunchBindings, parseConnectorArguments } from "../src/claude-compat/arguments";

const stream = ["--input-format", "stream-json", "--output-format", "stream-json"];
const auxiliary = ["-p", "--output-format", "json", "--json-schema", '{"type":"object"}', "summarize"];

describe("connector compatibility-only flags", () => {
  test("verbose and strict MCP do not carry runtime switches in either output mode", () => {
    for (const mode of [stream, auxiliary]) {
      const baseline = parseConnectorArguments(mode);
      assertLaunchBindings(baseline);
      expect(baseline).not.toHaveProperty("verbose");
      expect(baseline).not.toHaveProperty("strictMcp");
      for (const flags of [["--verbose"], ["--strict-mcp-config"], ["--verbose", "--strict-mcp-config"]]) {
        const args = parseConnectorArguments([...mode, ...flags]);
        assertLaunchBindings(args);
        expect(args).toEqual(baseline);
      }
    }
  });

  test("compatibility flags still reject inline values and duplicates", () => {
    for (const flag of ["--verbose", "--strict-mcp-config"]) {
      for (const mode of [stream, auxiliary]) {
        for (const value of ["", "true", "false"])
          expect(() => parseConnectorArguments([...mode, flag + "=" + value])).toThrow(flag + " does not take a value");
        expect(() => parseConnectorArguments([...mode, flag, flag])).toThrow("Duplicate option: " + flag);
      }
    }
  });
});
