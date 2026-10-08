import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findReleaseCi } from "../scripts/find-release-ci";

const repo = "owner/bruv";
const path = ".github/workflows/ci.yml";
const cwd = mkdtempSync(join(tmpdir(), "release-ci-"));
let sha: string;
beforeAll(() => {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  git(["init", "-q"]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  ]);
  sha = git(["rev-parse", "HEAD"]);
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function evidence() {
  const run = {
    id: 123,
    run_attempt: 2,
    workflow_id: 42,
    path,
    event: "push",
    head_branch: "develop",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    repository: { full_name: repo },
    head_repository: { full_name: repo },
  };
  const names = [
    "Docs-only feedback (not executable validation)",
    "Full validation / Linux x64",
    "Full validation / Linux native audio (no hardware)",
    "Full validation / macOS Live (no devices or API)",
    "CI policy",
  ];
  const jobs = names.map((name) => ({
    name,
    run_id: run.id,
    run_attempt: run.run_attempt,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    steps: [
      {
        name:
          name === "CI policy"
            ? "Require the planned validation outcomes"
            : "Shared Linux CI gate (paired binaries, external T3)",
        status: "completed",
        conclusion: "success",
      },
    ],
  }));
  return { run, jobs, workflow: { id: 42, path } };
}
function api(fixture = evidence(), options: { incomplete?: boolean; fail?: boolean } = {}) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (options.fail) return new Response("private failure", { status: 403 });
    if (url.endsWith("/workflows/ci.yml")) return Response.json(fixture.workflow);
    if (url.includes("/workflows/42/runs?")) return Response.json({ workflow_runs: [fixture.run] });
    if (url.endsWith("/runs/123/attempts/2/jobs?per_page=100"))
      return Response.json({
        total_count: fixture.jobs.length + Number(Boolean(options.incomplete)),
        jobs: fixture.jobs,
      });
    throw new Error("Unexpected API URL");
  };
  return { requests, fetcher };
}

test("full exact-SHA same-repository push CI is reused from one pinned attempt", async () => {
  const a = api();
  expect(await findReleaseCi(repo, sha, "private-token", cwd, a.fetcher)).toEqual({ runId: 123, attempt: 2 });
  expect(a.requests).toHaveLength(3);
  expect(a.requests[1]!.url).toContain("head_sha=" + sha);
  expect(a.requests[2]!.url).toContain("/attempts/2/jobs");
  for (const request of a.requests) {
    expect(request.init?.signal).toBeDefined();
    expect(request.init?.headers).toEqual({
      Authorization: "Bearer private-token",
      Accept: "application/vnd.github+json",
    });
  }
});

for (const field of [
  "head_sha",
  "event",
  "head_branch",
  "path",
  "status",
  "conclusion",
  "workflow_id",
  "run_attempt",
] as const) {
  test("wrong run " + field + " falls back", async () => {
    const f = evidence();
    Object.assign(f.run, { [field]: field === "workflow_id" ? 99 : field === "run_attempt" ? 0 : "wrong" });
    expect(await findReleaseCi(repo, sha, "token", cwd, api(f).fetcher)).toBeUndefined();
  });
}
test("fork and wrong workflow provenance fall back", async () => {
  for (const mutate of [
    (f: ReturnType<typeof evidence>) => {
      f.run.head_repository.full_name = "fork/bruv";
    },
    (f: ReturnType<typeof evidence>) => {
      f.run.repository.full_name = "fork/bruv";
    },
    (f: ReturnType<typeof evidence>) => {
      f.workflow.path = ".github/workflows/release.yml";
    },
  ]) {
    const f = evidence();
    mutate(f);
    expect(await findReleaseCi(repo, sha, "token", cwd, api(f).fetcher)).toBeUndefined();
  }
});
for (const conclusion of ["skipped", "failure", "cancelled"]) {
  test(conclusion + " in any required lane cannot admit a release", async () => {
    for (let i = 0; i < evidence().jobs.length; i++) {
      const f = evidence();
      f.jobs[i]!.conclusion = conclusion;
      expect(await findReleaseCi(repo, sha, "token", cwd, api(f).fetcher)).toBeUndefined();
    }
  });
}
test("docs-only successful policy is not full CI", async () => {
  const f = evidence();
  f.jobs = f.jobs.filter((job) => job.name === "CI policy" || job.name.startsWith("Docs-only"));
  expect(await findReleaseCi(repo, sha, "token", cwd, api(f).fetcher)).toBeUndefined();
});
test("incomplete, duplicate, wrong-attempt or wrong-SHA job evidence falls back", async () => {
  for (const mutate of [
    (f: ReturnType<typeof evidence>) => {
      f.jobs.pop();
    },
    (f: ReturnType<typeof evidence>) => {
      f.jobs.push(f.jobs[0]!);
    },
    (f: ReturnType<typeof evidence>) => {
      f.jobs[1]!.run_attempt = 1;
    },
    (f: ReturnType<typeof evidence>) => {
      f.jobs[1]!.run_id = 99;
    },
    (f: ReturnType<typeof evidence>) => {
      f.jobs[1]!.head_sha = "a".repeat(40);
    },
    (f: ReturnType<typeof evidence>) => {
      f.jobs[1]!.steps[0]!.conclusion = "skipped";
    },
    (f: ReturnType<typeof evidence>) => {
      f.jobs[4]!.steps[0]!.conclusion = "failure";
    },
  ]) {
    const f = evidence();
    mutate(f);
    expect(await findReleaseCi(repo, sha, "token", cwd, api(f).fetcher)).toBeUndefined();
  }
  expect(await findReleaseCi(repo, sha, "token", cwd, api(evidence(), { incomplete: true }).fetcher)).toBeUndefined();
});
test("API failure, missing token and checkout mismatch are cache misses", async () => {
  expect(await findReleaseCi(repo, sha, "token", cwd, api(evidence(), { fail: true }).fetcher)).toBeUndefined();
  const a = api();
  expect(await findReleaseCi(repo, sha, "", cwd, a.fetcher)).toBeUndefined();
  expect(await findReleaseCi(repo, "a".repeat(40), "token", cwd, a.fetcher)).toBeUndefined();
  expect(a.requests).toHaveLength(0);
});
test("CLI uses prepared RELEASE_SHA rather than dispatch GITHUB_SHA and writes a fallback", async () => {
  const output = join(cwd, "output");
  const result = execFileSync(process.execPath, [resolve(import.meta.dir, "../scripts/find-release-ci.ts")], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: repo,
      RELEASE_SHA: sha,
      GITHUB_SHA: "b".repeat(40),
      GH_TOKEN: "",
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: "",
    },
  });
  expect(result).toContain("six-minute deadline");
  await expect(Bun.file(output).text()).resolves.toBe("reused=false\n");
});
