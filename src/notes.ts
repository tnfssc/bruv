import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readConfig, saveConfig } from "./config";

const guidance = readFileSync(new URL("../prompts/notes.md", import.meta.url), "utf8").trim();
const MAX_FILES = 60;

/** Nearest folder with .git (a file in worktrees), else the working directory. */
export function projectRoot(cwd: string) {
  let current = resolve(cwd);
  while (!existsSync(join(current, ".git"))) {
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
  return current;
}

const NOTES = join(".agents", "notes");
const OLD = "wisdom";

/** A folder named in .bruv/settings.json by projects set up with bruv 0.x. */
function customDir(root: string, trusted: boolean) {
  const settings = join(root, ".bruv", "settings.json");
  if (!trusted || !existsSync(settings)) return undefined;
  const value = JSON.parse(readFileSync(settings, "utf8").replace(/^\uFEFF/, "")) as { wisdomDir?: unknown };
  return typeof value.wisdomDir === "string" && value.wisdomDir.trim() ? resolve(root, value.wisdomDir) : undefined;
}

/** `.agents/notes` at the project root. Projects from bruv 0.x keep their `wisdom/` until it is moved. */
export function notesDir(cwd: string, trusted: boolean) {
  const root = projectRoot(cwd);
  const custom = customDir(root, trusted);
  if (custom) return custom;
  const notes = join(root, NOTES);
  return !existsSync(notes) && existsSync(join(root, OLD)) ? join(root, OLD) : notes;
}

/** Move a bruv 0.x `wisdom/` folder to `.agents/notes`, keeping git history when it is tracked. */
export function moveOldNotes(cwd: string) {
  const root = projectRoot(cwd);
  const from = join(root, OLD);
  const to = join(root, NOTES);
  if (!existsSync(from) || existsSync(to)) return undefined;
  mkdirSync(dirname(to), { recursive: true });
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  let tracked = false;
  try {
    tracked = git(["ls-files", "--", OLD]).trim() !== "";
  } catch {
    // Not a git repository.
  }
  if (tracked) git(["mv", OLD, NOTES]);
  if (existsSync(from)) renameSync(from, to);
  let mentions: string[] = [];
  try {
    mentions = git(["grep", "-l", "-I", "--fixed-strings", `${OLD}/`, "--", ".", `:!${NOTES}`])
      .split("\n")
      .filter(Boolean);
  } catch {
    // git grep exits 1 when nothing matches.
  }
  return { to: relative(root, to), mentions };
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".md"))
    .sort();
}

/** A list of the notes with their titles, so the model knows what to read. */
export function notesIndex(dir: string, root: string) {
  const shown = relative(root, dir) || ".";
  const list = files(dir);
  if (!list.length) return `${shown}/ has no files yet.`;
  if (list.length > MAX_FILES) {
    const counts = new Map<string, number>();
    for (const path of list) {
      const top = path.split(sep)[0];
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts].map(([top, count]) => `- ${shown}/${top}${count > 1 ? ` (${count} files)` : ""}`).join("\n");
  }
  return list
    .map((path) => {
      const title = /^#\s+(.+)$/m.exec(readFileSync(join(dir, path), "utf8"))?.[1]?.trim();
      return `- ${shown}/${path}${title ? `: ${title}` : ""}`;
    })
    .join("\n");
}

export function registerNotes(pi: ExtensionAPI) {
  // Computed once per session so the prompt stays the same between turns.
  let section: string | undefined;
  let dir: string | undefined;
  const load = (ctx: ExtensionContext) => {
    dir = notesDir(ctx.cwd, ctx.isProjectTrusted());
    const root = projectRoot(ctx.cwd);
    const shown = relative(root, dir) || ".";
    const index = notesIndex(dir, root);
    section = guidance.replaceAll("{{dir}}", () => shown).replace("{{index}}", () => index);
  };
  pi.on("session_start", (_event, ctx) => {
    section = dir = undefined;
    // Agents report their decisions; the main agent keeps the team's notes.
    if (process.env.BRUV_DEPTH) return;
    load(ctx);
    const root = projectRoot(ctx.cwd);
    const offered = readConfig().notesMoveOffered ?? [];
    if (ctx.hasUI && dir === join(root, OLD) && !offered.includes(root)) {
      ctx.ui.notify(`This project keeps its notes in ${OLD}/. Run /notes move to move them to ${NOTES}.`, "info");
      saveConfig({ notesMoveOffered: [...offered, root] });
    }
  });
  pi.on("before_agent_start", (event) => {
    if (section) event.systemPromptOptions.sections.notes = section;
  });
  pi.registerCommand("notes", {
    description: "List the project's notes; /notes move moves a bruv 0.x wisdom/ folder to .agents/notes",
    handler: async (args, ctx) => {
      if (args.trim() !== "move") {
        ctx.ui.notify(notesIndex(notesDir(ctx.cwd, ctx.isProjectTrusted()), projectRoot(ctx.cwd)), "info");
        return;
      }
      if (!(await ctx.ui.confirm("Move notes?", `Move ${OLD}/ to ${NOTES}/? It keeps git history.`))) return;
      const moved = moveOldNotes(ctx.cwd);
      if (!moved) {
        ctx.ui.notify(`Nothing to move: there is no ${OLD}/, or ${NOTES}/ already exists.`, "info");
        return;
      }
      if (!process.env.BRUV_DEPTH) load(ctx);
      const left = moved.mentions.length ? ` These files still mention ${OLD}/: ${moved.mentions.join(", ")}.` : "";
      ctx.ui.notify(`Notes are now in ${moved.to}/. Commit the move when you're ready.${left}`, "info");
    },
  });
}
