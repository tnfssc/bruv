import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCiBaseline } from "../../scripts/find-ci-baseline";
import { ownedFixtureEnv } from "../helpers/helpers";

const repo = "owner/project";
const workflow = { id: 7, path: ".github/workflows/ci.yml" };
const workflowUrl = `https://api.github.com/repos/${repo}/actions/workflows/ci.yml`;
const historyUrl = `https://api.github.com/repos/${repo}/actions/workflows/7/runs?event=push&branch=develop&status=success&per_page=100`;
const token = "private-test-token";

// A validated commit, an unchecked source push, then a docs-only HEAD.
function checkout() {
  const root = mkdtempSync(join(tmpdir(), "ci-baseline-"));
  const env = ownedFixtureEnv(root);
  const cwd = join(root, "checkout");
  mkdirSync(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
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
  const validated = commit("README.md", "initial");
  const source = commit("src/core.ts", "unchecked source");
  const head = commit("README.md", "docs only");
  return { cwd, env, git, commit, validated, source, head };
}

function successfulPush(sha: string, overrides = {}) {
  return {
    id: 1,
    workflow_id: workflow.id,
    path: workflow.path,
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

// Only HTTP is substituted: checkout identity, object type and ancestry use real Git.
function githubHistory(runs: unknown[], metadata: unknown = workflow) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url === workflowUrl) return Response.json(metadata);
    if (url === historyUrl) return Response.json({ workflow_runs: runs });
    throw new Error("unexpected GitHub API request");
  };
  return { requests, fetcher };
}

function selection(cwd: string, base: string, env: Record<string, string>) {
  return JSON.parse(
    execFileSync(process.execPath, [join(process.cwd(), "scripts/ci-selective.ts"), "--base", base], {
      cwd,
      encoding: "utf8",
      env,
    }),
  );
}

describe("baseline determines which source changes CI must validate", () => {
  test.each(["failure", "cancelled"])("docs after a %s source push still require full CI", async (conclusion) => {
    const f = checkout();
    const api = githubHistory([
      successfulPush(f.head),
      successfulPush(f.source, { conclusion }),
      successfulPush(f.validated),
    ]);
    const baseline = await findCiBaseline(repo, f.head, token, f.cwd, api.fetcher, f.env);
    expect(baseline).toBe(f.validated);
    expect(f.git("diff", "--name-only", baseline!, f.head)).toContain("src/core.ts");
    expect(f.git("diff", "--name-only", f.source, f.head)).toBe("README.md");
    expect(selection(f.cwd, baseline!, f.env).full).toBe(true);
    expect(selection(f.cwd, f.source, f.env).mode).toBe("docs");
  });

  test("newest successful prior source push permits docs-only comparison, never HEAD itself", async () => {
    const f = checkout();
    const api = githubHistory([successfulPush(f.head), successfulPush(f.source), successfulPush(f.validated)]);
    const baseline = await findCiBaseline(repo, f.head, token, f.cwd, api.fetcher, f.env);
    expect(baseline).toBe(f.source);
    expect(selection(f.cwd, baseline!, f.env).mode).toBe("docs");
  });
});

