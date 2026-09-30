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
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
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
    expect(plan(cwd).full).toBe(true);
    chmodSync(join(cwd, "README.md"), 0o755);
    git("add", ".");
    git("commit", "-qm", "mode");
    expect(plan(cwd, base).full).toBe(true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
