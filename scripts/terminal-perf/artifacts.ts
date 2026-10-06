import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { dashboard } from "./dashboard.js";
import { chromeTrace } from "./trace.js";
import { summarizeCase, textReport, type PerfRun } from "./report.js";

export async function readRun(path: string): Promise<PerfRun> {
  const run = JSON.parse(await readFile(path, "utf8")) as PerfRun;
  if (
    run.schemaVersion !== 1 ||
    !Number.isFinite(run.budgetMs) ||
    run.budgetMs <= 0 ||
    !run.environment ||
    !run.config ||
    !Array.isArray(run.cases) ||
    !run.cases.length
  ) {
    throw new Error(`Not a terminal frame lab v1 run: ${path}`);
  }
  const ids = new Set<string>();
  for (const result of run.cases) {
    if (
      !result.id ||
      ids.has(result.id) ||
      !result.parameters ||
      !Array.isArray(result.cold) ||
      !Array.isArray(result.frames)
    ) {
      throw new Error(`Invalid workload in ${path}`);
    }
    ids.add(result.id);
    summarizeCase(result, run.budgetMs);
  }
  return run;
}
export async function writeArtifacts(run: PerfRun, out?: string, baseline?: PerfRun): Promise<string> {
  let directory: string;
  if (out) {
    directory = resolve(out);
    await mkdir(directory, { recursive: true });
  } else {
    const root = resolve(import.meta.dir, "../../artifacts/terminal-perf");
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, `${new Date().toISOString().replaceAll(":", "-")}-`));
  }
  await Promise.all([
    writeFile(join(directory, "run.json"), JSON.stringify(run, null, 2)),
    writeFile(join(directory, "report.txt"), textReport(run, baseline)),
    writeFile(join(directory, "index.html"), dashboard(run, baseline)),
    writeFile(join(directory, "trace.json"), JSON.stringify(chromeTrace(run))),
  ]);
  return directory;
}
