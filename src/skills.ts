import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type ExtensionAPI, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList } from "@earendil-works/pi-tui";
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

/** Turns one skill on or off, for the team or just this user. Your own file holds only where you differ. */
export function setSkill(places: Places, name: string, on: boolean, forTeam: boolean) {
  const { team, local } = chosenSkills(places);
  if (forTeam) {
    const next = { ...team, [name]: true };
    if (!on) delete next[name];
    write(places.team, next);
    if (!(name in local)) return;
    delete local[name];
  } else if (on === (team[name] ?? false)) delete local[name];
  else local[name] = on;
  write(places.local, local);
  // The local file is the user's own, so git ignores it without touching the repo's files.
  const exclude = places.exclude;
  const line = ".agents/bruv.local.json";
  if (exclude && (!existsSync(exclude) || !readFileSync(exclude, "utf8").split("\n").includes(line))) {
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(exclude, `\n${line}\n`);
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
  const installed = () =>
    new Map(
      pi
        .getCommands()
        .filter((command) => command.source === "skill")
        .map((command) => [command.name.slice("skill:".length), command.description ?? ""]),
    );
  pi.registerCommand("skills", {
    description: "Choose which skills the agent sees in this project",
    getArgumentCompletions: (prefix) => {
      const word = prefix.split(/\s+/).at(-1) ?? "";
      const items = [...installed()].filter(([name]) => name.startsWith(word));
      return items.length ? items.map(([name, about]) => ({ value: name, label: name, description: about })) : null;
    },
    handler: async (args, ctx) => {
      places ??= skillFiles(ctx.cwd);
      const files = places;
      const known = installed();
      const summary = () => {
        const on = [...chosenSkills(files).on].sort();
        return on.length ? `Skills on: ${on.join(", ")}.` : "All skills off.";
      };
      // `/skills a b` flips those skills for you alone, without opening the list.
      const named = args.split(/\s+/).filter(Boolean);
      if (named.length) {
        for (const name of named) setSkill(files, name, !chosenSkills(files).on.has(name), false);
        ctx.ui.notify(summary(), "info");
        return;
      }
      const names = [...new Set([...known.keys(), ...chosenSkills(files).on])].sort();
      if (names.length === 0) {
        ctx.ui.notify("No skills found. Add them to ~/.agents/skills or .agents/skills.", "info");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify(`${summary()} Switch one with /skills <name>.`, "info");
        return;
      }
      let forTeam = false;
      const scope = "\0scope";
      const items: SettingItem[] = [
        {
          id: scope,
          label: "Save for",
          currentValue: "just me",
          values: ["just me", "team"],
          description:
            "Just me: .agents/bruv.local.json, ignored by git, shared by worktrees. Team: .agents/bruv.json, to commit.",
        },
        ...names.map((name) => ({
          id: name,
          label: name,
          currentValue: chosenSkills(files).on.has(name) ? "on" : "off",
          values: ["off", "on"],
          description: known.get(name) || "Not installed.",
        })),
      ];
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        const list = new SettingsList(
          items,
          Math.min(names.length + 1, Math.max(5, tui.terminal.rows - 10)),
          getSettingsListTheme(),
          (id, value) => {
            if (id === scope) forTeam = value === "team";
            else setSkill(files, id, value === "on", forTeam);
          },
          () => done(),
          { enableSearch: true },
        );
        return {
          render: (width) => [
            theme.fg("accent", theme.bold("Skills the agent sees in this project")),
            ...list.render(width),
          ],
          handleInput: (data) => list.handleInput(data),
          handleMouse: (event) => list.handleMouse(event),
          invalidate: () => list.invalidate(),
        };
      });
      ctx.ui.notify(summary(), "info");
    },
  });
}
