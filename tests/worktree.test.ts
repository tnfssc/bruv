import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Jobs } from "../src/jobs";
import { createWorktree, worktreeChanges } from "../src/worktree";

test("worktrees keep branches, run setup scripts, and report setup failure", async () => {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/worktree-"));
  const jobs = new Jobs();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Start");
    const setup = (command: string) =>
      writeFileSync(
        join(dir, "t3.json"),
        JSON.stringify({
          scripts: [
            { command: "exit 99", runOnWorktreeCreate: false },
            { command, runOnWorktreeCreate: true },
          ],
        }),
      );
    setup("echo ready > setup.txt");
    const first = jobs.create("agent", "first", join(dir, "logs"));
    await jobs.run(first, async () => {
      await createWorktree(jobs, first, dir, "12345678-abcd", {});
      return 0;
    });
    expect(first.worktree).toEqual({ path: join(dir, ".bruv/worktrees/12345678-a1"), branch: "bruv/12345678-a1" });
    expect(readFileSync(join(first.worktree?.path as string, "setup.txt"), "utf8")).toBe("ready\n");
    const path = first.worktree?.path as string;
    expect(await worktreeChanges(path, first.base as string)).toEqual({ files: 1, added: 1, removed: 0 });
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: path, encoding: "utf8" })).toBe("");
    const otherJobs = new Jobs();
    const other = otherJobs.create("agent", "other session", join(dir, "other-logs"));
    await otherJobs.run(other, async () => {
      await createWorktree(otherJobs, other, dir, "87654321-abcd", {});
      return 0;
    });
    expect(other.id).toBe(first.id);
    expect(other.status).toBe("done");
    expect(other.worktree).toEqual({ path: join(dir, ".bruv/worktrees/87654321-a1"), branch: "bruv/87654321-a1" });
    expect(existsSync(first.worktree?.path as string)).toBe(true);
    expect(existsSync(other.worktree?.path as string)).toBe(true);
    setup("echo setup-error; exit 7");
    const second = jobs.create("agent", "second", join(dir, "logs"));
    await jobs.run(second, async () => {
      await createWorktree(jobs, second, dir, "12345678", { branch: "custom", baseRef: "HEAD" });
      return 0;
    });
    expect(second.status).toBe("failed");
    expect(jobs.result(second).output).toContain("setup-error");
    expect(existsSync(second.worktree?.path as string)).toBe(true);
    expect(git("branch", "--list", "custom").trim()).toBe("+ custom");
    expect(
      readFileSync(join(dir, ".git/info/exclude"), "utf8")
        .split("\n")
        .filter((line) => line === ".bruv/"),
    ).toHaveLength(1);
  } finally {
    await jobs.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
