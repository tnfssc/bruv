import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reportFixture } from "./fixtures/terminal-interaction-report";
const cli = resolve(import.meta.dir, "../../scripts/terminal-perf/terminal-interactions.ts");
async function run(...args: string[]) {
  const p = Bun.spawn([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { exit, stdout, stderr };
}
test("report mode preserves budget, compares baseline and strictly gates saved evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "interactions-report-"));
  try {
    const source = join(dir, "source.json");
    const baselineOut = join(dir, "baseline");
    const strictOut = join(dir, "strict");
    const permissiveOut = join(dir, "permissive");
    const invalidReportOut = join(dir, "invalid-report");
    const unknownCaseOut = join(dir, "unknown-case");
    await Bun.write(source, JSON.stringify(reportFixture()));

    const compared = await run("--report", source, "--baseline", source, "--strict", "--out", baselineOut);
    expect(compared.exit).toBe(0);
    expect((await Bun.file(join(baselineOut, "run.json")).json()).budgetMs).toBe(8);
    const html = await Bun.file(join(baselineOut, "index.html")).text();
    expect(html).toContain("Baseline comparison");
    const data = JSON.parse(html.match(/<script id="interaction-data" type="application\/json">(.*?)<\/script>/s)![1]);
    expect(data.comparison).not.toBeNull();
    expect(data.comparison.warnings).toEqual([]);
    expect(data.comparison.cases.map((c: { id: string }) => c.id)).toEqual(["tools/short/reveal"]);

    // The longest observed span is exactly 7 ms: strict means below, not at, the budget.
    const fail = await run("--report", source, "--budget", "7", "--strict", "--out", strictOut);
    expect(fail.exit).toBe(1);
    expect(fail.stdout).toContain("OBSERVED CPU MISSES");
    expect((await Bun.file(join(strictOut, "run.json")).json()).budgetMs).toBe(7);
    const permissive = await run("--report", source, "--budget", "7", "--out", permissiveOut);
    expect(permissive.exit).toBe(0);
    expect((await Bun.file(join(permissiveOut, "run.json")).json()).budgetMs).toBe(7);
    expect((await Bun.file(source).json()).budgetMs).toBe(8);

    await Bun.write(source, '{"schemaVersion":"bogus"}');
    expect((await run("--report", source, "--out", invalidReportOut)).exit).toBe(2);
    expect((await run("--cases", "bad", "--out", unknownCaseOut)).exit).toBe(2);
    for (const out of [invalidReportOut, unknownCaseOut])
      for (const name of ["run.json", "report.txt", "index.html"])
        expect(await Bun.file(join(out, name)).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);

test("real repeated serial cases preserve raw evidence and separate cold/init from actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "interactions-repeat-"));
  try {
    const result = await run(
      "--cases",
      "send/short,send/bruv-short,tools/short,navigation/search",
      "--repetitions",
      "2",
      "--out",
      dir,
    );
    expect(result.stderr).not.toContain("child exited");
    expect(result.exit).toBe(0);
    const report = await Bun.file(join(dir, "run.json")).json();
    expect(Object.keys(report.evidence)).toEqual([
      "raw/send-short-0.json",
      "raw/send-short-1.json",
      "raw/send-bruv-short-0.json",
      "raw/send-bruv-short-1.json",
      "raw/tools-short-0.json",
      "raw/tools-short-1.json",
      "raw/navigation-search-0.json",
      "raw/navigation-search-1.json",
    ]);
    expect(await Bun.file(join(dir, "partial.json")).json()).toEqual(report);
    for (const key of Object.keys(report.evidence)) {
      expect(await Bun.file(join(dir, key)).json()).toEqual(report.evidence[key]);
      expect(await Bun.file(join(dir, key + ".log")).exists()).toBe(true);
    }
    expect(report.cases.every((c: { samples: unknown[] }) => c.samples.length === 2)).toBe(true);
    expect(report.sources.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const send = report.evidence["raw/send-short-0.json"];
    expect(send.evidence.visibleAcknowledgment).toBe(true);
    expect(send.actionProfiler.spans.length).toBeGreaterThan(0);
    expect(send.frameProfiler.frames.length).toBeGreaterThan(0);
    expect(report.cases.find((c: { id: string }) => c.id === "send/short/init").samples[0].phase).toBe("init");
    expect(report.cases.find((c: { id: string }) => c.id === "tools/short/reveal").samples[0].boundary).toBe("missing");
    expect((await Bun.file(join(dir, "raw/send-bruv-short-1.json")).json()).evidence.journal).toBe("bruv-disk");
    expect(
      (await run("--report", join(dir, "run.json"), "--strict", "--budget", "0.000001", "--out", join(dir, "strict")))
        .exit,
    ).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);

test("strict saved-report mode cannot pass missing observations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "interactions-unmeasured-"));
  try {
    const source = join(dir, "source.json"),
      report = reportFixture();
    report.cases[0].samples[0].spans = [];
    report.cases[0].samples[0].frameMs = [];
    await Bun.write(source, JSON.stringify(report));
    const result = await run("--report", source, "--strict", "--out", dir);
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain("no observed synchronous timing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("worker failure keeps diagnostics and the preceding checkpoint without publishing a report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "interactions-worker-failure-"));
  try {
    // Let the first case succeed, then prevent the second worker from writing its evidence.
    const blocked = join(dir, "raw/tools-short-0.json");
    await mkdir(blocked, { recursive: true });
    const result = await run("--cases", "send/short,tools/short", "--out", dir);
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain("tools/short child exited 2");
    const log = await Bun.file(blocked + ".log").text();
    expect(log).toContain("EISDIR");
    expect(result.stderr).toContain(log.trim());
    const partial = await Bun.file(join(dir, "partial.json")).json();
    expect(Object.keys(partial.evidence)).toEqual(["raw/send-short-0.json"]);
    expect(partial.cases.every((c: { id: string }) => c.id.startsWith("send/short/"))).toBe(true);
    expect(await Bun.file(join(dir, "raw/send-short-0.json")).json()).toEqual(
      partial.evidence["raw/send-short-0.json"],
    );
    for (const name of ["run.json", "report.txt", "index.html"])
      expect(await Bun.file(join(dir, name)).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
