import { constants } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceProvenance } from "./provenance";
import { type Budgets, supervise } from "./supervisor";

/** Requires a stopped writer. Clone existing history with CoW, not a live task or a byte-by-byte giant copy. */
export async function snapshotSession(source: string, destination: string) {
  const before = await stat(source);
  if (!before.isFile()) throw new Error("Session source must be a regular file");
  await copyFile(source, destination, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL);
  await chmod(destination, 0o600);
  const after = await stat(source);
  const captured = await stat(destination);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || captured.size !== before.size)
    throw new Error("Source changed during snapshot; stop its writer before capturing");
  return { sizeBytes: captured.size, sourceModifiedAt: before.mtime.toISOString() };
}

export async function runCapturedSession(options: { source: string; out: string; budgets: Budgets }) {
  await mkdir(options.out, { recursive: true });
  const runDir = await mkdtemp(join(options.out, "captured-"));
  const fixture = join(runDir, "fixture");
  await mkdir(fixture, { mode: 0o700 });
  const snapshot = join(fixture, "session.jsonl");
  const capture = await snapshotSession(options.source, snapshot);
  console.log(`Captured ${capture.sizeBytes} bytes with a copy-on-write snapshot. Original left alone.`);
  // Historical data is input, not new disk growth. Count it, but limit new writes separately.
  const budgets = { ...options.budgets, journalEntries: Number.MAX_SAFE_INTEGER };
  const phase = await supervise({
    command: [process.execPath, join(dirname(fileURLToPath(import.meta.url)), "replay.ts"), snapshot],
    dir: fixture,
    phase: "replay",
    budgets,
    baselineDiskBytes: capture.sizeBytes,
  });
  const report = {
    schemaVersion: 1,
    ...sourceProvenance(),
    createdAt: new Date().toISOString(),
    profile: "captured",
    source: options.source,
    capture,
    budgets,
    entryBudgetApplied: false,
    externalRssSampling: process.platform === "linux",
    platform: process.platform,
    bunVersion: Bun.version,
    runtime: process.version,
    passed: phase.passed,
    phases: [phase],
  };
  const reportPath = join(runDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `Replay: ${phase.passed ? "PASS" : "FAIL"} | peak RSS ${(phase.peakRssBytes / 1024 / 1024).toFixed(1)} MiB | ${Math.round(phase.elapsedMs)} ms`,
  );
  for (const reason of phase.violations) console.error(`  ${reason}`);
  console.log(`Private report and snapshot: ${runDir}`);
  return { passed: phase.passed, reportPath, report };
}
