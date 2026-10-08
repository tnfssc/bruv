import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reportFixture } from "./fixtures/terminal-interaction-report";
import { parseInteractionOptions } from "../scripts/terminal-perf/interaction-options";
import { selectInteractionCases } from "../scripts/terminal-interactions";

test("interaction defaults are measurement defaults, not an explicit budget override", () => {
  const options = parseInteractionOptions([]);
  expect(options).toEqual({
    groups: ["send", "tools", "navigation"],
    cases: [],
    repetitions: 1,
    budget: 8,
    budgetExplicit: false,
    width: 100,
    height: 32,
    out: "artifacts/terminal-interactions/latest",
    strict: false,
    list: false,
    help: false,
  });
  options.groups.pop();
  options.cases.push("send/short");
  expect(parseInteractionOptions([]).groups).toEqual(["send", "tools", "navigation"]);
  expect(parseInteractionOptions([]).cases).toEqual([]);
  expect(parseInteractionOptions(["--budget", "8"])).toMatchObject({ budget: 8, budgetExplicit: true });
});

test("each flag consumes only its own value and repeated selectors replace earlier ones", () => {
  expect(
    parseInteractionOptions([
      "--strict",
      "--list",
      "-h",
      "--help",
      "--groups",
      "navigation,send,navigation",
      "--groups",
      "tools,send,tools",
      "--cases",
      "navigation/search",
      "--cases",
      "tools/short,send/short,tools/short",
      "--repetitions",
      "2",
      "--budget",
      "7.5",
      "--budget",
      "8",
      "--width",
      "120",
      "--height",
      "40",
      "--out",
      "-h",
      "--baseline",
      "baseline.json",
      "--report",
      "saved.json",
    ]),
  ).toEqual({
    groups: ["tools", "send"],
    cases: ["tools/short", "send/short"],
    repetitions: 2,
    budget: 8,
    budgetExplicit: true,
    width: 120,
    height: 40,
    out: "-h",
    baseline: "baseline.json",
    report: "saved.json",
    strict: true,
    list: true,
    help: true,
  });
});

test("bounded numeric options retain their inclusive limits and fractional budget", () => {
  expect(parseInteractionOptions(["--repetitions", "1", "--width", "24", "--height", "8"])).toMatchObject({
    repetitions: 1,
    width: 24,
    height: 8,
  });
  expect(parseInteractionOptions(["--repetitions", "100", "--width", "240", "--height", "100"])).toMatchObject({
    repetitions: 100,
    width: 240,
    height: 100,
  });
  for (const budget of ["5e-324", "0.5", "10000"])
    expect(parseInteractionOptions(["--budget", budget]).budget).toBe(Number(budget));
  for (const [flag, value] of [
    ["--repetitions", "1.5"],
    ["--repetitions", "101"],
    ["--budget", "0"],
    ["--budget", "10001"],
    ["--budget", "Infinity"],
    ["--budget", "NaN"],
    ["--budget", " "],
    ["--width", "23"],
    ["--height", "101"],
  ])
    expect(() => parseInteractionOptions([flag, value])).toThrow("Invalid " + flag);
});

test("option syntax preserves specific diagnostics even with help or report requested", () => {
  for (const args of [["--unknown"], ["--help", "--unknown"], ["--report", "saved.json", "--unknown"]])
    expect(() => parseInteractionOptions(args)).toThrow("Unknown option --unknown");
  for (const flag of [
    "--groups",
    "--cases",
    "--repetitions",
    "--budget",
    "--width",
    "--height",
    "--out",
    "--baseline",
    "--report",
  ])
    for (const tail of [[], [""], ["--strict"]])
      expect(() => parseInteractionOptions([flag, ...tail])).toThrow("Missing value for " + flag);
  expect(() => parseInteractionOptions(["--groups", "send, tools"])).toThrow("Unknown interaction group");
  expect(() => parseInteractionOptions(["--cases", "send/short,"])).toThrow("Empty case");
});

test("catalog selection, not parsing, owns runnable IDs and group intersection", () => {
  const options = parseInteractionOptions(["--report", "saved.json", "--cases", "tools/nope"]);
  expect(options.cases).toEqual(["tools/nope"]);
  expect(() => selectInteractionCases(options)).toThrow("Unknown case tools/nope; use --list");
  expect(() => selectInteractionCases(parseInteractionOptions(["--groups", "send", "--cases", "tools/short"]))).toThrow(
    "No cases selected (check --groups/--cases)",
  );
  expect(selectInteractionCases(parseInteractionOptions(["--cases", "tools/short,send/short"]))).toEqual([
    "send/short",
    "tools/short",
  ]);
});

test("saved-report mode keeps a nondefault budget unless --budget is explicit, even at the default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "interaction-options-report-"));
  try {
    const source = join(dir, "source.json");
    const saved = reportFixture();
    saved.budgetMs = 13;
    await Bun.write(source, JSON.stringify(saved));
    for (const explicit of [false, true]) {
      const out = join(dir, explicit ? "override" : "preserved");
      const proc = Bun.spawn(
        [
          process.execPath,
          resolve(import.meta.dir, "../scripts/terminal-interactions.ts"),
          "--report",
          source,
          "--out",
          out,
          // These selectors would fail measurement; report mode does not select fixtures.
          "--groups",
          "send",
          "--cases",
          "tools/nope",
          "--repetitions",
          "2",
          "--width",
          "24",
          "--height",
          "8",
          ...(explicit ? ["--budget", "8"] : []),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [exit, , stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(exit).toBe(0);
      const run = await Bun.file(join(out, "run.json")).json();
      expect(run.budgetMs).toBe(explicit ? 8 : 13);
      expect(run.config).toEqual(saved.config);
      expect(run.cases).toEqual(saved.cases);
    }
    expect(await Bun.file(source).json()).toEqual(saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
