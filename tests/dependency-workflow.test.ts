import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type WorkflowJob = {
  if?: string;
  needs?: string;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
};

const source = await Bun.file(new URL("../.github/workflows/dependency-updates.yml", import.meta.url)).text();
const workflow = Bun.YAML.parse(source) as {
  on: { schedule: { cron: string }[]; workflow_dispatch: unknown };
  permissions: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
};
const validation = workflow.jobs.validate;
const publication = workflow.jobs.publish;

function stepNamed(job: WorkflowJob, name: string) {
  const step = job.steps.find((step) => step.name === name);
  expect(step, `Missing workflow step: ${name}`).toBeDefined();
  return step!;
}

test("dependency updates run daily and manually instead of Dependabot", async () => {
  expect(workflow.on.schedule).toEqual([{ cron: "0 6 * * *" }]);
  expect(workflow.on.workflow_dispatch).toBeDefined();
  expect(await Bun.file(new URL("../.github/dependabot.yml", import.meta.url)).exists()).toBe(false);
});

test("only publication has write permissions and validation never receives its token", () => {
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(validation.permissions).toBeUndefined();
  expect(publication.permissions).toEqual({ contents: "write", "pull-requests": "write", statuses: "write" });
  expect(source).not.toContain("secrets.");
  expect(validation.steps.some((step) => step.env?.GH_TOKEN)).toBe(false);
  expect(publication.steps.some((step) => step.run?.includes("bun "))).toBe(false);
});

test("all actions are pinned and checkouts do not persist credentials", () => {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false);
    }
  }
});

test("the exact candidate is committed, checked, and notice-clean before packaging", () => {
  expect(publication.needs).toBe("validate");
  expect(publication.if).toBe("needs.validate.outputs.changed == 'true'");
  const commit = stepNamed(validation, "Commit candidate before validation");
  const checks = stepNamed(validation, "Validate actual candidate with shared Linux CI");
  const notices = stepNamed(validation, "Generate third-party notices from candidate");
  const bundle = stepNamed(validation, "Package validated commit and review body");
  expect(validation.steps.indexOf(checks)).toBeGreaterThan(validation.steps.indexOf(commit));
  expect(validation.steps.indexOf(notices)).toBeGreaterThan(validation.steps.indexOf(checks));
  expect(validation.steps.indexOf(bundle)).toBeGreaterThan(validation.steps.indexOf(notices));
  expect(commit.run).toContain("git reset --mixed HEAD");
  expect(commit.run).toContain("git commit");
  expect(checks.run).toBe("bun run ci");
  expect(notices.run).toContain("bun run generate:notices");
  expect(notices.run).toContain("git diff HEAD --exit-code");
  expect(bundle.run).toContain("git bundle create");
  expect(bundle.run).toContain("GITHUB_TOKEN-created PRs do not trigger ordinary PR CI");
  expect(source).not.toContain("continue-on-error");
});

test("recovery logs are bounded and candidate artifacts expire after seven days", () => {
  expect(stepNamed(validation, "Save bounded recovery patch and logs").run).toContain("tail -c 1048576");
  const upload = validation.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  expect(upload?.with?.["retention-days"]).toBe(7);
});

test("one fixed PR branch has exact-candidate validation linked on GitHub", () => {
  const publish = stepNamed(publication, "Publish one bot branch and PR against develop");
  expect(publish.run).toContain("branch=automation/daily-dependencies");
  expect(publish.run).toContain("--state open --json number");
  expect(publish.run).toContain('gh pr edit "$number"');
  expect(publish.run).toContain("repos/$GITHUB_REPOSITORY/statuses/$SHA");
  expect(publish.run).toContain("dependency-update/Linux validation");
  expect(publish.run).toContain("--force-with-lease=");
});

