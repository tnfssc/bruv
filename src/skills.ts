import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readJson } from "./config";

interface ProjectFile {
  /** Skills turned on (true) or off (false) for this project. Unlisted skills are off. */
  skills?: Record<string, boolean>;
}

interface Places {
  /** `.agents/bruv.json` in this checkout, committed for the team. */
  team: string;
  /** `.agents/bruv.local.json` in the main checkout, so every worktree shares it. */
  local: string;
  /** Git's exclude file, or nothing outside a repo. */
  exclude?: string;
}

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

export function skillFiles(cwd: string): Places {
  try {
    const root = git(cwd, ["rev-parse", "--show-toplevel"]);
    const common = resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"]));
    const main = common.endsWith(".git") ? dirname(common) : root;
    return {
      team: join(root, ".agents", "bruv.json"),
      local: join(main, ".agents", "bruv.local.json"),
      exclude: resolve(cwd, git(cwd, ["rev-parse", "--git-path", "info/exclude"])),
    };
  } catch {
    return { team: join(cwd, ".agents", "bruv.json"), local: join(cwd, ".agents", "bruv.local.json") };
  }
}

/** Team choices with the user's own on top. */
export function chosenSkills(places: Places) {
  const team = readJson<ProjectFile>(places.team, {}).skills ?? {};
  const local = readJson<ProjectFile>(places.local, {}).skills ?? {};
  return { team, local, on: new Set(Object.keys({ ...team, ...local }).filter((name) => local[name] ?? team[name])) };
}

function write(path: string, skills: Record<string, boolean>) {
  const file = readJson<ProjectFile>(path, {});
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...file, skills }, null, 2)}\n`);
}

/** Saves the picks, for the team or just this user, so that afterwards exactly `on` is turned on. */
export function saveSkills(places: Places, on: Set<string>, names: string[], forTeam: boolean) {
  let { team, local } = chosenSkills(places);
  if (forTeam) {
    team = Object.fromEntries([...on].sort().map((name) => [name, true]));
    write(places.team, team);
  }
  const next = { ...local };
  for (const name of new Set([...names, ...on])) {
    if (on.has(name) === (team[name] ?? false)) delete next[name];
    else next[name] = on.has(name);
  }
  if (!forTeam || existsSync(places.local)) write(places.local, next);
  // The local file is the user's own, so git ignores it without touching the repo's files.
  const exclude = places.exclude;
  if (exclude && existsSync(places.local)) {
    const line = ".agents/bruv.local.json";
    if (!existsSync(exclude) || !readFileSync(exclude, "utf8").split("\n").includes(line)) {
      mkdirSync(dirname(exclude), { recursive: true });
      appendFileSync(exclude, `\n${line}\n`);
    }
  }
}

export function registerSkills(pi: ExtensionAPI): void {
  let places: Places | undefined;
  pi.on("session_start", (_event, ctx) => {
    places = skillFiles(ctx.cwd);
  });
  pi.on("before_agent_start", (event, ctx) => {
    places ??= skillFiles(ctx.cwd);
    const options = event.systemPromptOptions;
    const { on } = chosenSkills(places);
    const off = options.skills.filter((skill) => !on.has(skill.name));
    options.skills = options.skills.filter((skill) => on.has(skill.name));
    if (off.length === 0) return;
    // Skills that are off stay out of the list, but the model still learns where they are.
    const folders = [...new Set(off.map((skill) => dirname(skill.baseDir)))].map((folder) => `\`${folder}\``);
    options.sections.skill_folders = [
      "Skills are folders with a SKILL.md: instructions, and sometimes scripts, for one kind of task. Each SKILL.md starts with a name and a description of when to use it.",
      `${options.skills.length ? "The skills turned on for this project are listed below. More" : "Skills"} are in ${folders.join(", ")}. When a task looks like one a skill might cover, check there and read the one that fits before you start.`,
      "The user turns skills on for a project with /skills.",
    ].join("\n");
  });
  pi.registerCommand("skills", {
    description: "Choose which skills the agent sees in this project",
    handler: async (_args, ctx) => {
      places ??= skillFiles(ctx.cwd);
      const installed = new Map(
        pi
          .getCommands()
          .filter((command) => command.source === "skill")
          .map((command) => [command.name.slice("skill:".length), command.description ?? ""]),
      );
      const on = chosenSkills(places).on;
      const names = [...new Set([...installed.keys(), ...on])].sort();
      if (names.length === 0) {
        ctx.ui.notify("No skills found. Add them to ~/.agents/skills or .agents/skills.", "info");
        return;
      }
      const save = "Save";
      for (;;) {
        const rows = names.map((name) => {
          const about = installed.has(name) ? installed.get(name)?.split("\n")[0].slice(0, 70) : "not installed";
          return `${on.has(name) ? "✓" : " "} ${name}${about ? ` · ${about}` : ""}`;
        });
        const picked = await ctx.ui.select("Skills the agent sees here (pick to switch, then Save)", [save, ...rows]);
        if (picked === undefined) return;
        if (picked === save) break;
        const name = names[rows.indexOf(picked)];
        if (name && !on.delete(name)) on.add(name);
      }
      const where = await ctx.ui.select("Save for", ["Just me", "Team (.agents/bruv.json, commit it)"]);
      if (where === undefined) return;
      saveSkills(places, on, names, where !== "Just me");
      ctx.ui.notify(on.size ? `Skills on: ${[...on].sort().join(", ")}.` : "All skills off.", "info");
    },
  });
}
