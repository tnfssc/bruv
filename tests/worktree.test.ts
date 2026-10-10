import { expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { registerAgents, type StartAgents } from "../src/agents";
import { WorkBoard } from "../src/board";
import { Jobs } from "../src/jobs";
import { sdk } from "./sdk";

setDefaultTimeout(15000);
test("worktree agents keep branches, count edits once, and report setup failure", async () => {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/worktree-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const previous = process.env.BRUV_PI_COMMAND;
  process.env.BRUV_PI_COMMAND = resolve("tests/fixtures/pi-child.ts");
  const jobs = new Jobs();
  let start: StartAgents;
  initTheme("dark", false);
  const app = await sdk(
    [
      (pi) => {
        start = registerAgents(pi, jobs);
      },
    ],
    undefined,
    dir,
  );
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    writeFileSync(join(dir, "file.txt"), "base\n");
    git("add", ".");
    git("commit", "-qm", "Start");
    const base = git("rev-parse", "HEAD");
    const setup = (command: string) =>
      writeFileSync(
        join(dir, "t3.json"),
        JSON.stringify({
          scripts: [
            { command: "exit 99", runOnWorktreeCreate: false },
            { command, runOnWorktreeCreate: true },
          ],
        }),
      );
    setup(
      "printf 'committed\\n' > file.txt && git add file.txt && git -c commit.gpgsign=false commit -qm Edit && echo ready > setup.txt && echo staged > new.txt && git add new.txt",
    );
    const ctx = app.session.extensionRunner.createContext();
    const launch = async (branch?: string) => {
      const [id] = start(
        { prompt: 'fixture-edit {"new.txt":"new\\n"}', title: "界".repeat(100), worktree: { branch } },
        ctx,
      );
      const item = jobs.get(id);
      await item.completion;
      return item;
    };
    const first = await launch();
    expect(first.status).toBe("done");
    expect(first.base).toBe(base);
    expect(first.changes).toEqual({ files: 3, added: 3, removed: 1 });
    const path = first.worktree?.path as string;
    const inTree = (...args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();
    expect(inTree("rev-parse", "HEAD")).not.toBe(base);
    expect(inTree("show", ":new.txt")).toBe("staged");
    expect(readFileSync(join(path, "setup.txt"), "utf8")).toBe("ready\n");
    const board = new WorkBoard(jobs, ctx.ui.theme, () => {});
    board.update([first]);
    const row = () => stripVTControlCharacters(board.render(80)[0]);
    expect(row()).toMatch(/\+3 −1 · 3 files/);
    writeFileSync(join(path, "later.txt"), "later\n");
    expect(row()).toMatch(/\+3 −1 · 3 files/);
    setup("echo setup-error; exit 7");
    const failed = await launch("custom");
    expect(failed.status).toBe("failed");
    expect(jobs.result(failed).output).toContain("setup-error");
    expect(existsSync(failed.worktree?.path as string)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(git("branch", "--list", "custom")).toBe("+ custom");
    expect(
      readFileSync(join(dir, ".git/info/exclude"), "utf8")
        .split("\n")
        .filter((line) => line === ".bruv/"),
    ).toHaveLength(1);
  } finally {
    await jobs.shutdown();
    await app.close();
    if (previous === undefined) delete process.env.BRUV_PI_COMMAND;
    else process.env.BRUV_PI_COMMAND = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
