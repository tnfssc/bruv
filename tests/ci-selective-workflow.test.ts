import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { findDryRun } from "../scripts/find-release-dry-run";

type Step = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = { name?: string; if?: string; needs?: string | string[]; steps: Step[]; outputs?: Record<string, string> };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> };
const load = (name: string) =>
  Bun.YAML.parse(readFileSync(new URL("../.github/workflows/" + name + ".yml", import.meta.url), "utf8")) as Workflow;
const ci = load("ci");
const release = load("release");
const step = (job: Job, name: string) => job.steps.find((s) => s.name === name)!;
function enabled(
  expression: string,
  github: Record<string, string>,
  needs: Record<string, unknown> = {},
  steps: Record<string, unknown> = {},
) {
  return new Function(
    "github",
    "needs",
    "steps",
    "always",
    "startsWith",
    "contains",
    "return " + expression.slice(3, -3).replace(/needs\.([\w-]+)/g, 'needs["$1"]'),
  )(
    github,
    needs,
    steps,
    () => true,
    (s: string, prefix: string) => s.startsWith(prefix),
    (s: string, part: string) => s.includes(part),
  );
}
const shell = (command: string, env: Record<string, string>, cwd?: string) =>
  spawnSync("bash", ["-euo", "pipefail", "-c", command], { cwd, env: { ...process.env, ...env }, encoding: "utf8" });

