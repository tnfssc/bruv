import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDoc, parseDiff, plan, planDiff } from "../../scripts/ci-selective";

type TestRepository = {
  cwd: string;
  git: (...args: string[]) => string;
  commit: () => string;
};

function withRepository(check: (repo: TestRepository) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), "ci-selective-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "test snapshot");
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    git("config", "user.name", "CI test");
    git("config", "user.email", "test@example.invalid");
    git("config", "commit.gpgsign", "false");
    check({ cwd, git, commit });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function commitDocsChange({ cwd, commit }: TestRepository): string {
  writeFileSync(join(cwd, "README.md"), "before\n");
  const base = commit();
  writeFileSync(join(cwd, "README.md"), "after\n");
  commit();
  return base;
}

test("docs-only classifier accepts human references, not runtime or executable inputs", () => {
  for (const path of [
    "README.md",
    "wisdom/ci/overview.md",
    "wisdom/quality/fast-delivery.md",
    "wisdom/remote-workspaces/overview.md",
  ])
    expect(isDoc(path)).toBe(true);
  for (const path of [
    "src/main.ts",
    "prompts/system.md",
    "tests/thing.test.ts",
    "package.json",
    "README.txt",
    "wisdom/live/prompt.md",
    "wisdom/quality/v1.2.md",
    "scripts/ci-selective.ts",
  ])
    expect(isDoc(path)).toBe(false);
  expect(planDiff([{ status: "M", paths: ["README.md"] }]).mode).toBe("docs");
  for (const change of [
    { status: "M", paths: ["src/main.ts"] },
    { status: "M", paths: ["README.md", "src/main.ts"] },
    { status: "D", paths: ["README.md"] },
    { status: "R100", paths: ["README.md", "README2.md"] },
  ])
    expect(planDiff([change]).mode).toBe("full");
  expect(planDiff([], "baseline unavailable").mode).toBe("full");
  expect(planDiff([]).commands).toEqual([["bash", "scripts/ci.sh", "linux"]]);
});
test("NUL diff parser preserves unusual filenames and fails closed", () => {
  expect(parseDiff("M\0README odd.md\0A\0src/a.ts\0")).toEqual([
    { status: "M", paths: ["README odd.md"] },
    { status: "A", paths: ["src/a.ts"] },
  ]);
  expect(parseDiff("R100\0old\0new\0")).toEqual([{ status: "R100", paths: ["old", "new"] }]);
  for (const raw of ["M\0file", "Z\0file\0", "R100\0old\0", "M\0\0"]) expect(() => parseDiff(raw)).toThrow();
});

test("actual Git planning permits a clean regular-file docs change", () => {
  withRepository((repo) => {
    const base = commitDocsChange(repo);
    expect(plan(repo.cwd, base).mode).toBe("docs");
  });
});

test("actual Git planning rejects modified tracked files and untracked files", () => {
  withRepository((repo) => {
    const base = commitDocsChange(repo);
    writeFileSync(join(repo.cwd, "README.md"), "dirty\n");
    expect(plan(repo.cwd, base).full).toBe(true);
  });
  withRepository((repo) => {
    const base = commitDocsChange(repo);
    const head = repo.git("rev-parse", "HEAD");
    writeFileSync(join(repo.cwd, "untracked.txt"), "untracked");
    expect(plan(repo.cwd, base)).toMatchObject({
      full: true,
      base,
      head,
      reasons: ["Checkout is not clean; full validation required."],
    });
  });
});

test("actual Git planning rejects a planned head that is not checked out", () => {
  withRepository((repo) => {
    const base = commitDocsChange(repo);
    expect(plan(repo.cwd, base, base)).toMatchObject({
      full: true,
      base,
      head: base,
      reasons: ["Checkout does not match planned head; full validation required."],
    });
  });
});

test("actual Git planning requires an available comparison baseline", () => {
  withRepository((repo) => {
    commitDocsChange(repo);
    expect(plan(repo.cwd, "0".repeat(40)).full).toBe(true);
    expect(plan(repo.cwd).full).toBe(true);
  });
});

