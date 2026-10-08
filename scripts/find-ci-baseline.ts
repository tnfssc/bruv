import { spawnSync } from "node:child_process";

const shaPattern = /^[a-f0-9]{40}$/;
const workflowPath = ".github/workflows/ci.yml";
interface Run {
  id?: number;
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

// One page (100 runs), two API requests, 15s total budget. Unknown means full.
export async function findCiBaseline(
  repo: string,
  head: string,
  token: string,
  cwd = process.cwd(),
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !shaPattern.test(head) || !token) return;
  const deadline = Date.now() + 15_000;
  const git = (args: string[]) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("budget exhausted");
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8", timeout: Math.min(1_000, remaining) });
    if (result.error || result.status === null) throw new Error("git unavailable");
    return result;
  };
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
    const actualHead = git(["rev-parse", "HEAD"]);
    if (actualHead.status !== 0 || actualHead.stdout.trim() !== head) return;
    const base = `https://api.github.com/repos/${repo}/actions/workflows`;
    const workflow = await get(`${base}/ci.yml`);
    if (!Number.isSafeInteger(workflow.id) || workflow.id <= 0 || workflow.path !== workflowPath) return;
    const list = await get(`${base}/${workflow.id}/runs?event=push&branch=develop&status=success&per_page=100`);
    if (!Array.isArray(list.workflow_runs) || list.workflow_runs.length > 100) return;
    // GitHub returns newest runs first; older-than-page history falls back.
    for (const run of list.workflow_runs as Run[]) {
      if (
        !run ||
        !Number.isSafeInteger(run.id) ||
        (run.id ?? 0) <= 0 ||
        run.workflow_id !== workflow.id ||
        (run.path !== workflowPath && run.path !== `${repo}/${workflowPath}@refs/heads/develop`) ||
        run.event !== "push" ||
        run.head_branch !== "develop" ||
        run.status !== "completed" ||
        run.conclusion !== "success" ||
        run.repository?.full_name !== repo ||
        run.head_repository?.full_name !== repo ||
        !shaPattern.test(run.head_sha ?? "") ||
        run.head_sha === head
      )
        continue;
      const sha = run.head_sha as string;
      if (git(["cat-file", "-t", sha]).stdout.trim() !== "commit") continue;
      const ancestor = git(["merge-base", "--is-ancestor", sha, head]);
      if (ancestor.status === 0) return sha;
      if (ancestor.status !== 1) return;
    }
  } catch {
    // Never print exception bodies/URLs/headers: the API credential is private.
    return;
  }
}

if (import.meta.main) {
  const baseline = await findCiBaseline(
    process.env.GITHUB_REPOSITORY ?? "",
    process.env.GITHUB_SHA ?? "",
    process.env.GH_TOKEN ?? "",
  );
  if (baseline) process.stdout.write(baseline);
  else console.error("No trusted successful ancestor CI push baseline; full validation required.");
}
