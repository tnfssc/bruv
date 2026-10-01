import { expect, test } from "bun:test";
import { parseRootPlacementArgs } from "../src/remote/root-options";
test("targetless and explicit local preserve normal arguments", () => {
  const args = ["--model", "local/model", "--", "literal --place server"];
  expect(parseRootPlacementArgs(args).localArgs).toBe(args);
  expect(parseRootPlacementArgs(["--place", "local", ...args]).localArgs).toEqual(args);
});
test("root placement is explicit named choice and source stays distinct", () => {
  expect(
    parseRootPlacementArgs([
      "--place",
      "authorized",
      "--remote-source",
      "/repo",
      "--remote-include",
      "new file",
      "--model",
      "server/model",
      "--thinking",
      "low",
    ]).remote,
  ).toEqual({ place: "authorized", cwd: "/repo", remoteInclude: ["new file"], model: "server/model", thinking: "low" });
  for (const args of [
    ["--place"],
    ["--remote-repo", "/repo"],
    ["--place", "local", "--remote-repo", "/repo"],
    ["--place", "box", "--remote-repo", "/server", "--remote-source", "/local"],
    ["--place", "box", "--host", "unapproved"],
    ["--place", "box", "repeat a possibly accepted prompt"],
    ["--place", "box", "--thinking", "silently-fallback"],
  ])
    expect(() => parseRootPlacementArgs(args)).toThrow();
});
