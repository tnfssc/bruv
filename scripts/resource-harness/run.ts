import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCapturedSession } from "./capture";
import { type Budgets, supervise } from "./supervisor";

const MiB = 1024 * 1024;
export const profiles = {
  ci: {
    tasks: 8,
    updates: 128,
    childEntries: 1,
    budgets: { rssBytes: 384 * MiB, diskBytes: 8 * MiB, journalEntries: 8192, timeoutMs: 30_000 },
  },
  stress: {
    tasks: 50,
    updates: 2000,
    childEntries: 1,
    budgets: { rssBytes: 512 * MiB, diskBytes: 64 * MiB, journalEntries: 50_000, timeoutMs: 90_000 },
  },
} satisfies Record<string, { tasks: number; updates: number; childEntries: number; budgets: Budgets }>;

function options(args: string[]) {
  let profile: keyof typeof profiles = "ci";
  let out = resolve("artifacts/resource-harness");
  let session: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile" && (args[i + 1] === "ci" || args[i + 1] === "stress"))
      profile = args[++i] as keyof typeof profiles;
    else if (args[i] === "--out" && args[i + 1]) out = resolve(args[++i]);
    else if (args[i] === "--session" && args[i + 1]) session = resolve(args[++i]);
    else
      throw new Error(
        "Usage: bun run perf:resources [--profile ci|stress] [--out directory] [--session native-session.jsonl]",
      );
  }
  return { profile, out, session };
}

export async function runHarness(args: string[]) {
  const { profile, out, session } = options(args);
  if (session) return runCapturedSession({ source: session, out, budgets: profiles.stress.budgets });
  const config = profiles[profile];
  await mkdir(out, { recursive: true });
  const runDir = await mkdtemp(join(out, `${profile}-`));
  const fixture = join(runDir, "fixture");
  await mkdir(fixture);
  const workload = join(dirname(fileURLToPath(import.meta.url)), "workload.ts");
  const phases = [];
  for (const phase of ["write", "resume"]) {
    const result = await supervise({
      command: [
        process.execPath,
        workload,
        "--dir",
        fixture,
        "--tasks",
        String(config.tasks),
        "--updates",
        String(config.updates),
        "--child-entries",
        String(config.childEntries),
        "--phase",
        phase,
      ],
      dir: fixture,
      phase,
      budgets: config.budgets,
    });
    phases.push(result);
    console.log(
      phase +
        ": " +
        (result.passed ? "PASS" : "FAIL") +
        " | peak RSS " +
        (result.peakRssBytes / MiB).toFixed(1) +
        " MiB | disk " +
        (result.diskBytes / MiB).toFixed(2) +
        " MiB | entries " +
        result.journalEntries +
        " | " +
        Math.round(result.elapsedMs) +
        " ms",
    );
    for (const reason of result.violations) console.error(`  ${reason}`);
    // A killed write cannot serve as a complete resume fixture.
    if (!result.passed) break;
  }
  const passed = phases.length === 2 && phases.every((phase) => phase.passed);
  const report = {
    schemaVersion: 1,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dirname(workload), encoding: "utf8" }).trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: dirname(workload),
      encoding: "utf8",
    }).trim(),
    createdAt: new Date().toISOString(),
    profile,
    config,
    platform: process.platform,
    runtime: process.version,
    bunVersion: Bun.version,
    externalRssSampling: process.platform === "linux",
    passed,
    phases,
    skippedPhases: phases.length < 2 ? ["resume: write did not finish within budget"] : [],
  };
  const reportPath = join(runDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report and retained fixture: ${runDir}`);
  return { passed, reportPath, report };
}

if (import.meta.main) {
  try {
    process.exitCode = (await runHarness(process.argv.slice(2))).passed ? 0 : 1;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
