import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflowPath = new URL("../.github/workflows/dependency-updates.yml", import.meta.url);
const source = await Bun.file(workflowPath).text();
const workflow = Bun.YAML.parse(source) as {
  on: { schedule: { cron: string }[]; workflow_dispatch: unknown };
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      if?: string;
      needs?: string;
      permissions?: Record<string, string>;
      steps: {
        uses?: string;
        run?: string;
        if?: string;
        with?: Record<string, unknown>;
        env?: Record<string, string>;
      }[];
    }
  >;
};

test("daily and manual updater replaces Dependabot with pinned actions and split credentials", async () => {
  expect(workflow.on.schedule).toEqual([{ cron: "0 6 * * *" }]);
  expect(workflow.on.workflow_dispatch).toBeDefined();
  expect(await Bun.file(new URL("../.github/dependabot.yml", import.meta.url)).exists()).toBe(false);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.validate.permissions).toBeUndefined();
  expect(workflow.jobs.publish.permissions).toEqual({ contents: "write", "pull-requests": "write", statuses: "write" });
  expect(source).not.toContain("secrets.");
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false);
    }
  }
  expect(workflow.jobs.validate.steps.some((step) => step.env?.GH_TOKEN)).toBe(false);
  expect(workflow.jobs.publish.steps.some((step) => step.run?.includes("bun "))).toBe(false);
});

test("publishes only changed successful candidates after shared CI and notices", () => {
  expect(workflow.jobs.publish.needs).toBe("validate");
  expect(workflow.jobs.publish.if).toBe("needs.validate.outputs.changed == 'true'");
  const runs = workflow.jobs.validate.steps.map((step) => step.run ?? "");
  const commit = runs.findIndex((run) => run.includes("git commit"));
  const checks = runs.indexOf("bun run ci");
  const notices = runs.findIndex((run) => run.includes("bun run generate:notices"));
  const bundle = runs.findIndex((run) => run.includes("git bundle create"));
  expect(commit).toBeGreaterThan(-1);
  expect(checks).toBeGreaterThan(commit);
  expect(notices).toBeGreaterThan(checks);
  expect(bundle).toBeGreaterThan(notices);
  expect(source).not.toContain("continue-on-error");
  expect(source).toContain("GITHUB_TOKEN-created PRs do not trigger ordinary PR CI");
  expect(source).toContain("git rev-parse FETCH_HEAD");
  expect(source).toContain("--force-with-lease=");
  expect(source).toContain("git reset --mixed HEAD");
  expect(source).toContain("Unexpected candidate file:");
  expect(source).toContain("git diff HEAD --exit-code");
  expect(source).toContain("retention-days: 7");
  expect(source).toContain("tail -c 1048576");
});

test("one fixed PR branch has exact-candidate validation linked on GitHub", () => {
  expect(source).toContain("branch=automation/daily-dependencies");
  expect(source).toContain("--state open --json number");
  expect(source).toContain('gh pr edit "$number"');
  expect(source).toContain("repos/$GITHUB_REPOSITORY/statuses/$SHA");
  expect(source).toContain("dependency-update/Linux validation");
});

const verification = workflow.jobs.publish.steps.find((step) => step.run?.includes("git bundle verify"))!;

test("downloaded candidate is verified without credentials before any remote writes", () => {
  const publish = workflow.jobs.publish.steps.find((step) => step.env?.GH_TOKEN)!;
  expect(verification.env).toEqual({
    BASE: `\${{ needs.validate.outputs.base }}`,
    SHA: `\${{ needs.validate.outputs.sha }}`,
  });
  expect(workflow.jobs.publish.steps.indexOf(verification)).toBeLessThan(workflow.jobs.publish.steps.indexOf(publish));
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

// Use real Git bundles and a base-only checkout, just like the publisher job.
test("candidate verification accepts dependency-only updates and rejects wrong identities or other files", async () => {
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

    await writeFile(join(repository, "package.json"), "updated declaration\n");
    await writeFile(join(repository, "bun.lock"), "updated lockfile\n");
    await git(repository, "commit", "-am", "dependency update");
    const sha = await git(repository, "rev-parse", "HEAD");
    const bundle = join(publisher, "candidate", "candidate.bundle");
    await git(repository, "bundle", "create", bundle, "HEAD", "^" + base);
    const verify = (BASE: string, SHA: string) =>
      command(publisher, ["/bin/bash", "-c", verification.run!], { BASE, SHA });
    expect((await verify(base, sha)).exitCode).toBe(0);
    expect((await verify(base, base)).exitCode).not.toBe(0);
    expect((await verify(sha, sha)).exitCode).not.toBe(0);

    await git(repository, "reset", "--hard", base);
    await writeFile(join(repository, "unexpected.txt"), "not a dependency update\n");
    await git(repository, "commit", "-am", "unrelated change");
    const unrelated = await git(repository, "rev-parse", "HEAD");
    await rm(bundle);
    await git(repository, "bundle", "create", bundle, "HEAD", "^" + base);
    const rejected = await verify(base, unrelated);
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stdout).toContain("Unexpected candidate file: unexpected.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
