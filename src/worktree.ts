import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Jobs, Work } from "./jobs";

const exec = promisify(execFile);
interface WorktreeOptions {
  branch?: string;
  baseRef?: string;
}
export async function createWorktree(jobs: Jobs, item: Work, cwd: string, sessionId: string, options: WorktreeOptions) {
  const git = async (args: string[]) => (await exec("git", args, { cwd })).stdout.trim();
  const root = await git(["rev-parse", "--show-toplevel"]);
  const exclude = resolve(cwd, await git(["rev-parse", "--git-path", "info/exclude"]));
  mkdirSync(dirname(exclude), { recursive: true });
  if (!existsSync(exclude) || !readFileSync(exclude, "utf8").split("\n").includes(".bruv/"))
    appendFileSync(exclude, "\n.bruv/\n");
  const branch = options.branch ?? `bruv/${sessionId.slice(0, 8)}-${item.id}`;
  const path = join(root, ".bruv", "worktrees", `${sessionId.slice(0, 8)}-${item.id}`);
  const base = await git(["rev-parse", "--verify", "--end-of-options", `${options.baseRef ?? "HEAD"}^{commit}`]);
  if (item.stopped) throw new Error("Agent stopped before worktree creation");
  const code = await jobs.process(item, "git", ["worktree", "add", "-b", branch, "--", path, base], root);
  if (code !== 0) throw new Error("Could not create the worktree");
  item.worktree = { path, branch };
  item.base = base;
  const configPath = join(root, "t3.json");
  const config: { scripts?: { command: string; runOnWorktreeCreate?: boolean }[] } = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : {};
  for (const script of config.scripts ?? []) {
    if (!script.runOnWorktreeCreate) continue;
    item.progress = "setup";
    const result = await jobs.process(item, process.env.SHELL ?? "/bin/sh", ["-c", script.command], path);
    if (result !== 0) throw new Error(`Worktree setup failed (${result})`);
  }
  return item.worktree;
}

export async function worktreeChanges(cwd: string, base: string) {
  const git = async (args: string[], env = process.env) =>
    (await exec("git", args, { cwd, env: { ...env, LC_ALL: "C" } })).stdout;
  const directory = join(cwd, ".tmp");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `bruv-index-${randomUUID()}`);
  const env = { ...process.env, GIT_INDEX_FILE: path };
  try {
    await git(["read-tree", "HEAD"], env);
    await git(["add", "-A", "--", ".", ":!.tmp"], env);
    const stat = await git(["diff", "--cached", "--shortstat", base], env);
    return {
      files: Number(/(\d+) files? changed/.exec(stat)?.[1] ?? 0),
      added: Number(/(\d+) insertions?/.exec(stat)?.[1] ?? 0),
      removed: Number(/(\d+) deletions?/.exec(stat)?.[1] ?? 0),
    };
  } finally {
    rmSync(path, { force: true });
  }
}
