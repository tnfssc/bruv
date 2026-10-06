import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseInteractionOptions, type InteractionOptions } from "./terminal-perf/interaction-options";
import { normalizeInteraction } from "./terminal-perf/interaction-normalize";
import {
  interactionBudgetFailures,
  interactionTextReport,
  validateInteractionRun,
  type InteractionRun,
} from "./terminal-perf/interaction-report";
import { interactionDashboard } from "./terminal-perf/interaction-dashboard";
import { interactionCatalog } from "./terminal-perf/interaction-catalog";

const root = resolve(import.meta.dir, "..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
export function selectInteractionCases(o: InteractionOptions): string[] {
  for (const id of o.cases)
    if (!interactionCatalog.includes(id)) throw new Error("Unknown case " + id + "; use --list");
  const selected = interactionCatalog.filter(
    (id) =>
      o.groups.includes(id.split("/")[0] as InteractionOptions["groups"][number]) &&
      (!o.cases.length || o.cases.includes(id)),
  );
  if (!selected.length) throw new Error("No cases selected (check --groups/--cases)");
  return selected;
}
export async function interactionEnvironment(): Promise<Pick<InteractionRun, "environment" | "sources">> {
  const hashes: Record<string, string> = {};
  const paths = git("ls-files", "-z", "src", "scripts", "patches", "package.json", "bun.lock")
    .split("\0")
    .filter(Boolean);
  // Include the new harness before its first commit too; fingerprints are bytes, not just HEAD.
  for (const f of [
    "scripts/terminal-interactions.ts",
    ...["catalog", "options", "worker", "normalize", "report", "dashboard"].map(
      (s) => "scripts/terminal-perf/interaction-" + s + ".ts",
    ),
  ])
    if (!paths.includes(f)) paths.push(f);
  for (const name of ["pi-tui", "pi-coding-agent", "pi-ai", "pi-server"]) {
    const dir = "node_modules/@earendil-works/" + name + "/dist";
    for await (const file of new Bun.Glob("**/*.js").scan({ cwd: resolve(root, dir) })) paths.push(dir + "/" + file);
  }
  for (const f of paths.sort())
    hashes[f] = createHash("sha256")
      .update(await readFile(resolve(root, f)))
      .digest("hex");
  const dependencies: Record<string, string> = {};
  for (const name of ["pi-tui", "pi-coding-agent", "pi-ai", "pi-server"])
    dependencies[name] = JSON.parse(
      await readFile(resolve(root, "node_modules/@earendil-works", name, "package.json"), "utf8"),
    ).version;
  return {
    environment: {
      revision: git("rev-parse", "HEAD"),
      dirty: !!git("status", "--porcelain"),
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      dependencies,
    },
    sources: { hashes, fingerprint: createHash("sha256").update(JSON.stringify(hashes)).digest("hex") },
  };
}
async function loadReport(path: string): Promise<InteractionRun> {
  const file = Bun.file(path);
  if (file.size > 100 * 1024 * 1024) throw new Error("Report exceeds 100 MiB: " + path);
  return validateInteractionRun(await file.json());
}
export async function measureInteractions(o: InteractionOptions): Promise<InteractionRun> {
  const ids = selectInteractionCases(o),
    out = resolve(o.out);
  const run: InteractionRun = {
    schemaVersion: "terminal-interactions-v1",
    startedAt: new Date().toISOString(),
    budgetMs: o.budget,
    ...(await interactionEnvironment()),
    config: { repetitions: o.repetitions, width: o.width, height: o.height },
    cases: [],
    evidence: {},
    limits: [
      "Only selected fixture surfaces observed; no all-app latency claim.",
      "Fresh isolated process per case/repetition; action follows setup in that process. Init/cold samples are separate and included in the observed strict gate.",
      "SDK InteractiveMode seam is not actual Bruv extension startup. No real provider/network, regular-screen coverage or PTY/emulator paint.",
      "Tool mutations+drained frame share a turn but full contiguous boundary is missing; do not add them. Async continuations not fully observed.",
    ],
  };
  await mkdir(resolve(out, "raw"), { recursive: true });
  // Deliberately no Promise.all: adapters and performance probes are serial.
  for (const id of ids)
    for (let iteration = 0; iteration < o.repetitions; iteration++) {
      const key = "raw/" + id.replaceAll("/", "-") + "-" + iteration + ".json";
      const path = resolve(out, key);
      console.error("Measuring " + id + " repetition " + (iteration + 1));
      const proc = Bun.spawn(
        [
          process.execPath,
          resolve(root, "scripts/terminal-perf/interaction-worker.ts"),
          id,
          String(o.width),
          String(o.height),
          path,
        ],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
      );
      const timer = setTimeout(() => proc.kill(), 120000);
      let exit: number, stdout: string, stderr: string;
      try {
        [exit, stdout, stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
      } finally {
        clearTimeout(timer);
      }
      await Bun.write(path + ".log", stdout + stderr);
      if (exit !== 0) throw new Error(id + " child exited " + exit + ": " + stderr.slice(-4000));
      const raw = await Bun.file(path).json();
      run.evidence[key] = raw;
      for (const result of normalizeInteraction(id, raw, iteration, key)) {
        const previous = run.cases.find((c) => c.id === result.id);
        if (previous) previous.samples.push(...result.samples);
        else run.cases.push(result);
      }
      // A recoverable checkpoint; raw files survive even if the next case fails.
      await Bun.write(resolve(out, "partial.json"), JSON.stringify(run, null, 2));
    }
  return validateInteractionRun(run);
}
export async function runInteractionCli(args: string[]): Promise<number> {
  const o = parseInteractionOptions(args);
  if (o.help) {
    console.log(
      "Usage: bun run perf:interactions [--groups send,tools,navigation] [--cases ID,...] [--repetitions 1] [--budget 8] [--strict] [--width 100] [--height 32] [--out DIR] [--baseline run.json] [--report run.json] [--list]",
    );
    return 0;
  }
  if (o.list) {
    console.log(selectInteractionCases(o).join("\n"));
    return 0;
  }
  const baseline = o.baseline ? await loadReport(o.baseline) : undefined;
  const run = o.report ? await loadReport(o.report) : await measureInteractions(o);
  if (o.report && o.budgetExplicit) run.budgetMs = o.budget;
  await mkdir(resolve(o.out), { recursive: true });
  const text = interactionTextReport(run, baseline);
  await Bun.write(resolve(o.out, "run.json"), JSON.stringify(run, null, 2));
  await Bun.write(resolve(o.out, "report.txt"), text);
  await Bun.write(resolve(o.out, "index.html"), interactionDashboard(run, baseline));
  console.log(text);
  console.log("Dashboard: " + resolve(o.out, "index.html"));
  return o.strict && interactionBudgetFailures(run).length ? 1 : 0;
}
if (import.meta.main) {
  try {
    process.exitCode = await runInteractionCli(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  }
}