test("downloaded candidate is verified without credentials before any remote writes", () => {
  const verification = stepNamed(publication, "Verify downloaded candidate identity and allowed files");
  const publish = stepNamed(publication, "Publish one bot branch and PR against develop");
  expect(verification.env).toEqual({
    BASE: `\${{ needs.validate.outputs.base }}`,
    SHA: `\${{ needs.validate.outputs.sha }}`,
  });
  expect(publish.env?.GH_TOKEN).toBe(`\${{ github.token }}`);
  expect(publication.steps.indexOf(verification)).toBeLessThan(publication.steps.indexOf(publish));
  expect(verification.run).toContain("git bundle verify");
  expect(verification.run).toContain("git rev-parse FETCH_HEAD");
  expect(verification.run).toContain("Unexpected candidate file:");
  expect(verification.run).not.toContain("gh ");
  expect(verification.run).not.toContain("git push");
  expect(publish.run).not.toContain("git bundle");
  const freshness = publish.run!.indexOf('[[ "$current" == "$BASE" ]]');
  expect(freshness).toBeGreaterThan(-1);
  expect(freshness).toBeLessThan(publish.run!.indexOf("git push"));
});

async function command(cwd: string, args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(args, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

type Candidate = {
  base: string;
  sha: string;
  verify: (base: string, sha: string) => ReturnType<typeof command>;
};

// Each case gets one real bundle and a fresh base-only publisher checkout.
async function withCandidate(changedFiles: string[], check: (candidate: Candidate) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "bruv-dependency-workflow-"));
  const repository = join(root, "source");
  const publisher = join(root, "publisher");
  try {
    await mkdir(repository);
    await mkdir(join(publisher, "candidate"), { recursive: true });
    const git = async (cwd: string, ...args: string[]) => {
      const result = await command(cwd, ["git", ...args]);
      expect(result.exitCode, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    await git(repository, "init");
    await git(repository, "config", "user.name", "Workflow test");
    await git(repository, "config", "user.email", "workflow@example.invalid");
    for (const file of ["package.json", "bun.lock", "unexpected.txt"]) {
      await writeFile(join(repository, file), "base\n");
    }
    await git(repository, "add", ".");
    await git(repository, "commit", "-m", "base");
    const base = await git(repository, "rev-parse", "HEAD");
    await git(publisher, "init");
    await git(publisher, "fetch", "--depth=1", repository, base);
    await git(publisher, "checkout", "FETCH_HEAD");

    for (const file of changedFiles) {
      await writeFile(join(repository, file), "updated\n");
    }
    await git(repository, "commit", "-am", "candidate");
    const sha = await git(repository, "rev-parse", "HEAD");
    await git(repository, "bundle", "create", join(publisher, "candidate", "candidate.bundle"), "HEAD", "^" + base);
    const script = stepNamed(publication, "Verify downloaded candidate identity and allowed files").run!;
    await check({
      base,
      sha,
      verify: (BASE, SHA) => command(publisher, ["/bin/bash", "-c", script], { BASE, SHA }),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("candidate verification accepts a dependency-only bundle", async () => {
  await withCandidate(["package.json", "bun.lock"], async ({ base, sha, verify }) => {
    const result = await verify(base, sha);
    expect(result.exitCode, result.stderr).toBe(0);
  });
});

test("candidate verification rejects the base commit presented as the candidate SHA", async () => {
  await withCandidate(["package.json", "bun.lock"], async ({ base, verify }) => {
    expect((await verify(base, base)).exitCode).not.toBe(0);
  });
});

test("candidate verification rejects a commit whose parent is not the validated base", async () => {
  await withCandidate(["package.json", "bun.lock"], async ({ sha, verify }) => {
    expect((await verify(sha, sha)).exitCode).not.toBe(0);
  });
});

test("candidate verification rejects unrelated files even when both commit identities match", async () => {
  await withCandidate(["unexpected.txt"], async ({ base, sha, verify }) => {
    const result = await verify(base, sha);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("Unexpected candidate file: unexpected.txt");
  });
});
