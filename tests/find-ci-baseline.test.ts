import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCiBaseline } from "../scripts/find-ci-baseline";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "ci-baseline-"));
  dirs.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  writeFileSync(join(cwd, ".gitignore"), "artifacts/\n");
  git("config", "user.email", "test@example.org");
  git("config", "user.name", "Test");
  const commit = (path: string, text: string) => {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), text);
    git("add", ".");
    git("commit", "-qm", text);
    return git("rev-parse", "HEAD");
  };
  const good = commit("README.md", "initial");
  const source = commit("src/core.ts", "unchecked source");
  const head = commit("README.md", "docs only");
  return { cwd, git, commit, good, source, head };
}
const repo = "owner/project";
function run(sha: string, overrides = {}) {
  return {
    id: 1,
    workflow_id: 7,
    path: ".github/workflows/ci.yml",
    event: "push",
    head_branch: "develop",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    repository: { full_name: repo },
    head_repository: { full_name: repo },
    ...overrides,
  };
}
function api(runs: unknown[], workflow = { id: 7, path: ".github/workflows/ci.yml" }) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return Response.json(url.endsWith("/ci.yml") ? workflow : { workflow_runs: runs });
  };
  return { urls, fetcher };
}
for (const conclusion of ["failure", "cancelled"]) {
  test("later docs push retains source from earlier " + conclusion + " push", async () => {
    const f = fixture();
    const mock = api([run(f.head), run(f.source, { conclusion }), run(f.good)]);
    const baseline = await findCiBaseline(repo, f.head, "private", f.cwd, mock.fetcher);
    expect(baseline).toBe(f.good);
    expect(f.git("diff", "--name-only", baseline!, f.head)).toContain("src/core.ts");
    expect(f.git("diff", "--name-only", f.source, f.head)).toBe("README.md");
    // Exercise the real selector without importing its CLI entry point.
    const plan = (base: string) =>
      JSON.parse(
        execFileSync(process.execPath, [join(process.cwd(), "scripts/ci-selective.ts"), "--base", base], {
          cwd: f.cwd,
          encoding: "utf8",
          env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "" },
        }),
      );
    expect(plan(baseline!).full).toBe(true);
    expect(plan(f.source).mode).toBe("docs");
    expect(mock.urls).toHaveLength(2);
    expect(mock.urls[1]).toContain("event=push&branch=develop&status=success&per_page=100");
  });
}
test("successful prior source push allows narrow docs comparison", async () => {
  const f = fixture();
  const mock = api([run(f.head), run(f.source), run(f.good)]);
  expect(await findCiBaseline(repo, f.head, "private", f.cwd, mock.fetcher)).toBe(f.source);
});
test("reject foreign repository, workflow, event, branch, state and SHA", async () => {
  const f = fixture();
  for (const overrides of [
    { repository: { full_name: "foreign/repo" } },
    { head_repository: { full_name: "foreign/repo" } },
    { workflow_id: 8 },
    { path: ".github/workflows/release.yml" },
    { event: "pull_request" },
    { head_branch: "main" },
    { status: "in_progress" },
    { conclusion: null },
    { head_sha: "HEAD" },
    { head_sha: "0".repeat(40) },
    { id: 0 },
  ]) {
    expect(
      await findCiBaseline(repo, f.head, "private", f.cwd, api([run(f.source, overrides)]).fetcher),
    ).toBeUndefined();
  }
});
test("nonancestor commit is not evidence; older trusted ancestor can qualify", async () => {
  const f = fixture();
  f.git("checkout", "-q", "--detach", f.good);
  const other = f.commit("other.txt", "diverged");
  f.git("checkout", "-q", "--detach", f.head);
  expect(await findCiBaseline(repo, f.head, "private", f.cwd, api([run(other)]).fetcher)).toBeUndefined();
  expect(await findCiBaseline(repo, f.head, "private", f.cwd, api([run(other), run(f.good)]).fetcher)).toBe(f.good);
});
test("API failures, malformed or missing history, workflow mismatch and unavailable HEAD fail closed", async () => {
  const f = fixture();
  for (const fetcher of [
    async () => {
      throw new Error("private token must not be logged");
    },
    async () => new Response("no", { status: 403 }),
    async () => new Response("not JSON"),
    async () => Response.json({}),
    api([]).fetcher,
    api([run(f.good)], { id: 8, path: ".github/workflows/release.yml" }).fetcher,
    api(Array.from({ length: 101 }, () => run(f.good))).fetcher,
  ])
    expect(await findCiBaseline(repo, f.head, "private", f.cwd, fetcher)).toBeUndefined();
  expect(await findCiBaseline(repo, f.good, "private", f.cwd, api([run(f.source)]).fetcher)).toBeUndefined();
  expect(await findCiBaseline(repo, f.head, "", f.cwd, api([run(f.good)]).fetcher)).toBeUndefined();
});
test("CI push planning uses the fail-closed helper; Release has no develop plan", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  expect(ci).toContain("base=$(bun scripts/find-ci-baseline.ts)");
  expect(ci).not.toContain("github.event.before");
  expect(ci).toContain("actions: read");
  const release = readFileSync(".github/workflows/release.yml", "utf8");
  expect(release).not.toContain("find-ci-baseline");
  expect(release).not.toContain("ci-selective");
  expect(release).not.toContain("actions: read");
});
