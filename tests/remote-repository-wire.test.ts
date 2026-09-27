import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureRepository } from "../src/remote/repository";
import { repositoryRequest, launchRepository, retryRepository } from "../src/remote/repository-wire";
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
    expect(Bun.spawnSync(["git", "-C", checkout, "cat-file", "-e", oldSecret]).exitCode).not.toBe(0);
    expect(git(checkout, "ls-tree", "-r", "--name-only", "HEAD")).toBe("file");
    expect(() =>
      repositoryRequest(taskDir, { op: "repository-result", taskId: "task1", offset: 0 }, "running"),
    ).toThrow("completion");
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
    const args = { localRoot: repo, prompt: "work", taskId: "id", jobSessionFile: "/parent/a.jsonl" };
    await expect(launchRepository(client as any, args)).rejects.toThrow("offline upload");
    expect(JSON.parse(readFileSync(join(dir, "repositories/id/handoff.json"), "utf8")).jobSessionFile).toBe(
      args.jobSessionFile,
    );
    offline = false;
    await expect(launchRepository(client as any, { ...args, jobSessionFile: "/parent/b.jsonl" })).rejects.toThrow(
      "intent conflict",
    );
    await retryRepository(client as any, "id");
    expect(launches).toHaveLength(1);
    expect(launches[0][4]).toBe(args.jobSessionFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
