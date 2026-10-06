import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reportFixture } from "./fixtures/terminal-interaction-report";
const cli = resolve(import.meta.dir, "../scripts/terminal-interactions.ts");
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
    const source = join(dir, "source.json"),
      out = join(dir, "report");
    await Bun.write(source, JSON.stringify(reportFixture()));
    expect((await run("--report", source, "--baseline", source, "--strict", "--out", out)).exit).toBe(0);
    expect((await Bun.file(join(out, "run.json")).json()).budgetMs).toBe(8);
    const fail = await run("--report", source, "--budget", "7", "--strict", "--out", out);
    expect(fail.exit).toBe(1);
    expect(fail.stdout).toContain("OBSERVED CPU MISSES");
    expect((await run("--report", source, "--budget", "7", "--out", out)).exit).toBe(0);
    expect(await Bun.file(join(out, "index.html")).text()).toContain("Baseline comparison");
    await Bun.write(source, '{"schemaVersion":"bogus"}');
    expect((await run("--report", source, "--out", out)).exit).toBe(2);
    expect((await run("--cases", "bad", "--out", out)).exit).toBe(2);
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
    expect(Object.keys(report.evidence)).toHaveLength(8);
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
