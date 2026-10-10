import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureRepository } from "../../src/remote/repository";
import {
  repositoryRequest,
  launchRepository,
  launchPreparedRepository,
  retryRepository,
} from "../../src/remote/repository-wire";
function git(root: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-C", root, ...args]);
  if (r.exitCode) throw Error(r.stderr.toString());
  return r.stdout.toString().trim();
}
test("orphan snapshot omits history; chunk replay is idempotent and result is terminal fenced", () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-repo-wire-"));
  try {
    const repo = join(dir, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "secret"), "OLD_SECRET_MUST_NOT_TRANSFER");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=T", "-c", "user.email=t@invalid", "commit", "-qm", "old");
    const oldSecret = git(repo, "rev-parse", "HEAD:secret");
    rmSync(join(repo, "secret"));
    writeFileSync(join(repo, "file"), randomBytes(400000).toString("hex"));
    git(repo, "add", "-A");
    git(repo, "-c", "user.name=T", "-c", "user.email=t@invalid", "commit", "-qm", "current");
    writeFileSync(join(repo, "file"), readFileSync(join(repo, "file"), "utf8") + "\ncurrent tracked edit\n");
    const snapshot = captureRepository(repo, join(dir, "snapshot"));
    const bytes = readFileSync(snapshot.bundle);
    expect(bytes.length).toBeGreaterThan(256 * 1024);
    const taskDir = join(dir, "owner");
    let checkout = "";
    for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
      const req = {
        op: "repository-upload" as const,
        taskId: "task1",
        snapshot: snapshot.snapshot,
        workspace: { kind: "worktree" as const, branch: "feature/pinned" },
        sha256: createHash("sha256").update(bytes).digest("hex"),
        total: bytes.length,
        offset,
        data: bytes.subarray(offset, offset + 256 * 1024).toString("base64"),
      };
      const first = repositoryRequest(taskDir, req) as { checkout?: string };
      expect(repositoryRequest(taskDir, req)).toEqual(first);
      if (first.checkout) checkout = first.checkout;
    }
    expect(git(checkout, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(checkout, "remote")).toBe("");
    expect(git(checkout, "branch", "--show-current")).toBe("feature/pinned");
    expect(readFileSync(join(checkout, "file"), "utf8").endsWith("current tracked edit\n")).toBe(true);
    const childWorktree = join(dir, "server-child-worktree");
    git(checkout, "worktree", "add", "--detach", childWorktree, "HEAD");
    writeFileSync(join(childWorktree, "file"), "isolated child edit");
    expect(readFileSync(join(checkout, "file"), "utf8")).not.toBe("isolated child edit");
    expect(Bun.spawnSync(["git", "-C", checkout, "cat-file", "-e", oldSecret]).exitCode).not.toBe(0);
    expect(git(checkout, "ls-tree", "-r", "--name-only", "HEAD")).toBe("file");
    expect(() =>
      repositoryRequest(taskDir, { op: "repository-result", taskId: "task1", offset: 0 }, "running"),
    ).toThrow("confirmed task success");
    writeFileSync(join(checkout, "file"), "remote result\n");
    const result = repositoryRequest(taskDir, { op: "repository-result", taskId: "task1", offset: 0 }, "done") as {
      result: { snapshot: string };
      offset: number;
      total: number;
    };
    expect(result.result.snapshot).toBe(snapshot.snapshot);
    expect(result.offset).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repository preparation pins parent before upload and retry retains it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-repo-parent-")),
    repo = join(dir, "repo");
  try {
    mkdirSync(repo);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "file"), "content");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=T", "-c", "user.email=t@invalid", "commit", "-qm", "initial");
    let offline = true;
    const launches: unknown[][] = [];
    const client = {
      path: join(dir, "state.json"),
      status: async () => ({ connection: { hello: { ownerId: "owner", epoch: "epoch" } } }),
      control: async () => {
        if (offline) throw Error("offline upload");
        return { checkout: "/remote/checkout" };
      },
      launch: async (...args: unknown[]) => {
        launches.push(args);
      },
      updateTask: async () => {},
      transcript: async () => ({ taskId: "id", events: [] }),
    };
    const placement = {
      profile: "orchestrator" as const,
      parentDepth: 0,
      workspace: { kind: "worktree" as const, baseRef: "HEAD", branch: "task/isolated" },
    };
    const args = { localRoot: repo, prompt: "work", taskId: "id", jobSessionFile: "/parent/a.jsonl", placement };
    await expect(launchRepository(client as any, args)).rejects.toThrow("offline upload");
    expect(JSON.parse(readFileSync(join(dir, "repositories/id/handoff.json"), "utf8")).jobSessionFile).toBe(
      args.jobSessionFile,
    );
    writeFileSync(join(repo, "file"), "later local edits must not enter retry");
    await expect(launchRepository(client as any, { ...args, taskId: undefined })).rejects.toThrow(
      "Retry that same task ID",
    );
    await expect(
      launchRepository(client as any, { ...args, placement: { ...placement, profile: "fast" } }),
    ).rejects.toThrow("intent conflict");
    offline = false;
    await expect(launchRepository(client as any, { ...args, jobSessionFile: "/parent/b.jsonl" })).rejects.toThrow(
      "intent conflict",
    );
    await retryRepository(client as any, "id");
    expect(launches).toHaveLength(1);
    expect(launches[0][4]).toBe(args.jobSessionFile);
    expect(launches[0][5]).toEqual(placement);
    expect(readFileSync(join(dir, "repositories/id/snapshot/snapshot-checkout/file"), "utf8")).toBe("content");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trusted approved snapshot transfers pinned bytes, rejects tampering, and keeps original return root", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prepared-source-"));
  try {
    const repo = join(dir, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "tracked"), "tracked");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=T", "-c", "user.email=t@invalid", "commit", "-qm", "base");
    writeFileSync(join(repo, "extra"), "approved bytes");
    const snapshot = captureRepository(repo, join(dir, "approved"), ["extra"]);
    writeFileSync(join(repo, "extra"), "changed after approval");
    let checkout = "";
    let launches = 0;
    const task: any = { taskId: "approved-task", events: [] };
    const client: any = {
      path: join(dir, "client", "state.json"),
      status: async () => ({ connection: { hello: { ownerId: "owner", epoch: "epoch" } } }),
      control: async (req: any) => {
        const result: any = repositoryRequest(join(dir, "server"), req);
        checkout = result.checkout ?? checkout;
        return result;
      },
      launch: async () => {
        launches++;
        return task;
      },
      updateTask: async () => {},
      transcript: async () => task,
    };
    const args = {
      localRoot: repo,
      prompt: "work",
      taskId: "approved-task",
      approvedUntracked: ["extra"],
      preparedSnapshot: snapshot,
      preparedSnapshotSha256: snapshot.bundleSha256!,
    };
    await launchPreparedRepository(client, args);
    expect(readFileSync(join(checkout, "extra"), "utf8")).toBe("approved bytes");
    expect(
      JSON.parse(readFileSync(join(dir, "client", "repositories", "approved-task", "handoff.json"), "utf8")).root,
    ).toBe(repo);
    expect(launches).toBe(1);
    writeFileSync(snapshot.bundle, "tampered");
    await expect(launchPreparedRepository(client, args)).rejects.toThrow("changed after user approval");
    expect(launches).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
