import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type File = { path: string; content: string };

function real(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** `~/.agents/AGENTS.md`, the user file other agents share, unless Pi already loaded it. */
export function sharedAgents(loaded: File[], home = homedir()): File | undefined {
  const path = join(home, ".agents", "AGENTS.md");
  let content: string;
  try {
    content = readFileSync(path, "utf8").replace(/^﻿/, "");
  } catch {
    return undefined;
  }
  // Pi's own global file is often a link to this one.
  const target = real(path);
  return loaded.some((file) => real(file.path) === target) ? undefined : { path, content };
}

export function registerSharedAgents(pi: ExtensionAPI, home = homedir()): void {
  if (process.argv.includes("--no-context-files") || process.argv.includes("-nc")) return;
  // Read once per session, as Pi reads its own context files, so edits mid-session do not change the prompt.
  let file: File | undefined;
  let read = false;
  pi.on("session_start", () => {
    read = false;
  });
  pi.on("before_agent_start", (event) => {
    const options = event.systemPromptOptions;
    if (!read) {
      file = sharedAgents(options.contextFiles, home);
      read = true;
    }
    // Global rules go first, so project files can refine them.
    if (file && !options.contextFiles.some((loaded) => loaded.path === file?.path)) options.contextFiles.unshift(file);
  });
}
