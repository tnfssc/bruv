import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PerfRun } from "../scripts/terminal-perf/report.js";
import { createTerminalPerfProcessFixture } from "./helpers/terminal-perf-process";

test("terminal frame lab runs real frames, writes all artifacts and compares saved results", async () => {
  const fixture = await createTerminalPerfProcessFixture();
  const directory = fixture.root;
  const cli = (args: string[]) => fixture.run([resolve(import.meta.dir, "../scripts/terminal-perf.ts"), ...args]);
  const listing = await cli(["--list", "--scales", "8"]);
  expect(listing.exitCode).toBe(0);
  expect(listing.stdout).toContain("long-thread/input/8");
  const output = join(directory, "run");
  const result = await cli([
    "--case",
    "input",
    "--scales",
    "8",
    "--width",
    "60",
    "--height",
    "16",
    "--samples",
    "2",
    "--warmup",
    "0",
    "--budget",
    "0.000000001",
    "--strict",
    "--out",
    output,
  ]);
  expect(result.stderr).not.toContain("Terminal frame lab:");
  expect(result.exitCode).toBe(1); // Deliberately impossible budget, not an assertion about machine speed.
  expect(result.stdout).toContain("OVER BUDGET");
  const run = JSON.parse(await readFile(join(output, "run.json"), "utf8")) as PerfRun;
  expect(run.schemaVersion).toBe(1);
  expect(run.cases).toHaveLength(1);
  expect(run.cases[0]!.cold).toHaveLength(1);
  expect(run.cases[0]!.cold[0]!.work!.documentRenders).toBeGreaterThan(0);
  expect(run.cases[0]!.cold[0]!.screenHash).toBeString();
  expect(run.cases[0]!.cold[0]!.outputHash).toBeString();
  expect(run.cases[0]!.frames).toHaveLength(2);
  for (const frame of run.cases[0]!.frames) {
    expect(frame.changed).toBe(true);
    expect(frame.writes).toBeGreaterThan(0);
    expect(frame.work!.componentRenders).toBeGreaterThan(0);
    expect(frame.phases.inlineLayoutDiffAndOther).toBeGreaterThanOrEqual(0);
  }
  expect(await readFile(join(output, "index.html"), "utf8")).toContain("Every frame counts.");
  const trace = JSON.parse(await readFile(join(output, "trace.json"), "utf8"));
  expect(trace.traceEvents.filter((event: { ph: string }) => event.ph === "X")).toHaveLength(3);
  const report = await cli([
    "--report",
    join(output, "run.json"),
    "--baseline",
    join(output, "run.json"),
    "--out",
    join(directory, "comparison"),
  ]);
  expect(report.exitCode).toBe(0);
  const newBudget = await cli([
    "--report",
    join(output, "run.json"),
    "--strict",
    "--budget",
    "1000000",
    "--out",
    join(directory, "new-budget"),
  ]);
  expect(newBudget.exitCode).toBe(0);
  expect(newBudget.stdout).toContain("< 1000000 ms");

  expect(report.stdout).toContain("p95 0.000");
  const badCase = await cli(["--case", "does-not-exist", "--scales", "8"]);
  expect(badCase.exitCode).toBe(2);
  expect(badCase.stderr).toContain("No workloads match");
}, 30_000);
