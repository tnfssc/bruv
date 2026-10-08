import { describe, expect, test } from "bun:test";
import { parseRootPlacementArgs } from "../../src/remote/root-options";

describe("local conversation dispatch", () => {
  test("targetless and explicit local preserve normal arguments", () => {
    const args = ["--model", "local/model", "--", "literal --place server"];
    const targetless = parseRootPlacementArgs(args);
    expect(targetless.localArgs).toBe(args);
    expect(targetless).toEqual({ localArgs: args });
    expect(parseRootPlacementArgs(["--place", "local", ...args])).toEqual({ localArgs: args });
  });

  test("placement-looking flags after the separator remain opaque local arguments", () => {
    const args = ["--", "--place", "builder", "--remote-source", "literal prompt"];
    const targetless = parseRootPlacementArgs(args);
    expect(targetless.localArgs).toBe(args);
    expect(targetless).toEqual({ localArgs: args });
    expect(parseRootPlacementArgs(["--place", "local", ...args])).toEqual({ localArgs: args });
  });

  test("remote source options require named placement, never implicit or explicit local", () => {
    expect(() => parseRootPlacementArgs(["--remote-repo", "/repo"])).toThrow(
      "Remote session options require --place <authorized name>",
    );
    expect(() => parseRootPlacementArgs(["--place", "local", "--remote-repo", "/repo"])).toThrow(
      "Remote session options cannot change local placement",
    );
  });
});

describe("remote root source selection", () => {
  test("local source transfer carries selected includes and destination model intent", () => {
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
      ]),
    ).toEqual({
      localArgs: [],
      remote: {
        place: "authorized",
        cwd: "/repo",
        remoteInclude: ["new file"],
        model: "server/model",
        thinking: "low",
      },
    });
  });

  test("source includes may repeat and retain their order around the source option", () => {
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
      ]),
    ).toEqual({
      localArgs: [],
      remote: { place: "builder", cwd: "/local", remoteInclude: ["first file", "second file"] },
    });
  });

  test("existing server workspace carries startup overrides without mutating the input", () => {
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
  });

  test("existing server workspace cannot also request local source or include transfer", () => {
    expect(() =>
      parseRootPlacementArgs(["--place", "box", "--remote-repo", "/server", "--remote-source", "/local"]),
    ).toThrow("different source choices");
    expect(() =>
      parseRootPlacementArgs(["--place", "builder", "--remote-repo", "/server", "--remote-include", "file"]),
    ).toThrow("different source choices");
  });

  test("source options require values and includes cannot contain a newline", () => {
    expect(() => parseRootPlacementArgs(["--place", "builder", "--remote-source"])).toThrow(
      "--remote-source requires a value",
    );
    expect(() => parseRootPlacementArgs(["--place", "builder", "--remote-include", "bad\nfile"])).toThrow(
      "--remote-include requires a value",
    );
  });
});

describe("remote root startup intent", () => {
  test("offline retains explicit named dispatch rather than local arguments", () => {
    expect(parseRootPlacementArgs(["--offline", "--place", "builder"])).toEqual({
      localArgs: [],
      remote: { place: "builder" },
    });
  });

  test("project trust is explicit placement intent, never silently dropped", () => {
    expect(parseRootPlacementArgs(["--place", "builder", "--no-approve"])).toEqual({
      localArgs: [],
      remote: { place: "builder", projectTrusted: false },
    });
    expect(() => parseRootPlacementArgs(["--place", "builder", "--approve", "--no-approve"])).toThrow("trust once");
  });

  test("singleton values and startup switches reject duplicates", () => {
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

  test("unsupported thinking cannot silently fall back to a destination default", () => {
    expect(() => parseRootPlacementArgs(["--place", "box", "--thinking", "silently-fallback"])).toThrow(
      "Unsupported root thinking override",
    );
  });
});

describe("named remote attachment boundary", () => {
  test("placement requires a name and cannot supply a host as authorization", () => {
    expect(() => parseRootPlacementArgs(["--place"])).toThrow(
      "--place requires local or a human-authorized named target",
    );
    expect(() => parseRootPlacementArgs(["--place", "box", "--host", "unapproved"])).toThrow(
      "Unsupported remote main-session argument: --host",
    );
  });

  test("startup accepts no prompt tail, including one after a separator", () => {
    expect(() => parseRootPlacementArgs(["--place", "box", "repeat a possibly accepted prompt"])).toThrow(
      "Unsupported remote main-session argument: repeat a possibly accepted prompt",
    );
    expect(() => parseRootPlacementArgs(["--place", "builder", "--", "prompt"])).toThrow(
      "Unsupported remote main-session argument: --",
    );
  });
});
