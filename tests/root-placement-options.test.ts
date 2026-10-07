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

test("offline thin client still uses its explicit authorized SSH target without local provider startup", () => {
  expect(parseRootPlacementArgs(["--offline", "--place", "builder"]).remote).toEqual({ place: "builder" });
});

test("project trust is explicit placement intent, never silently dropped", () => {
  expect(parseRootPlacementArgs(["--place", "builder", "--no-approve"]).remote).toEqual({
    place: "builder",
    projectTrusted: false,
  });
  expect(() => parseRootPlacementArgs(["--place", "builder", "--approve", "--no-approve"])).toThrow("trust once");
});

test("existing server workspace keeps startup overrides without source transfer", () => {
  const args = [
    "--offline",
    "--remote-repo",
    "/server/repo",
    "--place",
    "builder",
    "--model",
    "provider/model",
    "--thinking",
    "high",
    "--approve",
    "--remote-fresh",
  ];
  const original = [...args];
  expect(parseRootPlacementArgs(args)).toEqual({
    localArgs: [],
    remote: {
      place: "builder",
      remoteRepo: "/server/repo",
      model: "provider/model",
      thinking: "high",
      projectTrusted: true,
      fresh: true,
    },
  });
  expect(args).toEqual(original);
  expect(() => parseRootPlacementArgs(["--place", "builder", "--remote-repo", "relative"])).toThrow(
    "absolute server path",
  );
  expect(() =>
    parseRootPlacementArgs(["--place", "builder", "--remote-repo", "/server", "--remote-include", "file"]),
  ).toThrow("different source choices");
});

test("only source includes repeat; singleton values and startup switches reject duplicates", () => {
  expect(
    parseRootPlacementArgs([
      "--place",
      "builder",
      "--remote-include",
      "first file",
      "--remote-source",
      "/local",
      "--remote-include",
      "second file",
    ]).remote,
  ).toEqual({ place: "builder", cwd: "/local", remoteInclude: ["first file", "second file"] });
  expect(() => parseRootPlacementArgs(["--place", "builder", "--model", "one", "--model", "two"])).toThrow(
    "Duplicate root option: --model",
  );
  expect(() => parseRootPlacementArgs(["--place", "builder", "--offline", "--offline"])).toThrow(
    "Duplicate root option",
  );
  expect(() => parseRootPlacementArgs(["--place", "builder", "--remote-fresh", "--remote-fresh"])).toThrow(
    "Duplicate root option",
  );
});

test("local separator stays opaque while remote startup accepts no prompt tail or invalid values", () => {
  const args = ["--", "--place", "builder", "--remote-source", "literal prompt"];
  expect(parseRootPlacementArgs(args).localArgs).toBe(args);
  expect(parseRootPlacementArgs(["--place", "local", ...args]).localArgs).toEqual(args);
  expect(() => parseRootPlacementArgs(["--place", "builder", "--", "prompt"])).toThrow(
    "Unsupported remote main-session argument: --",
  );
  expect(() => parseRootPlacementArgs(["--place", "builder", "--remote-source"])).toThrow(
    "--remote-source requires a value",
  );
  expect(() => parseRootPlacementArgs(["--place", "builder", "--remote-include", "bad\nfile"])).toThrow(
    "--remote-include requires a value",
  );
});
