import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
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
test("current tracked snapshot returns into the worktree without changing the staged index", () => {
  const { dir, root } = fixture();
  try {
    writeFileSync(join(root, "file"), "staged\n");
    git(root, "add", "file");
    writeFileSync(join(root, "file"), "current\n");
    writeFileSync(join(root, "other"), "untracked");
    const stagedIndex = git(root, "ls-files", "--stage");

    const manifest = captureRepository(root, join(dir, "artifacts"));
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    expect(manifest.omittedUntracked).toEqual(["other"]);
    expect(readFileSync(join(checkout, "file"), "utf8")).toBe("current\n");
    expect(git(checkout, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(root, "ls-files", "--stage")).toBe(stagedIndex);
    expect(readFileSync(join(root, "file"), "utf8")).toBe("current\n");

    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, manifest.snapshot, join(dir, "result.patch"));
    const outcome = integrateRepositoryResult(root, manifest, result, join(dir, "receipts"));
    expect(outcome).toMatchObject({ status: "applied", artifact: result.patch });
    expect(JSON.parse(readFileSync(outcome.receipt!, "utf8"))).toEqual({
      status: "applied",
      snapshot: manifest.snapshot,
      sha256: result.sha256,
    });
    expect(readFileSync(join(root, "file"), "utf8")).toBe("remote\n");
    expect(git(root, "ls-files", "--stage")).toBe(stagedIndex);
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts"))).toMatchObject({
      status: "review",
      reason: expect.stringContaining("changed since capture"),
      artifact: result.patch,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an apply receipt prevents retry even when the local worktree returns to the captured state", () => {
  const { dir, root } = fixture();
  try {
    const manifest = captureRepository(root, join(dir, "artifacts"));
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, manifest.snapshot, join(dir, "result.patch"));
    const applied = integrateRepositoryResult(root, manifest, result, join(dir, "receipts"));
    expect(applied.status).toBe("applied");
    const receipt = readFileSync(applied.receipt!, "utf8");

    writeFileSync(join(root, "file"), "base\n");
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts"))).toEqual({
      status: "review",
      reason: "result already attempted; inspect receipt and worktree",
      artifact: result.patch,
      receipt: applied.receipt,
    });
    expect(readFileSync(join(root, "file"), "utf8")).toBe("base\n");
    expect(readFileSync(applied.receipt!, "utf8")).toBe(receipt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local tracked drift preserves the local edit and leaves the remote patch for review", () => {
  const { dir, root } = fixture();
  try {
    const manifest = captureRepository(root, join(dir, "artifacts"));
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, manifest.snapshot, join(dir, "result.patch"));
    const patch = readFileSync(result.patch);

    writeFileSync(join(root, "file"), "local\n");
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts"))).toEqual({
      status: "review",
      reason: "local HEAD, index or tracked work changed since capture",
      artifact: result.patch,
    });
    expect(readFileSync(join(root, "file"), "utf8")).toBe("local\n");
    expect(readFileSync(result.patch)).toEqual(patch);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("remote untracked bytes are exported for review, not applied locally", () => {
  const { dir, root } = fixture();
  try {
    const manifest = captureRepository(root, join(dir, "artifacts"));
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    writeFileSync(join(checkout, "file"), "remote\n");
    writeFileSync(join(checkout, "new"), "bytes");
    const result = collectRepositoryResult(checkout, manifest.snapshot, join(dir, "result.patch"));
    expect(result.untracked).toEqual(["new"]);
    const patch = readFileSync(result.patch, "utf8");
    expect(patch).toContain("+remote");
    expect(patch).toContain("+bytes");
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts"))).toEqual({
      status: "review",
      reason: "remote untracked files are preserved in the review patch; manual review required",
      artifact: result.patch,
    });
    expect(readFileSync(join(root, "file"), "utf8")).toBe("base\n");
    expect(existsSync(join(root, "new"))).toBe(false);
    expect(readFileSync(result.patch, "utf8")).toBe(patch);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a remote staged creation requires review even with no remote untracked files", () => {
  const { dir, root } = fixture();
  try {
    const manifest = captureRepository(root, join(dir, "artifacts"));
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    writeFileSync(join(checkout, "file"), "remote\n");
    writeFileSync(join(checkout, "new"), "bytes");
    git(checkout, "add", "new");
    const result = collectRepositoryResult(checkout, manifest.snapshot, join(dir, "result.patch"));
    expect(result.untracked).toEqual([]);
    const patch = readFileSync(result.patch);
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts"))).toEqual({
      status: "review",
      reason: "creation, deletion or mode change requires review",
      artifact: result.patch,
    });
    expect(readFileSync(join(root, "file"), "utf8")).toBe("base\n");
    expect(existsSync(join(root, "new"))).toBe(false);
    expect(readFileSync(result.patch)).toEqual(patch);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("untracked capture requires exact approval and leaves the selected source file intact", () => {
  const { dir, root } = fixture();
  try {
    writeFileSync(join(root, "approved"), "selected");
    expect(() => captureRepository(root, join(dir, "refused"), ["other-not-approved"])).toThrow(
      "approval must name exact regular paths",
    );
    const manifest = captureRepository(root, join(dir, "artifacts"), ["approved"]);
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    expect(manifest.selectedUntracked).toEqual(["approved"]);
    expect(manifest.omittedUntracked).toEqual([]);
    expect(readFileSync(join(checkout, "approved"), "utf8")).toBe("selected");
    expect(readFileSync(join(root, "approved"), "utf8")).toBe("selected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hidden tracked index flags block return rather than trusting an unreadable local baseline", () => {
  const { dir, root } = fixture();
  try {
    const manifest = captureRepository(root, join(dir, "artifacts"));
    const checkout = join(dir, "artifacts", "snapshot-checkout");
    writeFileSync(join(checkout, "file"), "remote\n");
    const result = collectRepositoryResult(checkout, manifest.snapshot, join(dir, "result.patch"));
    const patch = readFileSync(result.patch);
    git(root, "update-index", "--assume-unchanged", "file");
    expect(integrateRepositoryResult(root, manifest, result, join(dir, "receipts"))).toEqual({
      status: "review",
      reason: "local repository state unsupported or unreadable; inspect before return",
      artifact: result.patch,
    });
    expect(readFileSync(join(root, "file"), "utf8")).toBe("base\n");
    expect(readFileSync(result.patch)).toEqual(patch);
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
