import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { projectRoot } from "./notes";

const guidance = readFileSync(new URL("../prompts/context.md", import.meta.url), "utf8").trim();

type File = { path: string; content: string };
export type Scope = "global" | "parent" | "project" | "folder";

const inside = (dir: string, root: string) => {
  const path = relative(root, dir);
  return !!path && !path.startsWith(`..${sep}`) && path !== "..";
};

/** How far a context file reaches: everywhere, above the project, the project, or one folder in it. */
export function scope(path: string, cwd: string, agentDir = getAgentDir(), home = homedir()): Scope {
  const dir = resolve(dirname(path));
  if (dir === resolve(agentDir) || dir === join(home, ".agents")) return "global";
  const root = projectRoot(cwd);
  if (dir === root) return "project";
  return inside(dir, root) ? "folder" : "parent";
}

const rank: Record<Scope, number> = { global: 0, parent: 1, project: 2, folder: 3 };

/** Pi's context section, with each file's scope and a line on which one wins. */
export function render(files: File[], cwd: string, agentDir?: string, home?: string) {
  const scoped = files.map((file) => ({ ...file, scope: scope(file.path, cwd, agentDir, home) }));
  // Stable sort: Pi already lists ancestors from the top down.
  scoped.sort((a, b) => rank[a.scope] - rank[b.scope]);
  const blocks = scoped.map(
    ({ path, content, scope }) =>
      `<project_instructions path="${path}" scope="${scope}">\n${content}\n</project_instructions>`,
  );
  return [guidance, ...blocks].join("\n\n");
}

export function registerContextOrder(pi: ExtensionAPI, home?: string): void {
  pi.on("before_agent_start", (event) => {
    const options = event.systemPromptOptions;
    // Pi lets a section an extension sets replace its own section of the same name, in place.
    if (options.contextFiles.length)
      options.sections.project_context = render(options.contextFiles, options.cwd, undefined, home);
  });
}
