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
type Job = {
  name?: string;
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
  outputs?: Record<string, string>;
};
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

test("routine CI triggers cannot filter changes or bypass required validation", () => {
  expect(ci.on.pull_request).toBeNull();
  expect(ci.on.push).toEqual({ branches: ["develop"] });
  expect(ci.on.workflow_dispatch).toBeNull();
  expect(ci.on.schedule).toEqual([{ cron: "17 3 * * *" }]);
  expect(ci.on.pull_request_target).toBeUndefined();
  expect(ci.permissions).toEqual({ contents: "read" });
  expect(ci.jobs.feedback!.if).toBeUndefined();
  expect(ci.jobs.feedback!.permissions).toEqual({ contents: "read", actions: "read" });
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
});

test("nightly and manual planning always request full reconciliation", () => {
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
    ["selected", "false", false],
    ["full", "true", false],
    ["", "", false],
  ] as const) {
    expect(enabled(run.if!, {}, {}, { plan: { outputs: { mode, full } } })).toBe(expected);
  }
});

// The required job accepts exactly these two complete plan/result tuples.
const acceptedOutcomes = [
  {
    name: "docs classifier only",
    env: { MODE: "docs", FULL: "false", FEEDBACK: "success", LINUX: "skipped", MACOS: "skipped" },
  },
  {
    name: "full executable validation",
    env: { MODE: "full", FULL: "true", FEEDBACK: "success", LINUX: "success", MACOS: "success" },
  },
];
const outcomeAlternatives = {
  MODE: ["docs", "full", "selected", "unknown", ""],
  FULL: ["true", "false", ""],
  FEEDBACK: ["failure", "cancelled", "skipped", ""],
  LINUX: ["success", "skipped", "failure", "cancelled", ""],
  MACOS: ["success", "skipped", "failure", "cancelled", ""],
};
const aggregate = step(ci.jobs.required!, "Require the planned validation outcomes");
test("CI policy consumes all authoritative plan and dependency outcomes", () => {
  expect(aggregate.env).toEqual({
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
    FEEDBACK: "${{ needs.feedback.result }}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
    MODE: "${{ needs.feedback.outputs.mode }}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
    FULL: "${{ needs.feedback.outputs.full }}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
    LINUX: "${{ needs.test.result }}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
    MACOS: "${{ needs.live-macos.result }}",
  });
});
test("CI policy rejects a wholly missing plan even when docs checks succeeded", () => {
  expect(
    shell(aggregate.run!, { MODE: "", FULL: "", FEEDBACK: "success", LINUX: "skipped", MACOS: "skipped" }).status,
  ).toBe(1);
});
for (const { name, env } of acceptedOutcomes) {
  test("CI policy accepts " + name, () => {
    expect(shell(aggregate.run!, env).status).toBe(0);
  });
  // Change one field at a time; no result is reset or inherited from another case.
  for (const field of Object.keys(outcomeAlternatives) as (keyof typeof outcomeAlternatives)[]) {
    for (const value of outcomeAlternatives[field]) {
      if (value === env[field]) continue;
      test("CI policy rejects " + name + " with " + field + "=" + JSON.stringify(value), () => {
        expect(shell(aggregate.run!, { ...env, [field]: value }).status).toBe(1);
      });
    }
  }
}

test("release triggers and dependencies route publication through source admission", () => {
  expect(release.on.push).toEqual({ tags: ["v*"] });
  expect(release.on.workflow_dispatch).toBeDefined();
  expect(release.on.pull_request).toBeUndefined();
  expect(Object.keys(release.jobs)).toEqual([
    "prepare-manual",
    "release-source",
    "mac-helper",
    "release",
    "linux-browser-boot",
    "mac-release-smoke",
    "publish",
  ]);
  expect(release.jobs["release-source"]!.needs).toBe("prepare-manual");
  expect(release.jobs["mac-helper"]!.needs).toBe("release-source");
  expect(release.jobs.release!.needs).toEqual(["release-source", "mac-helper"]);
  expect(release.jobs["linux-browser-boot"]!.needs).toEqual(["release", "release-source"]);
  expect(release.jobs["mac-release-smoke"]!.needs).toEqual(["release", "release-source"]);
  expect(release.jobs.publish!.needs).toEqual(["release", "linux-browser-boot", "mac-release-smoke", "release-source"]);
});