test("actual Git planning rejects executable reference files in either comparison tree", () => {
  withRepository((repo) => {
    const base = commitDocsChange(repo);
    chmodSync(join(repo.cwd, "README.md"), 0o755);
    const executableHead = repo.commit();
    expect(plan(repo.cwd, base).full).toBe(true);

    chmodSync(join(repo.cwd, "README.md"), 0o644);
    repo.commit();
    expect(plan(repo.cwd, executableHead).full).toBe(true);
  });
});

test("actual Git planning rejects symlink reference files", () => {
  withRepository((repo) => {
    const base = commitDocsChange(repo);
    rmSync(join(repo.cwd, "README.md"));
    symlinkSync("other.md", join(repo.cwd, "README.md"));
    repo.commit();
    expect(plan(repo.cwd, base).full).toBe(true);
  });
});

// The runner executes this repository's tests, not the suite containing these fixtures.
function withDocsRunner(check: (repo: TestRepository, base: string) => void): void {
  withRepository((repo) => {
    writeFileSync(join(repo.cwd, ".gitignore"), "artifacts/\n");
    mkdirSync(join(repo.cwd, "tests", "ci"), { recursive: true });
    writeFileSync(
      join(repo.cwd, "tests/ci/ci-selective.test.ts"),
      `import { test } from "bun:test";
import { writeFileSync } from "node:fs";

test("selected checks", () => {
  writeFileSync("artifacts/check-ran", "yes");
  if (process.env.CI_DOCS_TEST_FAIL) throw new Error("selected check failed");
});
`,
    );
    const base = commitDocsChange(repo);
    check(repo, base);
  });
}

const selector = resolve("scripts/ci-selective.ts");
function runSelector(cwd: string, base: string, options: { output?: string; fail?: boolean } = {}) {
  return spawnSync(process.execPath, [selector, "--base", base, "--run"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_OUTPUT: options.output ?? join(cwd, "artifacts/output"),
      GITHUB_STEP_SUMMARY: join(cwd, "artifacts/summary"),
      CI_DOCS_TEST_FAIL: options.fail ? "1" : "",
    },
  });
}

test("CLI publishes the docs plan and runs selected checks", () => {
  withDocsRunner(({ cwd }, base) => {
    const docs = runSelector(cwd, base);
    expect(docs.status).toBe(0);
    expect(docs.stdout).toContain('"mode": "docs"');
    expect(JSON.parse(readFileSync(join(cwd, "artifacts/ci/selection.json"), "utf8")).mode).toBe("docs");
    expect(existsSync(join(cwd, "artifacts/check-ran"))).toBe(true);
    expect(readFileSync(join(cwd, "artifacts/output"), "utf8")).toBe("mode=docs\nfull=false\n");
    expect(readFileSync(join(cwd, "artifacts/summary"), "utf8")).toBe(
      readFileSync(join(cwd, "artifacts/ci/selection-summary.md"), "utf8"),
    );
  });
});

test("CLI propagates a selected check's failure", () => {
  withDocsRunner(({ cwd }, base) => {
    const failed = runSelector(cwd, base, { fail: true });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("selected check failed");
    expect(existsSync(join(cwd, "artifacts/check-ran"))).toBe(true);
  });
});

test("CLI refuses execution when publishing dirties the planned checkout", () => {
  withDocsRunner(({ cwd }, base) => {
    const stale = runSelector(cwd, base, { output: join(cwd, "README.md") });
    expect(JSON.parse(stale.stdout).mode).toBe("docs");
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("runner requires clean checkout at planned head");
    expect(existsSync(join(cwd, "artifacts/check-ran"))).toBe(false);
  });
});

test("CLI replaces an earlier docs plan with a full plan but refuses docs-only success", () => {
  withDocsRunner(({ cwd, git }) => {
    mkdirSync(join(cwd, "artifacts/ci"), { recursive: true });
    writeFileSync(join(cwd, "artifacts/ci/selection.json"), JSON.stringify({ mode: "docs", full: false }));
    const full = runSelector(cwd, git("rev-parse", "HEAD"));
    expect(full.status).toBe(3);
    expect(JSON.parse(full.stdout).full).toBe(true);
    expect(full.stderr).toContain("Complete CI required; refusing docs-only success.");
    expect(JSON.parse(readFileSync(join(cwd, "artifacts/ci/selection.json"), "utf8")).full).toBe(true);
    expect(existsSync(join(cwd, "artifacts/check-ran"))).toBe(false);
  });
});