test("unconditional routine checks, nightly and manual full reconciliation", () => {
  expect(ci.on.pull_request).toBeDefined();
  expect(ci.on.push).toEqual({ branches: ["develop"] });
  expect(ci.on.workflow_dispatch).toBeDefined();
  expect(ci.on.schedule).toEqual([{ cron: "17 3 * * *" }]);
  expect(ci.on.pull_request_target).toBeUndefined();
  expect(ci.permissions).toEqual({ contents: "read" });
  expect(ci.jobs.feedback!.if).toBeUndefined();
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
  expect(ci.jobs.required!.if).toBe("${{ always() }}");
  expect(ci.jobs.required!.needs).toEqual(["feedback", "test", "live-macos"]);
  expect(ci.jobs.feedback!.name).toContain("not full validation");
  for (const job of [ci.jobs.test!, ci.jobs["live-macos"]!]) {
    expect(job.name).toStartWith("Full validation /");
    expect(job.needs).toBe("feedback");
    expect(enabled(job.if!, {}, { feedback: { outputs: { full: "true" } } })).toBe(true);
    expect(enabled(job.if!, {}, { feedback: { outputs: { full: "false" } } })).toBe(false);
  }
  const root = mkdtempSync(join(tmpdir(), "die-reconcile-"));
  try {
    for (const event of ["schedule", "workflow_dispatch"]) {
      const output = join(root, event);
      expect(
        shell(step(ci.jobs.feedback!, "Plan validation").run!, {
          EVENT: event,
          BASE: "",
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: join(root, "summary"),
        }).status,
      ).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("mode=full\nfull=true\n");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fast feedback plans and executes in one Bun-only job without full provisioning", () => {
  const job = ci.jobs.feedback!;
  const text = JSON.stringify(job);
  expect(job.needs).toBeUndefined();
  expect(text).not.toMatch(/setup-node|pnpm|tmux|actions\/cache|bun run build|bun run ci/);
  expect(job.steps.filter((s) => s.uses).map((s) => s.uses!.split("@")[0])).toEqual([
    "actions/checkout",
    "oven-sh/setup-bun",
  ]);
  expect(job.steps[0]!.with).toEqual({ "fetch-depth": 0, "persist-credentials": false });
  for (const s of [...job.steps, ...release.jobs.plan!.steps]) {
    expect(s.run ?? "").not.toContain("${{");
  }
  const run = step(job, "Run selected checks from clean source");
  expect(run.run).toBe('bun scripts/ci-selective.ts --base "$BASE" --run');
  for (const [mode, full, expected] of [
    ["docs", "false", true],
    ["selected", "false", true],
    ["full", "true", false],
    ["", "", false],
  ] as const) {
    expect(enabled(run.if!, {}, {}, { plan: { outputs: { mode, full } } })).toBe(expected);
  }
});

test("aggregate rejects every failed, cancelled, skipped or inconsistent required outcome", () => {
  const command = ci.jobs.required!.steps[0]!.run!;
  const run = (mode: string, full: string, feedback: string, linux: string, macos: string) =>
    shell(command, { MODE: mode, FULL: full, FEEDBACK: feedback, LINUX: linux, MACOS: macos }).status;
  for (const mode of ["docs", "selected"]) expect(run(mode, "false", "success", "skipped", "skipped")).toBe(0);
  expect(run("full", "true", "success", "success", "success")).toBe(0);
  for (const bad of ["skipped", "failure", "cancelled", ""]) {
    expect(run("selected", "false", bad, "skipped", "skipped")).not.toBe(0);
    expect(run("full", "true", bad, "success", "success")).not.toBe(0);
    expect(run("full", "true", "success", bad, "success")).not.toBe(0);
    expect(run("full", "true", "success", "success", bad)).not.toBe(0);
  }
  for (const [mode, full] of [
    ["", ""],
    ["docs", "true"],
    ["full", "false"],
    ["selected", ""],
    ["unknown", "false"],
  ])
    expect(run(mode!, full!, "success", "skipped", "skipped")).not.toBe(0);
});

test("develop narrow plans never build/reuse/publish; manual and tags retain real gates", () => {
  for (const mode of ["false", "true", ""]) {
    for (const result of ["success", "skipped", "failure", "cancelled"]) {
      const needs = {
        plan: { result, outputs: { full: mode } },
        "prepare-manual": { result: "skipped" },
        "reuse-check": { result: "skipped", outputs: { run_id: "" } },
        "mac-helper": { result: "success" },
      };
      const github = { event_name: "push", ref: "refs/heads/develop", ref_name: "develop" };
      for (const id of ["release", "mac-helper"]) {
        expect(release.jobs[id]!.needs).toContain("plan");
        expect(enabled(release.jobs[id]!.if!, github, needs)).toBe(mode === "true" && result === "success");
      }
      expect(enabled(release.jobs["reuse-check"]!.if!, github, needs)).toBe(false);
      expect(enabled(release.jobs.publish!.if!, github, needs)).toBe(false);
    }
  }
  for (const event of ["workflow_dispatch", "push"]) {
    const github = {
      event_name: event,
      ref: event === "push" ? "refs/tags/v1.0.0" : "refs/heads/develop",
      ref_name: event === "push" ? "v1.0.0" : "develop",
    };
    const needs = {
      plan: { result: "skipped", outputs: {} },
      "prepare-manual": { result: event === "push" ? "skipped" : "success" },
      "reuse-check": { result: "success", outputs: { run_id: "" } },
      "mac-helper": { result: "success" },
      release: { result: "success" },
      "reuse-assets": { result: "skipped" },
      "linux-browser-boot": { result: "success" },
      "mac-release-smoke": { result: "success" },
    };
    expect(enabled(release.jobs.plan!.if!, github, needs)).toBe(false);
    for (const id of ["release", "mac-helper", "publish"])
      expect(enabled(release.jobs[id]!.if!, github, needs)).toBe(true);
    needs["linux-browser-boot"].result = "skipped";
    expect(enabled(release.jobs.publish!.if!, github, needs)).toBe(false);
    needs["linux-browser-boot"].result = "success";
    needs["mac-release-smoke"].result = "failure";
    expect(enabled(release.jobs.publish!.if!, github, needs)).toBe(false);
  }
});

test("PR comparison uses validated tested merge parent; push preserves the complete before SHA", () => {
  const root = mkdtempSync(join(tmpdir(), "die-merge-plan-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  try {
    git("init", "-b", "main");
    git("config", "user.email", "ci@example.com");
    git("config", "user.name", "CI");
    writeFileSync(join(root, "initial"), "initial");
    git("add", ".");
    git("commit", "-m", "initial");
    const initial = git("rev-parse", "HEAD");
    git("checkout", "-b", "feature");
    writeFileSync(join(root, "feature"), "feature");
    git("add", ".");
    git("commit", "-m", "feature");
    const head = git("rev-parse", "HEAD");
    git("checkout", "main");
    writeFileSync(join(root, "target"), "target advanced");
    git("add", ".");
    git("commit", "-m", "advance target");
    const target = git("rev-parse", "HEAD");
    git("merge", "--no-ff", "feature", "-m", "tested merge");
    const merge = git("rev-parse", "HEAD");
    const command = step(ci.jobs.feedback!, "Resolve complete comparison").run!;
    const run = (event: string, prHead = head, expectedHead = merge, before = initial) => {
      const output = join(root, "output");
      writeFileSync(output, "");
      expect(
        shell(
          command,
          { EVENT: event, PR_HEAD: prHead, EXPECTED_HEAD: expectedHead, BEFORE: before, GITHUB_OUTPUT: output },
          root,
        ).status,
      ).toBe(0);
      return readFileSync(output, "utf8");
    };
    expect(run("pull_request")).toBe("base=" + target + "\n");
    expect(run("pull_request", initial)).toBe("base=\n");
    expect(run("pull_request", head, initial)).toBe("base=\n");
    expect(run("push")).toBe("base=" + initial + "\n");
    expect(run("push", head, merge, "0".repeat(40))).toBe("base=" + "0".repeat(40) + "\n");
    expect(run("schedule")).toBe("base=\n");
    // A commit with valid parents but a tree unlike GitHub's actual merge must be full.
    const wrong = git("commit-tree", initial + "^{tree}", "-p", target, "-p", head, "-m", "wrong merge tree");
    git("checkout", "--detach", wrong);
    expect(run("pull_request", head, wrong)).toBe("base=\n");
    git("checkout", "--detach", head);
    expect(run("pull_request", head, head)).toBe("base=\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a green narrow develop release workflow with no assets cannot be reused", async () => {
  const sha = "a".repeat(40);
  const repo = "example/die";
  const responses = [
    { id: 10, path: ".github/workflows/release.yml" },
    {
      workflow_runs: [
        {
          id: 20,
          workflow_id: 10,
          path: ".github/workflows/release.yml",
          event: "push",
          head_branch: "develop",
          head_sha: sha,
          status: "completed",
          conclusion: "success",
          repository: { full_name: repo },
          head_repository: { full_name: repo },
        },
      ],
    },
    { total_count: 0, artifacts: [] },
  ];
  let calls = 0;
  const fetcher = (async () => Response.json(responses[calls++])) as typeof fetch;
  expect(await findDryRun(repo, sha, "read-only-test-token", fetcher)).toBeUndefined();
  expect(calls).toBe(3);
});
