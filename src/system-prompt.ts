import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { bruvSystemPrompt } from "./prompts";

interface SystemPromptOptions {
  cwd?: string;
  agentDir?: string;
  projectTrusted?: boolean;
}

/** Return Bruv's base, or leave eligible SYSTEM.md selection to Pi. */
export function bruvSystemPromptFallback(options: SystemPromptOptions = {}): string | undefined {
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? process.env.BRUV_CODING_AGENT_DIR ?? join(homedir(), ".bruv", "agent");
  const projectPrompt = existsSync(join(cwd, ".bruv", "SYSTEM.md"));
  const globalPrompt = existsSync(join(agentDir, "SYSTEM.md"));
  if ((projectPrompt && options.projectTrusted !== false) || globalPrompt) return undefined;
  return bruvSystemPrompt();
}

function optionBoundary(args: string[]): number {
  const boundary = args.indexOf("--");
  return boundary < 0 ? args.length : boundary;
}

/** Give Pi Bruv's fallback through CLI transport, preserving explicit bases. */
export function withBruvSystemPrompt(args: string[], options: SystemPromptOptions = {}): string[] {
  // Config parses its own flags and has no model prompt.
  if (args[0] === "config") return args;

  const boundary = optionBoundary(args);
  const optionArgs = args.slice(0, boundary);
  if (optionArgs.includes("--system-prompt")) return args;

  // Pi ignores project prompt files when trust is denied; its last CLI
  // override wins over the caller's trust setting.
  let projectTrusted = options.projectTrusted;
  for (const arg of optionArgs) {
    if (arg === "--approve" || arg === "-a") projectTrusted = true;
    else if (arg === "--no-approve" || arg === "-na") projectTrusted = false;
  }
  const prompt = bruvSystemPromptFallback({ ...options, projectTrusted });
  if (prompt === undefined) return args;

  const result = [...args];
  result.splice(boundary, 0, "--system-prompt", prompt);
  return result;
}
