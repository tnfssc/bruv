import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { bruvSystemPrompt } from "./prompts";

function optionBoundary(args: string[]): number {
  const boundary = args.indexOf("--");
  return boundary < 0 ? args.length : boundary;
}

/**
 * Give Bruv's base to Pi through --system-prompt so Pi can assemble the rest.
 * Explicit CLI, project, and global SYSTEM.md bases still win.
 */
export function withBruvSystemPrompt(
  args: string[],
  options: { cwd?: string; agentDir?: string; projectTrusted?: boolean } = {},
): string[] {
  // The config command parses its own flags before session startup. It has no
  // model prompt and must not receive session-only --system-prompt.
  if (args[0] === "config") return args;

  const boundary = optionBoundary(args);
  if (args.slice(0, boundary).includes("--system-prompt")) return args;

  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? process.env.BRUV_CODING_AGENT_DIR ?? join(homedir(), ".bruv", "agent");
  // Pi ignores project prompt files when project trust is denied. Honor its
  // last trust override rather than treating mere file existence as selection.
  let projectTrusted = options.projectTrusted;
  for (const arg of args.slice(0, boundary)) {
    if (arg === "--approve" || arg === "-a") projectTrusted = true;
    else if (arg === "--no-approve" || arg === "-na") projectTrusted = false;
  }
  const projectPrompt = existsSync(join(cwd, ".bruv", "SYSTEM.md"));
  const globalPrompt = existsSync(join(agentDir, "SYSTEM.md"));
  if ((projectPrompt && projectTrusted !== false) || globalPrompt) return args;

  const result = [...args];
  result.splice(boundary, 0, "--system-prompt", bruvSystemPrompt());
  return result;
}