const releaseEvents = [
  { event: "push", ref: "refs/heads/develop", prepared: false, admitted: false },
  { event: "pull_request", ref: "refs/pull/1/merge", prepared: false, admitted: false },
  { event: "push", ref: "refs/tags/v1.0.0-beta.1", prepared: false, admitted: false },
  { event: "push", ref: "refs/tags/v1.0.0", prepared: false, admitted: true },
  { event: "workflow_dispatch", ref: "refs/heads/develop", prepared: true, admitted: true },
  { event: "workflow_dispatch", ref: "refs/heads/main", prepared: false, admitted: false },
];
for (const { event, ref, prepared, admitted } of releaseEvents) {
  test("release admission for " + event + " " + ref, () => {
    const github = { event_name: event, ref, ref_name: ref.split("/").at(-1)! };
    const needs = {
      "prepare-manual": { result: prepared ? "success" : "skipped" },
      "release-source": { result: admitted ? "success" : "skipped" },
      "mac-helper": { result: "success" },
      release: { result: "success" },
      "linux-browser-boot": { result: "success" },
      "mac-release-smoke": { result: "success" },
    };
    expect(enabled(release.jobs["prepare-manual"]!.if!, github, needs)).toBe(prepared);
    expect(enabled(release.jobs["release-source"]!.if!, github, needs)).toBe(admitted);
    for (const id of ["mac-helper", "release", "publish"])
      expect(enabled(release.jobs[id]!.if!, github, needs)).toBe(admitted);
  });
}

const unsuccessfulResults = ["failure", "cancelled", "skipped", ""];
for (const result of unsuccessfulResults) {
  test("manual release admission rejects preparation result " + JSON.stringify(result), () => {
    const github = { event_name: "workflow_dispatch", ref: "refs/heads/develop", ref_name: "develop" };
    expect(enabled(release.jobs["release-source"]!.if!, github, { "prepare-manual": { result } })).toBe(false);
  });
}

// Consumer gates depend on job outcomes, not on repeating the event admission expression.
const successfulReleaseNeeds = {
  "release-source": { result: "success" },
  "mac-helper": { result: "success" },
  release: { result: "success" },
  "linux-browser-boot": { result: "success" },
  "mac-release-smoke": { result: "success" },
};
const releaseFailureGates = [
  { dependency: "release-source", consumers: ["mac-helper", "release", "publish"] },
  { dependency: "mac-helper", consumers: ["release"] },
  { dependency: "release", consumers: ["linux-browser-boot", "mac-release-smoke", "publish"] },
  { dependency: "linux-browser-boot", consumers: ["publish"] },
  { dependency: "mac-release-smoke", consumers: ["publish"] },
];
for (const { dependency, consumers } of releaseFailureGates) {
  for (const result of unsuccessfulResults) {
    test("release consumers reject " + dependency + "=" + JSON.stringify(result), () => {
      const needs = { ...successfulReleaseNeeds, [dependency]: { result } };
      for (const id of consumers) expect(enabled(release.jobs[id]!.if!, {}, needs)).toBe(false);
    });
  }
}

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
    const commitFile = (path: string, content: string) => {
      writeFileSync(join(root, path), content);
      git("add", ".");
      git("commit", "-m", content);
      return git("rev-parse", "HEAD");
    };
    const initial = commitFile("initial", "initial");
    git("checkout", "-b", "feature");
    const head = commitFile("feature", "feature");
    git("checkout", "main");
    const target = commitFile("target", "target advanced");
    git("merge", "--no-ff", "feature", "-m", "tested merge");
    const merge = git("rev-parse", "HEAD");
    const command = step(ci.jobs.feedback!, "Resolve complete comparison").run!.replace(
      "bun scripts/find-ci-baseline.ts",
      JSON.stringify(process.execPath) + " " + JSON.stringify(join(process.cwd(), "scripts/find-ci-baseline.ts")),
    );
    const resolveBase = ({
      event,
      prHead = head,
      expectedHead = merge,
      before = initial,
    }: {
      event: string;
      prHead?: string;
      expectedHead?: string;
      before?: string;
    }) => {
      const output = join(root, "output");
      writeFileSync(output, "");
      expect(
        shell(
          command,
          {
            EVENT: event,
            PR_HEAD: prHead,
            EXPECTED_HEAD: expectedHead,
            // A push payload SHA is not authority to skip validation.
            BEFORE: before,
            GH_TOKEN: "",
            GITHUB_OUTPUT: output,
          },
          root,
        ).status,
      ).toBe(0);
      return readFileSync(output, "utf8");
    };
    expect(resolveBase({ event: "pull_request" })).toBe("base=" + target + "\n");
    expect(resolveBase({ event: "pull_request", prHead: initial })).toBe("base=\n");
    expect(resolveBase({ event: "pull_request", expectedHead: initial })).toBe("base=\n");
    expect(resolveBase({ event: "push" })).toBe("base=\n");
    expect(resolveBase({ event: "push", before: "0".repeat(40) })).toBe("base=\n");
    expect(resolveBase({ event: "schedule" })).toBe("base=\n");
    // A commit with valid parents but a tree unlike GitHub's actual merge must be full.
    const wrong = git("commit-tree", initial + "^{tree}", "-p", target, "-p", head, "-m", "wrong merge tree");
    git("checkout", "--detach", wrong);
    expect(resolveBase({ event: "pull_request", expectedHead: wrong })).toBe("base=\n");
    git("checkout", "--detach", head);
    expect(resolveBase({ event: "pull_request", expectedHead: head })).toBe("base=\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
