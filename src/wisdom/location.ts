import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Use the nearest project marker, including the .git file in a worktree. */
function projectRoot(cwd: string): string {
  const start = resolve(cwd);
  let current = start;
  while (true) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, ".bruv", "settings.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

/** Read only the project layer: global settings do not override this location. */
export function projectWisdomDir(cwd: string, projectTrusted: boolean): string {
  const root = projectRoot(cwd);
  let wisdomDir: unknown = "wisdom";
  if (projectTrusted) {
    try {
      const text = readFileSync(join(root, ".bruv", "settings.json"), "utf8");
      const value = JSON.parse(text.replace(/^\uFEFF/, "")) as { wisdomDir?: unknown };
      wisdomDir = value.wisdomDir === undefined ? "wisdom" : value.wisdomDir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (typeof wisdomDir !== "string" || !wisdomDir.trim())
    throw new Error("Project wisdomDir must be a non-empty string");
  return resolve(root, wisdomDir);
}
