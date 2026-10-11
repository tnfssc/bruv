import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { moveOldNotes, notesDir, notesIndex, registerNotes } from "../src/notes";
import { sdk } from "./sdk";

function repo() {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/notes-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

test("the index lists titles, and folds large folders into counts", () => {
  const dir = repo();
  try {
    const wisdom = join(dir, ".agents", "notes");
    expect(notesIndex(wisdom, dir)).not.toContain("- ");
    mkdirSync(join(wisdom, "jobs"), { recursive: true });
    writeFileSync(join(wisdom, "values.md"), "# Values\n");
    writeFileSync(join(wisdom, "jobs", "stop.md"), "intro\n# Stopping jobs\n");
    const lines = notesIndex(wisdom, dir).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.some((line: string) => line.includes(join("jobs", "stop.md")) && line.includes("Stopping jobs"))).toBe(
      true,
    );
    for (let i = 0; i < 70; i++) writeFileSync(join(wisdom, "jobs", `n${i}.md`), "x");
    expect(notesIndex(wisdom, dir).split("\n")).toHaveLength(2);
    expect(notesDir(join(dir, ".agents", "notes", "jobs"), false)).toBe(wisdom);
    mkdirSync(join(dir, ".bruv"));
    writeFileSync(join(dir, ".bruv", "settings.json"), JSON.stringify({ wisdomDir: "docs/wisdom" }));
    expect(notesDir(dir, true)).toBe(join(dir, "docs/wisdom"));
    expect(notesDir(dir, false)).toBe(wisdom);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the main agent gets the notes guidance and an index of a bruv 0.x wisdom folder", async () => {
  const dir = repo();
  mkdirSync(join(dir, "wisdom"));
  writeFileSync(join(dir, "wisdom", "jobs.md"), "# Jobs\n");
  const app = await sdk([registerNotes], undefined, dir);
  try {
    let sections: Record<string, string | null> | undefined;
    app.faux.setResponses([
      (context) => {
        sections = context.messages.find((message) => message.role === "system")?.sections;
        return fauxAssistantMessage("ok");
      },
    ]);
    await app.session.prompt("go");
    expect(sections?.notes).toContain(join("wisdom", "jobs.md"));
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agents started by bruv get no notes guidance", async () => {
  const dir = repo();
  const previous = process.env.BRUV_DEPTH;
  process.env.BRUV_DEPTH = "1";
  const app = await sdk([registerNotes], undefined, dir);
  try {
    let sections: Record<string, string | null> | undefined;
    app.faux.setResponses([
      (context) => {
        sections = context.messages.find((message) => message.role === "system")?.sections;
        return fauxAssistantMessage("ok");
      },
    ]);
    await app.session.prompt("go");
    expect(sections).toBeDefined();
    expect(sections?.notes).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.BRUV_DEPTH;
    else process.env.BRUV_DEPTH = previous;
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("moving a tracked wisdom folder keeps history and lists files that still point at it", () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, "wisdom", "jobs"), { recursive: true });
    writeFileSync(join(dir, "wisdom", "jobs", "stop.md"), "# Stop\n");
    writeFileSync(join(dir, "README.md"), "See wisdom/jobs/stop.md\n");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    writeFileSync(join(dir, "wisdom", "draft.md"), "untracked\n");
    expect(notesDir(dir, false)).toBe(join(dir, "wisdom"));
    const moved = moveOldNotes(dir);
    expect(moved?.mentions).toEqual(["README.md"]);
    expect(notesDir(dir, false)).toBe(join(dir, ".agents", "notes"));
    expect(existsSync(join(dir, ".agents", "notes", "jobs", "stop.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents", "notes", "draft.md"))).toBe(true);
    expect(existsSync(join(dir, "wisdom"))).toBe(false);
    const staged = execFileSync("git", ["diff", "--cached", "--name-status", "-M"], { cwd: dir, encoding: "utf8" });
    expect(staged).toContain(join(".agents", "notes", "jobs", "stop.md"));
    expect(moveOldNotes(dir)).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
