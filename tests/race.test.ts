import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { registerAgents } from "../src/agents";
import { Jobs, registerJobs } from "../src/jobs";
import { raceSnapshot, registerRace } from "../src/race";
import { sdk } from "./sdk";

function repo() {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/race-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  writeFileSync(join(dir, "file.txt"), "base\n");
  writeFileSync(join(dir, ".gitignore"), "ignored\n");
  git("add", ".");
  git("commit", "-qm", "Start");
  writeFileSync(join(dir, "file.txt"), "staged\n");
  git("add", "file.txt");
  writeFileSync(join(dir, "file.txt"), "local\n");
  writeFileSync(join(dir, "new.txt"), "untracked\n");
  writeFileSync(join(dir, "ignored"), "keep out\n");
  return { dir, git };
}
const editTask = `fixture-edit ${JSON.stringify({ "file.txt": "winner\n", "new.txt": "updated\n", "added.txt": "added\n", "asset.bin": "a\0b" })}`;

test.each(["command", "tool", "conflict", "none", "dialog"])(
  "race snapshots current changes and handles %s",
  async (mode) => {
    const { dir, git } = repo();
    const previousCommand = process.env.BRUV_PI_COMMAND;
    const previousDir = process.env.PI_CODING_AGENT_DIR;
    process.env.BRUV_PI_COMMAND = resolve("tests/fixtures/pi-child.ts");
    const dialog = Promise.withResolvers<string[]>();
    const selection = Promise.withResolvers<string | undefined>();
    const cleaned = Promise.withResolvers<void>();
    const jobs = new Jobs();
    const notices: string[] = [];
    const app = await sdk(
      [
        (pi) => {
          registerJobs(pi, jobs);
          registerRace(pi, jobs, registerAgents(pi, jobs));
        },
      ],
      {
        select: async (_title, options) => {
          dialog.resolve(options);
          return mode === "dialog" ? selection.promise : undefined;
        },
        notify: (text) => {
          notices.push(text);
        },
      },
      dir,
    );
    const errors: string[] = [];
    app.session.extensionRunner.onError((error) => {
      errors.push(error.error);
    });
    app.session.subscribe((event) => {
      if (
        event.type === "message_end" &&
        event.message.role === "custom" &&
        String(event.message.content).startsWith("Removed")
      )
        cleaned.resolve();
    });
    process.env.PI_CODING_AGENT_DIR = app.dir;
    const index = readFileSync(join(dir, ".git/index"));
    const head = git("rev-parse", "HEAD");
    try {
      if (mode === "tool") {
        app.faux.setResponses([
          fauxAssistantMessage(
            fauxToolCall("codemode", {
              code: `const race = await tools.race({task: ${JSON.stringify(editTask)}}); if (race.id !== "r1" || race.ids.length !== 3) throw new Error("bad race IDs"); return await tools.wait({ids: race.ids, all: true});`,
            }),
            { stopReason: "toolUse" },
          ),
          (context) => {
            const result = [...context.messages].reverse().find((message) => message.role === "toolResult");
            expect(result?.role === "toolResult" && result.isError).toBe(false);
            return fauxAssistantMessage("done");
          },
        ]);
        await app.session.prompt("race the task");
      } else await app.session.prompt(`/race --n 2 ${editTask}`);
      const options = await dialog.promise;
      const items = [...jobs.items.values()];
      expect(items).toHaveLength(mode === "tool" ? 3 : 2);
      expect(items.map((item) => item.status)).toEqual(items.map(() => "done"));
      expect(options).toHaveLength(items.length + 1);
      expect(options[0]).toMatch(/a1 · \+3 −2 · 4 files · checks pass · \d+m\d+s/);
      const paths = items.map((item) => item.worktree?.path as string);
      const snapshot = execFileSync("git", ["rev-parse", "HEAD"], { cwd: paths[0], encoding: "utf8" }).trim();
      expect(git("show", `${snapshot}:file.txt`)).toBe("local");
      expect(git("show", `${snapshot}:new.txt`)).toBe("untracked");
      expect(git("ls-tree", "--name-only", snapshot).split("\n")).not.toContain("ignored");
      expect(readFileSync(join(dir, ".git/index"))).toEqual(index);
      expect(readFileSync(join(dir, "file.txt"), "utf8")).toBe("local\n");
      expect(readFileSync(join(dir, "new.txt"), "utf8")).toBe("untracked\n");
      expect(git("rev-parse", "HEAD")).toBe(head);
      await app.session.prompt("/race");
      expect(notices.at(-1)).toMatch(/a1\s+done\s+\+3 −2 · 4 files\s+\d+m\d+s\s+\$0.30/);
      const reports = app.session.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "custom_message" && entry.customType === "bruv-report");
      expect(reports.some((entry) => "content" in entry && String(entry.content).includes("+3 −2"))).toBe(true);
      writeFileSync(join(dir, "meanwhile.txt"), "keep this\n");
      if (mode === "conflict") {
        writeFileSync(join(dir, "file.txt"), "user changed it\n");
        await app.session.prompt("/race pick a1");
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("file.txt");
        const conflicted = readFileSync(join(dir, "file.txt"), "utf8");
        expect(conflicted).toContain("user changed it");
        expect(conflicted).toContain("winner");
        expect(paths.every(existsSync)).toBe(true);
        expect(git("branch", "--list", "bruv/*").split("\n")).toHaveLength(items.length);
        await app.session.prompt("/race pick none");
      } else {
        if (mode === "dialog") {
          selection.resolve(options[0]);
          await cleaned.promise;
        } else await app.session.prompt(`/race pick ${mode === "none" ? "none" : "a1"}`);
        expect(errors).toEqual([]);
        expect(readFileSync(join(dir, "file.txt"), "utf8")).toBe(mode === "none" ? "local\n" : "winner\n");
        expect(readFileSync(join(dir, "new.txt"), "utf8")).toBe(mode === "none" ? "untracked\n" : "updated\n");
        expect(existsSync(join(dir, "added.txt"))).toBe(mode !== "none");
        if (mode !== "none") expect(readFileSync(join(dir, "asset.bin"))).toEqual(Buffer.from("a\0b"));
      }
      expect(readFileSync(join(dir, "meanwhile.txt"), "utf8")).toBe("keep this\n");
      expect(readFileSync(join(dir, ".git/index"))).toEqual(index);
      expect(git("rev-parse", "HEAD")).toBe(head);
      expect(paths.some(existsSync)).toBe(false);
      expect(git("branch", "--list", "bruv/*")).toBe("");
      expect(git("worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
      expect(readdirSync(join(dir, ".git")).filter((name) => name.startsWith("bruv-race-index"))).toEqual([]);
    } finally {
      selection.resolve(undefined);
      await app.close();
      rmSync(dir, { recursive: true, force: true });
      if (previousCommand === undefined) delete process.env.BRUV_PI_COMMAND;
      else process.env.BRUV_PI_COMMAND = previousCommand;
      if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousDir;
    }
  },
);

test("snapshot uses the linked worktree's branch, files, and separate index", async () => {
  const { dir, git } = repo();
  const linked = join(dir, "linked");
  try {
    git("worktree", "add", "-qb", "feature", linked);
    const inLinked = (...args: string[]) => execFileSync("git", args, { cwd: linked, encoding: "utf8" }).trim();
    writeFileSync(join(linked, "file.txt"), "feature\n");
    inLinked("add", ".");
    inLinked("commit", "-qm", "Feature");
    writeFileSync(join(linked, "file.txt"), "feature edit\n");
    writeFileSync(join(linked, "extra.txt"), "new\n");
    const indexPath = resolve(linked, inLinked("rev-parse", "--git-path", "index"));
    const index = readFileSync(indexPath);
    const mainIndex = readFileSync(join(dir, ".git/index"));
    const snapshot = await raceSnapshot(linked);
    expect(git("rev-parse", `${snapshot}^`)).toBe(inLinked("rev-parse", "HEAD"));
    expect(git("show", `${snapshot}:file.txt`)).toBe("feature edit");
    expect(git("show", `${snapshot}:extra.txt`)).toBe("new");
    expect(readFileSync(indexPath)).toEqual(index);
    expect(readFileSync(join(dir, ".git/index"))).toEqual(mainIndex);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("closing the session removes an unpicked race", async () => {
  const { dir, git } = repo();
  const previousCommand = process.env.BRUV_PI_COMMAND;
  process.env.BRUV_PI_COMMAND = resolve("tests/fixtures/pi-child.ts");
  const jobs = new Jobs();
  const app = await sdk(
    [
      (pi) => {
        registerJobs(pi, jobs);
        registerRace(pi, jobs, registerAgents(pi, jobs));
      },
    ],
    { select: async () => undefined },
    dir,
  );
  try {
    await app.session.prompt(`/race --n 2 ${editTask}`);
    await Promise.all([...jobs.items.values()].map((item) => item.completion));
    expect(git("worktree", "list").split("\n")).toHaveLength(3);
  } finally {
    await app.close();
    if (previousCommand === undefined) delete process.env.BRUV_PI_COMMAND;
    else process.env.BRUV_PI_COMMAND = previousCommand;
  }
  expect(git("worktree", "list").split("\n")).toHaveLength(1);
  expect(git("branch", "--list", "bruv/*")).toBe("");
  rmSync(dir, { recursive: true, force: true });
});
