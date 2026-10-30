import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import bruv from "../extensions/bruv";
import { chosenSkills, saveSkills, skillFiles } from "../src/skills";
import { sdk } from "./sdk";

mkdirSync(".tmp", { recursive: true });
const dir = mkdtempSync(resolve(".tmp/skills-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
const repo = join(dir, "repo");
mkdirSync(repo);
git(repo, "init", "-q");
git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
const tree = join(dir, "tree");
git(repo, "worktree", "add", "-q", tree);
const skills = join(dir, "skills");
for (const name of ["alpha-skill-311", "beta-skill-622"]) {
  mkdirSync(join(skills, name), { recursive: true });
  writeFileSync(join(skills, name, "SKILL.md"), `---\nname: ${name}\ndescription: Fixture ${name}.\n---\n`);
}

test("worktrees share the main checkout's local file and keep their own team file", () => {
  const places = skillFiles(tree);
  expect(places.team).toBe(join(tree, ".agents", "bruv.json"));
  expect(places.local).toBe(join(repo, ".agents", "bruv.local.json"));
});

test("local picks win over the team's, and saving keeps only the differences", () => {
  const places = skillFiles(repo);
  saveSkills(places, new Set(["alpha-skill-311"]), ["alpha-skill-311", "beta-skill-622"], true);
  expect(existsSync(places.local)).toBe(false);
  saveSkills(places, new Set(["beta-skill-622"]), ["alpha-skill-311", "beta-skill-622"], false);
  const { team, local, on } = chosenSkills(places);
  expect(team).toEqual({ "alpha-skill-311": true });
  expect(local).toEqual({ "alpha-skill-311": false, "beta-skill-622": true });
  expect([...on]).toEqual(["beta-skill-622"]);
  expect(readFileSync(join(repo, ".git", "info", "exclude"), "utf8")).toContain(".agents/bruv.local.json");
  rmSync(join(repo, ".agents"), { recursive: true });
});

test("/skills turns a skill on, and only that skill is listed", async () => {
  const picks = ["beta-skill-622", "Save", "Just me"];
  const app = await sdk(
    [bruv],
    {
      select: async (_title, options) => {
        const want = picks.shift() ?? "";
        return options.find((option) => option.includes(want));
      },
    },
    tree,
    "rpc",
    [],
    undefined,
    [skills],
  );
  try {
    const seen: string[] = [];
    app.faux.setResponses([
      (context) => {
        seen.push(JSON.stringify(context.messages.find((message) => message.role === "system")));
        return fauxAssistantMessage("ok");
      },
    ]);
    await app.session.prompt("/skills");
    expect(chosenSkills(skillFiles(tree)).on).toEqual(new Set(["beta-skill-622"]));
    await app.session.prompt("go");
    expect(seen[0]).toContain("beta-skill-622");
    expect(seen[0]).not.toContain("alpha-skill-311");
  } finally {
    await app.close();
  }
});
