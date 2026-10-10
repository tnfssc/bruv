import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
