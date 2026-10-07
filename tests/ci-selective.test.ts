import { expect, test } from "bun:test";
import { isDoc, parseDiff, planDiff, plan } from "../scripts/ci-selective";
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

test("actual Git docs planning rejects dirty trees, missing history and executable modes", async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync, symlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const cwd = mkdtempSync(join(tmpdir(), "ci-docs-plan-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "CI test");
    git("config", "user.email", "test@example.invalid");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(cwd, "README.md"), "before\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(cwd, "README.md"), "after\n");
    expect(plan(cwd, base).full).toBe(true);
    git("add", ".");
    git("commit", "-qm", "docs");
    expect(plan(cwd, base).mode).toBe("docs");
    const head = git("rev-parse", "HEAD");
    expect(plan(cwd, base, base)).toMatchObject({
      full: true,
      base,
      head: base,
      reasons: ["Checkout does not match planned head; full validation required."],
    });
    expect(plan(cwd, "0".repeat(40)).full).toBe(true);
    writeFileSync(join(cwd, "untracked.txt"), "untracked");
    expect(plan(cwd, base)).toMatchObject({
      full: true,
      base,
      head,
      reasons: ["Checkout is not clean; full validation required."],
    });
    rmSync(join(cwd, "untracked.txt"));
    expect(plan(cwd).full).toBe(true);
    chmodSync(join(cwd, "README.md"), 0o755);
    git("add", ".");
    git("commit", "-qm", "mode");
    expect(plan(cwd, base).full).toBe(true);
    const executableBase = git("rev-parse", "HEAD");
    chmodSync(join(cwd, "README.md"), 0o644);
    git("add", ".");
    git("commit", "-qm", "regular again");
    expect(plan(cwd, executableBase).full).toBe(true);
    rmSync(join(cwd, "README.md"));
    symlinkSync("other.md", join(cwd, "README.md"));
    git("add", ".");
    git("commit", "-qm", "symlink");
    expect(plan(cwd, base).full).toBe(true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("CLI publishes its plan before execution and rechecks checkout authority", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { execFileSync, spawnSync } = await import("node:child_process");
  const cwd = mkdtempSync(join(tmpdir(), "ci-docs-run-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const selector = resolve("scripts/ci-selective.ts");
  const run = (base: string, output = join(cwd, "artifacts/output"), fail = false) =>
    spawnSync(process.execPath, [selector, "--base", base, "--run"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: join(cwd, "artifacts/summary"),
        CI_DOCS_TEST_FAIL: fail ? "1" : "",
      },
    });
  try {
    git("init", "-q");
    git("config", "user.name", "CI test");
    git("config", "user.email", "test@example.invalid");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(cwd, ".gitignore"), "artifacts/\n");
    writeFileSync(join(cwd, "README.md"), "before\n");
    mkdirSync(join(cwd, "tests"));
    writeFileSync(
      join(cwd, "tests/ci-selective.test.ts"),
      'import { test } from "bun:test"; import { writeFileSync } from "node:fs"; test("selected checks", () => { writeFileSync("artifacts/check-ran", "yes"); if (process.env.CI_DOCS_TEST_FAIL) throw new Error("selected check failed"); });',
    );
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(cwd, "README.md"), "after\n");
    git("add", ".");
    git("commit", "-qm", "docs");

    const docs = run(base);
    expect(docs.status).toBe(0);
    expect(docs.stdout).toContain('"mode": "docs"');
    expect(JSON.parse(readFileSync(join(cwd, "artifacts/ci/selection.json"), "utf8")).mode).toBe("docs");
    expect(existsSync(join(cwd, "artifacts/check-ran"))).toBe(true);
    expect(readFileSync(join(cwd, "artifacts/output"), "utf8")).toBe("mode=docs\nfull=false\n");
    expect(readFileSync(join(cwd, "artifacts/summary"), "utf8")).toBe(
      readFileSync(join(cwd, "artifacts/ci/selection-summary.md"), "utf8"),
    );
    rmSync(join(cwd, "artifacts/check-ran"));

    const failed = run(base, join(cwd, "artifacts/output"), true);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("selected check failed");
    expect(existsSync(join(cwd, "artifacts/check-ran"))).toBe(true);
    rmSync(join(cwd, "artifacts/check-ran"));

    // Reporting can mutate the checkout; a docs plan alone cannot authorize execution.
    const stale = run(base, join(cwd, "README.md"));
    expect(JSON.parse(stale.stdout).mode).toBe("docs");
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("runner requires clean checkout at planned head");
    expect(existsSync(join(cwd, "artifacts/check-ran"))).toBe(false);

    git("checkout", "--", "README.md");
    const full = run(git("rev-parse", "HEAD"));
    expect(full.status).toBe(3);
    expect(JSON.parse(full.stdout).full).toBe(true);
    expect(full.stderr).toContain("Complete CI required; refusing docs-only success.");
    expect(JSON.parse(readFileSync(join(cwd, "artifacts/ci/selection.json"), "utf8")).full).toBe(true);
    expect(existsSync(join(cwd, "artifacts/check-ran"))).toBe(false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
