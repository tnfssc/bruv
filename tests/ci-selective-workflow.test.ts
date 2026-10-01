import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
  expect(ci.jobs.feedback!.name).toContain("not executable validation");
  for (const job of [ci.jobs.test!, ci.jobs["live-macos"]!]) {
    expect(job.name).toStartWith("Full validation /");
    expect(job.needs).toBe("feedback");
    expect(enabled(job.if!, {}, { feedback: { outputs: { full: "true" } } })).toBe(true);
    expect(enabled(job.if!, {}, { feedback: { outputs: { full: "false" } } })).toBe(false);
  }
  const root = mkdtempSync(join(tmpdir(), "bruv-reconcile-"));
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
  for (const s of job.steps) {
    expect(s.run ?? "").not.toContain("${{");
  }
  const run = step(job, "Run docs classifier checks");
  expect(run.run).toBe('bun scripts/ci-selective.ts --base "$BASE" --run');
  for (const [mode, full, expected] of [
    ["docs", "false", true],
    ["selected", "false", true],
    ["full", "true", false],
    ["", "", false],
  ] as const) {
    expect(enabled(run.if!, {}, {}, { plan: { outputs: { mode, full } } })).toBe(mode === "docs" && full === "false");
  }
});

test("aggregate rejects every failed, cancelled, skipped or inconsistent required outcome", () => {
  const command = ci.jobs.required!.steps[0]!.run!;
  const run = (mode: string, full: string, feedback: string, linux: string, macos: string) =>
    shell(command, { MODE: mode, FULL: full, FEEDBACK: feedback, LINUX: linux, MACOS: macos }).status;
  for (const mode of ["docs"]) expect(run(mode, "false", "success", "skipped", "skipped")).toBe(0);
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
    ["docs", ""],
    ["unknown", "false"],
  ])
    expect(run(mode!, full!, "success", "skipped", "skipped")).not.toBe(0);
});

test("only manual and stable tag releases package; all publication gates fail closed", () => {
  expect(release.on.push).toEqual({ tags: ["v*"] });
  expect(release.on.workflow_dispatch).toBeDefined();
  expect(release.on.pull_request).toBeUndefined();
  expect(Object.keys(release.jobs)).toEqual([
    "prepare-manual",
    "mac-helper",
    "release",
    "linux-browser-boot",
    "mac-release-smoke",
    "publish",
  ]);
  for (const [event, ref, allowed] of [
    ["push", "refs/heads/develop", false],
    ["pull_request", "refs/pull/1/merge", false],
    ["push", "refs/tags/v1.0.0-beta.1", false],
    ["push", "refs/tags/v1.0.0", true],
    ["workflow_dispatch", "refs/heads/develop", true],
    ["workflow_dispatch", "refs/heads/main", false],
  ] as const) {
    const github = { event_name: event, ref, ref_name: ref.split("/").at(-1)! };
    const prepared = event === "workflow_dispatch" && ref === "refs/heads/develop";
    const needs = {
      "prepare-manual": { result: prepared ? "success" : "skipped" },
      "mac-helper": { result: "success" },
      release: { result: "success" },
      "linux-browser-boot": { result: "success" },
      "mac-release-smoke": { result: "success" },
    };
    expect(enabled(release.jobs["prepare-manual"]!.if!, github, needs)).toBe(prepared);
    for (const id of ["mac-helper", "release", "publish"])
      expect(enabled(release.jobs[id]!.if!, github, needs)).toBe(allowed);
    if (!allowed) continue;
    for (const result of ["failure", "cancelled", "skipped"]) {
      for (const id of ["release", "linux-browser-boot", "mac-release-smoke"] as const) {
        needs[id].result = result;
        expect(enabled(release.jobs.publish!.if!, github, needs)).toBe(false);
        needs[id].result = "success";
      }
      needs["mac-helper"].result = result;
      expect(enabled(release.jobs.release!.if!, github, needs)).toBe(false);
      needs["mac-helper"].result = "success";
      if (prepared) {
        needs["prepare-manual"].result = result;
        for (const id of ["mac-helper", "release", "publish"])
          expect(enabled(release.jobs[id]!.if!, github, needs)).toBe(false);
        needs["prepare-manual"].result = "success";
      }
    }
  }
});

test("PR comparison keeps tested merge parent; missing trusted push baseline requires full", () => {
  const root = mkdtempSync(join(tmpdir(), "bruv-merge-plan-"));
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
    const command = step(ci.jobs.feedback!, "Resolve complete comparison").run!.replace(
      "bun scripts/find-ci-baseline.ts",
      JSON.stringify(process.execPath) + " " + JSON.stringify(join(process.cwd(), "scripts/find-ci-baseline.ts")),
    );
    const run = (event: string, prHead = head, expectedHead = merge, before = initial) => {
      const output = join(root, "output");
      writeFileSync(output, "");
      expect(
        shell(
          command,
          {
            EVENT: event,
            PR_HEAD: prHead,
            EXPECTED_HEAD: expectedHead,
            BEFORE: before,
            GH_TOKEN: "",
            GITHUB_OUTPUT: output,
          },
          root,
        ).status,
      ).toBe(0);
      return readFileSync(output, "utf8");
    };
    expect(run("pull_request")).toBe("base=" + target + "\n");
    expect(run("pull_request", initial)).toBe("base=\n");
    expect(run("pull_request", head, initial)).toBe("base=\n");
    expect(run("push")).toBe("base=\n");
    expect(run("push", head, merge, "0".repeat(40))).toBe("base=\n");
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