describe("GitHub evidence must describe our completed CI push", () => {
  test("two authenticated requests to the hosted workflow and bounded successful develop history", async () => {
    const f = checkout();
    const api = githubHistory([successfulPush(f.validated)]);
    expect(await findCiBaseline(repo, f.head, token, f.cwd, api.fetcher, f.env)).toBe(f.validated);
    expect(api.requests.map(({ url }) => url)).toEqual([workflowUrl, historyUrl]);
    for (const { init } of api.requests) {
      expect(init?.headers).toEqual({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
    }
  });

  test.each([
    ["foreign repository", { repository: { full_name: "foreign/repo" } }],
    ["foreign head repository", { head_repository: { full_name: "foreign/repo" } }],
    ["other workflow ID", { workflow_id: 8 }],
    ["other workflow path", { path: ".github/workflows/release.yml" }],
    ["pull request event", { event: "pull_request" }],
    ["other branch", { head_branch: "main" }],
    ["unfinished run", { status: "in_progress" }],
    ["missing success conclusion", { conclusion: null }],
    ["symbolic SHA", { head_sha: "HEAD" }],
    ["invalid run ID", { id: 0 }],
  ])("%s is skipped, not trusted", async (_reason, overrides) => {
    const f = checkout();
    const rejected = successfulPush(f.source, overrides);
    expect(await findCiBaseline(repo, f.head, token, f.cwd, githubHistory([rejected]).fetcher, f.env)).toBeUndefined();
    expect(
      await findCiBaseline(
        repo,
        f.head,
        token,
        f.cwd,
        githubHistory([rejected, successfulPush(f.validated)]).fetcher,
        f.env,
      ),
    ).toBe(f.validated);
  });

  test("GitHub's repository-qualified workflow path is valid", async () => {
    const f = checkout();
    const run = successfulPush(f.source, { path: `${repo}/${workflow.path}@refs/heads/develop` });
    expect(await findCiBaseline(repo, f.head, token, f.cwd, githubHistory([run]).fetcher, f.env)).toBe(f.source);
  });

  test.each([
    ["wrong ID", { id: 0, path: workflow.path }],
    ["wrong path", { id: 7, path: ".github/workflows/release.yml" }],
    ["missing metadata", {}],
  ])("workflow metadata: %s stops before requesting history", async (_reason, metadata) => {
    const f = checkout();
    const api = githubHistory([successfulPush(f.validated)], metadata);
    expect(await findCiBaseline(repo, f.head, token, f.cwd, api.fetcher, f.env)).toBeUndefined();
    expect(api.requests.map(({ url }) => url)).toEqual([workflowUrl]);
  });
});

describe("API uncertainty requires full validation", () => {
  test.each([
    [
      "network exception",
      async () => {
        throw new Error(token);
      },
    ],
    ["HTTP denial", async () => new Response("denied", { status: 403 })],
    ["malformed JSON", async () => new Response("not JSON")],
    ["missing history", async (url: string) => Response.json(url === workflowUrl ? workflow : {})],
  ])("%s yields no baseline or credential output", async (_reason, fetcher) => {
    const f = checkout();
    const stderr = spyOn(console, "error").mockImplementation(() => {});
    const stdout = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await findCiBaseline(repo, f.head, token, f.cwd, fetcher, f.env)).toBeUndefined();
      expect(stderr).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  test.each([0, 101])("%i runs cannot provide a baseline", async (count) => {
    const f = checkout();
    const api = githubHistory(Array.from({ length: count }, () => successfulPush(f.validated)));
    expect(await findCiBaseline(repo, f.head, token, f.cwd, api.fetcher, f.env)).toBeUndefined();
    expect(api.requests).toHaveLength(2);
  });
});

describe("Git must prove the candidate is a local ancestor commit", () => {
  test("a divergent commit is skipped in favor of an older trusted ancestor", async () => {
    const f = checkout();
    f.git("checkout", "-q", "--detach", f.validated);
    const divergent = f.commit("other.txt", "diverged");
    f.git("checkout", "-q", "--detach", f.head);
    expect(
      await findCiBaseline(repo, f.head, token, f.cwd, githubHistory([successfulPush(divergent)]).fetcher, f.env),
    ).toBeUndefined();
    const api = githubHistory([successfulPush(divergent), successfulPush(f.validated)]);
    expect(await findCiBaseline(repo, f.head, token, f.cwd, api.fetcher, f.env)).toBe(f.validated);
  });

  test("missing objects and blobs are not ancestor commits", async () => {
    const f = checkout();
    const blob = f.git("rev-parse", "HEAD:README.md");
    for (const sha of ["0".repeat(40), blob]) {
      expect(
        await findCiBaseline(repo, f.head, token, f.cwd, githubHistory([successfulPush(sha)]).fetcher, f.env),
      ).toBeUndefined();
    }
  });

  test.each(["different HEAD", "missing checkout"])("%s stops before API access", async (problem) => {
    const f = checkout();
    const api = githubHistory([successfulPush(f.validated)]);
    const head = problem === "different HEAD" ? f.validated : f.head;
    const cwd = problem === "missing checkout" ? join(f.cwd, "missing") : f.cwd;
    expect(await findCiBaseline(repo, head, token, cwd, api.fetcher, f.env)).toBeUndefined();
    expect(api.requests).toHaveLength(0);
  });

  test.each([
    ["repository", { repo: "not-a-repository" }],
    ["HEAD", { head: "HEAD" }],
    ["token", { token: "" }],
  ])("invalid %s stops before API access", async (_reason, invalid) => {
    const f = checkout();
    const api = githubHistory([successfulPush(f.validated)]);
    const input = { repo, head: f.head, token, ...invalid };
    expect(await findCiBaseline(input.repo, input.head, input.token, f.cwd, api.fetcher, f.env)).toBeUndefined();
    expect(api.requests).toHaveLength(0);
  });
});

describe("one deadline covers both HTTP requests and Git ancestry proof", () => {
  test("a stalled history request is aborted by the remaining shared budget", async () => {
    const f = checkout();
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const timeout = spyOn(AbortSignal, "timeout");
    const historySignals: AbortSignal[] = [];
    const api = githubHistory([successfulPush(f.validated)]);
    const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === workflowUrl) {
        const response = await api.fetcher(url, init);
        now += 14_990;
        return response;
      }
      const signal = init?.signal;
      if (!signal) throw new Error("missing request deadline");
      historySignals.push(signal);
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    try {
      expect(await findCiBaseline(repo, f.head, token, f.cwd, fetcher, f.env)).toBeUndefined();
      expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([15_000, 10]);
      expect(historySignals).toHaveLength(1);
      expect(historySignals[0]!.aborted).toBe(true);
    } finally {
      clock.mockRestore();
      timeout.mockRestore();
    }
  });

  test.each(["workflow", "history"])("budget exhausted after %s cannot trust a baseline", async (stage) => {
    const f = checkout();
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const timeout = spyOn(AbortSignal, "timeout");
    const api = githubHistory([successfulPush(f.validated)]);
    const fetcher = async (url: string, init?: RequestInit) => {
      const response = await api.fetcher(url, init);
      now += url === workflowUrl && stage === "history" ? 6_000 : 15_000;
      return response;
    };
    try {
      expect(await findCiBaseline(repo, f.head, token, f.cwd, fetcher, f.env)).toBeUndefined();
      expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual(
        stage === "workflow" ? [15_000] : [15_000, 9_000],
      );
      expect(api.requests).toHaveLength(stage === "workflow" ? 1 : 2);
    } finally {
      clock.mockRestore();
      timeout.mockRestore();
    }
  });
});

test("CI push planning uses the fail-closed helper; Release has no develop plan", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  expect(ci).toContain("base=$(bun scripts/find-ci-baseline.ts)");
  expect(ci).not.toContain("github.event.before");
  expect(ci).toContain("actions: read");
  const release = readFileSync(".github/workflows/release.yml", "utf8");
  expect(release).not.toContain("find-ci-baseline");
  expect(release).not.toContain("ci-selective");
  expect(release).toContain("actions: read");
  expect(release).toContain("bun scripts/find-release-ci.ts");
});
