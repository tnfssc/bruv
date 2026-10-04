import { scrubT3BridgeEnvironment } from "../delegation-environment";
import { sensitiveRepoPath } from "./security";
/** Git repository handoff. The caller owns task IDs, transport, artifact retention and serialization. */
import { createHash } from "node:crypto";
import {
  constants,
  fstatSync,
  readSync,
  closeSync,
  chmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";

const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const text = (b: Buffer) => b.toString("utf8").trim();
const names = (b: Buffer) => b.toString("utf8").split("\0").filter(Boolean);
const MAX = 128 * 1024 * 1024;
function git(cwd: string, args: string[], input?: Buffer, allowedFailure = false): Buffer {
  const r = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", cwd, ...args], {
    stdin: input ?? undefined,
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: MAX,
    timeout: 60_000,
    env: {
      ...scrubT3BridgeEnvironment(process.env),
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
  if (r.exitCode !== 0 && !allowedFailure)
    throw new Error("Git " + args[0] + " failed: " + text(Buffer.from(r.stderr)).slice(0, 1000));
  return r.exitCode === 0 ? Buffer.from(r.stdout) : Buffer.alloc(0);
}
function assertRoot(root: string) {
  if (git(root, ["config", "--local", "--get-regexp", "^filter\\."], undefined, true).length)
    throw Error("repository clean/smudge filters unsupported for automatic handoff");
  if (text(git(root, ["rev-parse", "--show-toplevel"])) !== root) throw Error("repository must be its worktree root");
  if (text(git(root, ["config", "--bool", "--get", "core.sparseCheckout"], undefined, true)) === "true")
    throw Error("sparse checkout unsupported");
  for (const flag of names(git(root, ["ls-files", "-v", "-z"]))) {
    if (flag[0] === "S" || flag[0] === "s" || flag[0] !== flag[0]?.toUpperCase())
      throw Error("skip-worktree/assume-unchanged unsupported");
  }
  if (git(root, ["ls-files", "-u", "-z"]).length) throw Error("unmerged index unsupported");
  for (const entry of names(git(root, ["ls-files", "--stage", "-z"]))) {
    if (!/^(100644|100755) [0-9a-f]+ 0\t/.test(entry)) throw Error("symlink, gitlink or unmerged index unsupported");
  }
}
function fingerprint(root: string): string {
  assertRoot(root);
  const head = git(root, ["rev-parse", "HEAD"]);
  const index = git(root, ["ls-files", "--stage", "-z"]);
  const work = git(root, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--binary",
    "--no-renames",
    "--full-index",
    "HEAD",
    "--",
  ]);
  return hash(Buffer.concat([head, index, work]));
}
function untracked(root: string) {
  return names(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
}
function regular(root: string, name: string): boolean {
  if (!name || isAbsolute(name) || name.split("/").some((p) => !p || p === "." || p === ".." || p === ".git"))
    return false;
  const target = resolve(root, name);
  if (relative(root, target).startsWith("..")) return false;
  try {
    let part = root;
    for (const segment of name.split("/")) {
      part = join(part, segment);
      if (realpathSync(part) !== part) return false;
    }
    return statSync(target).isFile();
  } catch {
    return false;
  }
}
function snapshotFile(root: string, name: string): Buffer {
  const fd = openSync(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX) throw Error("Selected untracked file exceeds snapshot bound");
    const data = Buffer.alloc(st.size + 1);
    let n = 0;
    while (n < data.length) {
      const count = readSync(fd, data, n, data.length - n, null);
      if (!count) break;
      n += count;
    }
    if (n !== st.size) throw Error("Selected untracked file changed during capture");
    return data.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}
export interface RepositorySnapshot {
  version: 1;
  /** Local-only origin and transfer-byte digest for trusted preapproved snapshots. */
  localRoot?: string;
  bundleSha256?: string;
  base: string;
  head: string;
  snapshot: string;
  /** Original source identity is provenance only; the transported baseline has no history. */
  source?: {
    kind: "current-tracked" | "commit";
    commit: string;
    requestedRef?: string;
    history: "orphan-baseline";
    matchesCurrent: boolean;
  };
  selectedUntracked: string[];
  omittedUntracked: string[];
  /** Bundle contains an orphan snapshot, not local commit history. */
  bundle: string;
  manifest: string;
}
/** artifactDir must be a new durable private directory OUTSIDE the repository. */
export function captureRepository(
  repo: string,
  artifactDir: string,
  approvedUntracked: string[] = [],
  options: { baseRef?: string } = {},
): RepositorySnapshot {
  const root = realpathSync(repo);
  const dir = resolve(artifactDir);
  if (dir === root || (relative(root, dir).split("/")[0] !== ".." && !isAbsolute(relative(root, dir))))
    throw Error("artifacts must be outside repository");
  assertRoot(root);
  const sourceCommit = text(
    git(root, ["rev-parse", "--verify", "--end-of-options", (options.baseRef ?? "HEAD") + "^{commit}"]),
  );
  if (options.baseRef !== undefined && approvedUntracked.length)
    throw Error("Explicit baseRef snapshots cannot include current untracked files");
  const entries = names(git(root, ["ls-tree", "-rlz", sourceCommit]));
  for (const row of options.baseRef === undefined ? [] : entries) {
    if (!/^(100644|100755) blob /.test(row) || sensitiveRepoPath(row.split("\t")[1]!))
      throw Error("Source commit contains unsupported or credential/config paths");
  }
  const baseBytes = entries.reduce((sum, row) => sum + Number(row.split("\t")[0]!.trim().split(/\s+/).at(-1)), 0);
  const currentBytes = names(git(root, ["ls-files", "-z"])).reduce((sum, name) => {
    try {
      return sum + statSync(join(root, name)).size;
    } catch {
      return sum;
    }
  }, 0);
  if (!Number.isFinite(baseBytes) || baseBytes > MAX || currentBytes > MAX)
    throw Error("Repository snapshot exceeds 128 MiB checkout limit");
  const available = untracked(root);
  const selected = [...approvedUntracked];
  const sensitive = [...names(git(root, ["ls-files", "-z"])), ...selected].filter(sensitiveRepoPath);
  if (sensitive.length)
    throw Error(
      "Repository contains credential/config paths that are not automatically transferred: " + sensitive.join(", "),
    );
  if (new Set(selected).size !== selected.length || selected.some((p) => !available.includes(p) || !regular(root, p)))
    throw Error("ask before transferring untracked files; approval must name exact regular paths");
  if (selected.length > 256 || selected.reduce((n, p) => n + statSync(join(root, p)).size, 0) > MAX)
    throw Error("Selected untracked files exceed capture limit");
  const hashes = selected.map((p) => hash(snapshotFile(root, p)));
  const base = fingerprint(root);
  mkdirSync(dir, { mode: 0o700 }); // refuse existing artifact directory
  const bundle = join(dir, "input.bundle");
  const checkout = join(dir, "snapshot-checkout");
  // Local alternates avoid copying reachable history. The later orphan bundle contains only task input.
  git(dir, ["clone", "--shared", "-q", root, checkout]);
  git(checkout, ["checkout", "--detach", sourceCommit]);
  const sourceDiff = git(root, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--binary",
    "--full-index",
    sourceCommit,
    "--",
  ]);
  const diff = options.baseRef === undefined ? sourceDiff : Buffer.alloc(0);
  if (diff.length) git(checkout, ["apply", "--index", "--binary", "-"], diff);
  for (const p of selected) {
    const target = join(checkout, p);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, snapshotFile(root, p), { mode: 0o600 });
    chmodSync(target, statSync(join(root, p)).mode & 0o777);
    git(checkout, ["add", "--", p]);
  }
  // Transfer only an orphan snapshot, never reachable local history or deleted secrets.
  const tree = text(git(checkout, ["write-tree"]));
  for (const row of names(git(checkout, ["ls-tree", "-rlz", tree]))) {
    if (!/^(100644|100755) blob /.test(row) || sensitiveRepoPath(row.split("\t")[1]!))
      throw Error("Snapshot tree contains unsupported or credential/config paths");
  }
  const commit = text(
    git(checkout, [
      "-c",
      "user.name=Remote snapshot",
      "-c",
      "user.email=snapshot@example.invalid",
      "commit-tree",
      tree,
      "-m",
      "Immutable task input",
    ]),
  );
  git(checkout, ["update-ref", "HEAD", commit]);
  if (
    fingerprint(root) !== base ||
    JSON.stringify(untracked(root)) !== JSON.stringify(available) ||
    selected.some((p, i) => !regular(root, p) || hash(snapshotFile(root, p)) !== hashes[i])
  )
    throw Error("repository changed during capture; discard artifacts");
  // The bundle used by the transport must include the synthetic snapshot commit.
  git(checkout, ["bundle", "create", bundle, "HEAD"]);
  const manifest = join(dir, "manifest.json");
  const snapshot: RepositorySnapshot = {
    version: 1,
    localRoot: root,
    bundleSha256: hash(readFileSync(bundle)),
    base,
    head: text(git(root, ["rev-parse", "HEAD"])),
    snapshot: text(git(checkout, ["rev-parse", "HEAD"])),
    source: {
      kind: options.baseRef === undefined ? "current-tracked" : "commit",
      commit: sourceCommit,
      requestedRef: options.baseRef,
      history: "orphan-baseline",
      matchesCurrent: options.baseRef === undefined || !sourceDiff.length,
    },
    selectedUntracked: selected,
    omittedUntracked: available.filter((p) => !selected.includes(p)),
    bundle,
    manifest,
  };
  writeFileSync(manifest, JSON.stringify(snapshot) + "\n", { flag: "wx", mode: 0o600 });
  return snapshot;
}
export interface RepositoryResult {
  snapshot: string;
  patch: string;
  sha256: string;
  untracked: string[];
}
/** Run on the remote checkout after task completion; transport patch bytes and result metadata together. */
export function collectRepositoryResult(checkout: string, snapshot: string, patchPath: string): RepositoryResult {
  const root = realpathSync(checkout);
  assertRoot(root);
  if (!/^[a-f0-9]{40,64}$/.test(snapshot) || !text(git(root, ["merge-base", snapshot, "HEAD"])).startsWith(snapshot))
    throw Error("remote checkout no longer descends from snapshot");
  const patch = git(root, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--binary",
    "--full-index",
    "--no-renames",
    snapshot,
    "--",
  ]);
  const extra = untracked(root),
    parts = [patch];
  let total = patch.length;
  for (const name of extra) {
    if (!regular(root, name) || sensitiveRepoPath(name))
      throw Error("Remote untracked path cannot be automatically exported: " + name);
    if (statSync(join(root, name)).size > MAX) throw Error("Remote untracked result exceeds limit");
    const diff = Bun.spawnSync(
      [
        "git",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        root,
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        "--",
        "/dev/null",
        name,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        maxBuffer: MAX,
        timeout: 60_000,
        env: { ...scrubT3BridgeEnvironment(process.env), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      },
    );
    if (diff.exitCode !== 0 && diff.exitCode !== 1) throw Error("Cannot preserve remote untracked review patch");
    const bytes = Buffer.from(diff.stdout);
    total += bytes.length;
    if (total > MAX) throw Error("Remote review patch exceeds limit");
    parts.push(bytes);
  }
  const complete = Buffer.concat(parts);
  writeFileSync(patchPath, complete, { flag: "wx", mode: 0o600 });
  return { snapshot, patch: patchPath, sha256: hash(complete), untracked: extra };
}
export type RepositoryReturn = {
  status: "applied" | "no_changes" | "review";
  reason?: string;
  artifact: string;
  receipt?: string;
};
/** Never overwrite local index; changed bases or unsafe results remain review artifacts. Caller serializes per repo. */
export function integrateRepositoryResult(
  repo: string,
  manifest: RepositorySnapshot,
  result: RepositoryResult,
  receipts: string,
): RepositoryReturn {
  const root = realpathSync(repo);
  const patch = readFileSync(result.patch);
  const review = (reason: string, receipt?: string): RepositoryReturn => ({
    status: "review",
    reason,
    artifact: result.patch,
    receipt,
  });
  if (result.snapshot !== manifest.snapshot || hash(patch) !== result.sha256)
    return review("result identity or patch digest mismatch");
  if (result.untracked.length)
    return review("remote untracked files are preserved in the review patch; manual review required");
  try {
    if (fingerprint(root) !== manifest.base || text(git(root, ["rev-parse", "HEAD"])) !== manifest.head)
      return review("local HEAD, index or tracked work changed since capture");
  } catch {
    return review("local repository state unsupported or unreadable; inspect before return");
  }
  if (!patch.length) return { status: "no_changes", artifact: result.patch };
  if (manifest.source?.matchesCurrent === false)
    return review("requested source commit differs from captured local tracked state; manual integration required");
  const summary = text(git(root, ["apply", "--summary", "-"], patch, true));
  if (summary) return review("creation, deletion or mode change requires review");
  const stats = git(root, ["apply", "--numstat", "-z", "-"], patch, true);
  if (!stats.length) return review("invalid or complex patch requires review");
  const tracked = new Set(names(git(root, ["ls-files", "-z"])));
  const parts = names(stats);
  for (const item of parts) {
    const fields = item.split("\t");
    const p = fields[2];
    if (fields.length !== 3 || !p || !tracked.has(p) || manifest.selectedUntracked.includes(p) || !regular(root, p))
      return review("non-regular or new result path requires review");
  }
  const check = Bun.spawnSync(["git", "-C", root, "apply", "--check", "--binary", "-"], {
    stdin: patch,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...scrubT3BridgeEnvironment(process.env), GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1" },
  });
  if (check.exitCode !== 0) return review("patch conflict or invalid patch");
  mkdirSync(receipts, { recursive: true, mode: 0o700 });
  const receipt = join(receipts, hash(manifest.snapshot + ":" + result.sha256) + ".json");
  let fd: number;
  try {
    fd = openSync(receipt, "wx", 0o600);
  } catch {
    return review("result already attempted; inspect receipt and worktree", receipt);
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({ status: "attempting", snapshot: manifest.snapshot, sha256: result.sha256 }) + "\n",
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    git(root, ["apply", "--binary", "-"], patch);
  } catch {
    return review("apply outcome uncertain; inspect worktree", receipt);
  }
  writeFileSync(
    receipt,
    JSON.stringify({ status: "applied", snapshot: manifest.snapshot, sha256: result.sha256 }) + "\n",
  );
  return { status: "applied", artifact: result.patch, receipt };
}
