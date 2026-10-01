import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureRepository, collectRepositoryResult, integrateRepositoryResult } from "../src/remote/repository";
function git(root: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode) throw Error(Buffer.from(r.stderr).toString());
  return Buffer.from(r.stdout).toString().trim();
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "repo-handoff-"));
  const root = join(dir, "repo");
  mkdirSync(root);
  git(root, "init", "-q");
  writeFileSync(join(root, "file"), "base\n");
  git(root, "add", "file");
  git(root, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "base");
  return { dir, root };
}
test("capture current tracked state and safe return without touching staged index", () => {
  const { dir, root } = fixture();
  try {
    writeFileSync(join(root, "file"), "staged\n");
    git(root, "add", "file");
    writeFileSync(join(root, "file"), "current\n");
    writeFileSync(join(root, "other"), "untracked");
    expect(() => captureRepository(root, join(dir, "refused"), ["other-not-approved"])).toThrow();
    const manifest = captureRepository(root, join(dir, "artifacts"));
    expect(manifest.omittedUntracked).toEqual(["other"]);
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    expect(readFileSync(join(checkout, "file"), "utf8")).toBe("current\n");
    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, manifest.snapshot, join(dir, "result.patch"));
    const before = git(root, "ls-files", "--stage");
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts")).status).toBe("applied");
    expect(readFileSync(join(root, "file"), "utf8")).toBe("remote\n");
    expect(git(root, "ls-files", "--stage")).toBe(before);
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts")).status).toBe("review");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("local drift, remote creations and remote untracked bytes are review only", () => {
  const { dir, root } = fixture();
  try {
    const m = captureRepository(root, join(dir, "artifacts"));
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, m.snapshot, join(dir, "p"));
    writeFileSync(join(root, "file"), "local\n");
    expect(integrateRepositoryResult(root, m, result, join(dir, "receipts")).status).toBe("review");
    expect(readFileSync(join(root, "file"), "utf8")).toBe("local\n");
    writeFileSync(join(root, "file"), "base\n");
    writeFileSync(join(checkout, "new"), "bytes");
    const untracked = collectRepositoryResult(checkout, m.snapshot, join(dir, "p2"));
    expect(integrateRepositoryResult(root, m, untracked, join(dir, "receipts")).status).toBe("review");
    git(checkout, "add", "new");
    const created = collectRepositoryResult(checkout, m.snapshot, join(dir, "p3"));
    expect(integrateRepositoryResult(root, m, created, join(dir, "receipts")).status).toBe("review");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit untracked transfer and hidden tracked edits", () => {
  const { dir, root } = fixture();
  try {
    writeFileSync(join(root, "approved"), "selected");
    const m = captureRepository(root, join(dir, "artifacts"), ["approved"]);
    expect(readFileSync(join(dir, "artifacts", "snapshot-checkout", "approved"), "utf8")).toBe("selected");
    expect(m.omittedUntracked).toEqual([]);
    expect(readFileSync(join(root, "approved"), "utf8")).toBe("selected");
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, m.snapshot, join(dir, "patch"));
    git(root, "update-index", "--assume-unchanged", "file");
    expect(integrateRepositoryResult(root, m, result, join(dir, "receipts")).status).toBe("review");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit baseRef pins that commit, not current edits; return cannot overwrite a different baseline", () => {
  const { dir, root } = fixture();
  try {
    const base = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "file"), "later\n");
    git(root, "add", "file");
    git(root, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "later");
    writeFileSync(join(root, "file"), "current edits\n");
    const manifest = captureRepository(root, join(dir, "snapshot"), [], { baseRef: base });
    expect(manifest.source).toEqual({
      kind: "commit",
      commit: base,
      requestedRef: base,
      history: "orphan-baseline",
      matchesCurrent: false,
    });
    const checkout = join(dir, "snapshot", "snapshot-checkout");
    expect(readFileSync(join(checkout, "file"), "utf8")).toBe("base\n");
    expect(git(checkout, "rev-list", "--count", "HEAD")).toBe("1");
    expect(manifest.snapshot).not.toBe(base);
    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, manifest.snapshot, join(dir, "patch"));
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts"))).toMatchObject({
      status: "review",
      reason: expect.stringContaining("source commit"),
    });
    expect(readFileSync(join(root, "file"), "utf8")).toBe("current edits\n");
    writeFileSync(join(root, "untracked"), "private");
    expect(() => captureRepository(root, join(dir, "refused"), ["untracked"], { baseRef: base })).toThrow(
      "cannot include current untracked",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit HEAD with matching tracked state returns safely without importing history", () => {
  const { dir, root } = fixture();
  try {
    const m = captureRepository(root, join(dir, "snapshot"), [], { baseRef: "HEAD" });
    expect(m.source?.matchesCurrent).toBe(true);
    const checkout = join(dir, "snapshot", "snapshot-checkout");
    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, m.snapshot, join(dir, "patch"));
    expect(integrateRepositoryResult(root, m, result, join(dir, "receipts")).status).toBe("applied");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
