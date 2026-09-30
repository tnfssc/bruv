import { expect, test } from "bun:test";

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
  expect(workflow.jobs.publish.permissions).toEqual({ contents: "write", "pull-requests": "write" });
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
