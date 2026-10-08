import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const workflowPath = ".github/workflows/ci.yml";
const linuxJobs = [1, 2, 3].map((shard) => `Full validation / Linux x64 (${shard}/3)`);
export const releaseCiJobNames: readonly string[] = [
  "Docs-only feedback (not executable validation)",
  ...linuxJobs,
  "Full validation / Linux native audio (no hardware)",
  "Full validation / macOS Live (no devices or API)",
  "CI policy",
] as const;
interface Run {
  id?: number;
  run_attempt?: number;
  workflow_id?: number;
  path?: string;
  event?: string;
  head_branch?: string;
  head_sha?: string;
  status?: string;
  conclusion?: string;
  repository?: { full_name?: string };
  head_repository?: { full_name?: string };
}
interface Job {
  name?: string;
  run_id?: number;
  run_attempt?: number;
  head_sha?: string;
  status?: string;
  conclusion?: string;
  steps?: { name?: string; status?: string; conclusion?: string }[];
}
export interface ReleaseCiEvidence {
  runId: number;
  attempt: number;
}
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

// Ancestor baselines classify docs; release admission needs the exact prepared
// SHA and successful executable lanes, not just a successful policy job.
export async function findReleaseCi(
  repo: string,
  sha: string,
  token: string,
  cwd = process.cwd(),
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<ReleaseCiEvidence | undefined> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(sha) || !token) return;
  const deadline = Date.now() + 15_000;
  const get = async (url: string) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("budget exhausted");
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(remaining),
    });
    if (!response.ok) throw new Error("API unavailable");
    return response.json();
  };
  try {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 1_000 });
    if (head.status !== 0 || head.stdout.trim() !== sha) return;
    const base = `https://api.github.com/repos/${repo}/actions`;
    const workflow = await get(`${base}/workflows/ci.yml`);
    if (!positiveInteger(workflow.id) || workflow.path !== workflowPath) return;
    const list = await get(
      base +
        "/workflows/" +
        workflow.id +
        "/runs?event=push&branch=develop&head_sha=" +
        sha +
        "&status=success&per_page=20",
    );
    if (!Array.isArray(list.workflow_runs) || list.workflow_runs.length > 20) return;
    let inspected = 0;
    for (const run of list.workflow_runs as Run[]) {
      if (
        !run ||
        !positiveInteger(run.id) ||
        !positiveInteger(run.run_attempt) ||
        run.workflow_id !== workflow.id ||
        (run.path !== workflowPath && run.path !== `${repo}/${workflowPath}@refs/heads/develop`) ||
        run.event !== "push" ||
        run.head_branch !== "develop" ||
        run.head_sha !== sha ||
        run.status !== "completed" ||
        run.conclusion !== "success" ||
        run.repository?.full_name !== repo ||
        run.head_repository?.full_name !== repo
      )
        continue;
      if (++inspected > 3) return;
      const result = await get(`${base}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
      if (!Array.isArray(result.jobs) || result.total_count !== result.jobs.length || result.jobs.length > 100) return;
      const jobs = result.jobs as Job[];
      const full = releaseCiJobNames.every((name) => {
        const matches = jobs.filter((job) => job?.name === name);
        const job = matches[0];
        return (
          matches.length === 1 &&
          job?.run_id === run.id &&
          job.run_attempt === run.run_attempt &&
          job.head_sha === sha &&
          job.status === "completed" &&
          job.conclusion === "success"
        );
      });
      const stepSucceeded = (jobName: string, stepName: string) => {
        const steps = jobs.find((job) => job?.name === jobName)?.steps;
        if (!Array.isArray(steps)) return false;
        const matches = steps.filter((step) => step?.name === stepName);
        return matches.length === 1 && matches[0]?.status === "completed" && matches[0].conclusion === "success";
      };
      if (
        full &&
        linuxJobs.every((name) => stepSucceeded(name, "Shared Linux CI gate (paired binaries, external T3)")) &&
        stepSucceeded("CI policy", "Require the planned validation outcomes")
      ) {
        return { runId: run.id, attempt: run.run_attempt };
      }
    }
  } catch {
    // API uncertainty is a cache miss. Never expose credentials/error bodies.
  }
}

if (import.meta.main) {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const evidence = await findReleaseCi(repo, process.env.RELEASE_SHA ?? "", process.env.GH_TOKEN ?? "");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reused=${Boolean(evidence)}\n`);
  const message = evidence
    ? "Reusing full exact-SHA CI: https://github.com/" +
      repo +
      "/actions/runs/" +
      evidence.runId +
      "/attempts/" +
      evidence.attempt +
      ".\n"
    : "No proven full exact-SHA CI; running the shared ordinary Linux gate (six-minute deadline).\n";
  console.log(message.trim());
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
}
