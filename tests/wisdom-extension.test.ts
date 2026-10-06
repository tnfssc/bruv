import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerProjectWisdom } from "../src/wisdom/extension";
import { projectWisdomDir } from "../src/wisdom/location";

function fixture(root = true, cwd = "/repo", trusted = true) {
  const commands = new Map<
    string,
    { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }
  >();
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
  const notices: Array<{ message: string; severity?: string }> = [];
  const ctx = {
    cwd,
    isProjectTrusted: () => trusted,
    ui: { notify: (message: string, severity?: string) => notices.push({ message, severity }) },
  } as unknown as ExtensionContext;
  const pi = {
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    on(name: string, handler: any) {
      const existing = handlers.get(name) ?? [];
      existing.push(handler);
      handlers.set(name, existing);
    },
  } as any;
  registerProjectWisdom(pi, { isRoot: () => root });
  return { commands, handlers, notices, ctx };
}

describe("project wisdom extension", () => {
  test("injects vetted wisdom guidance for root agents", () => {
    const f = fixture(true);
    const result = f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx);
    expect(result.systemPrompt).toContain("Next agent not hear whole talk.");
    expect(result.systemPrompt).toContain("Leave code and wisdom together");
    expect(result.systemPrompt).toContain("Project wisdom lives in /repo/wisdom/.");
    expect(result.systemPrompt).toContain("Put it with the feature or system it explains.");
    expect(result.systemPrompt).toContain("Values live in /repo/wisdom/values.md.");
    expect(result.systemPrompt).toContain("Write prompts and wisdom in same voice as rest.");
    expect(result.systemPrompt).toContain("Before big work ends or changes hands");
    expect(result.systemPrompt).toContain("At end, say what wisdom changed and what values changed.");
    expect(result.systemPrompt).toContain("Nothing new? No need change values.");
    expect(result.systemPrompt).not.toContain(".agents/notes");
    expect(result.systemPrompt).not.toContain("pending");
    expect(result.systemPrompt).not.toContain("index.md");
  });

  test("wisdom goes with the code before saying done", () => {
    const f = fixture(true);
    const { systemPrompt } = f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx);
    expect(systemPrompt).toContain("Write wisdom while doing the work.");
    expect(systemPrompt).toContain("Finish it before the last commit, PR, or handoff.");
    expect(systemPrompt).toContain("Put it with the code. No wait until the job is done.");
    expect(systemPrompt).toContain("Any edits not committed? Any commits not shared yet?");
    expect(systemPrompt).toContain("Send code and wisdom where the user asked. Not there yet? Say what is left.");
    expect(systemPrompt).toContain("Task done or PR merged? No more edits in that worktree.");
    expect(systemPrompt).toContain(
      "Record release facts with the release or task, not in the old worktree. No new repo notes after shipping.",
    );
    expect(systemPrompt).toContain(
      "Need another repo change? Start a new task and PR. No quiet edits on the old branch.",
    );
    expect(systemPrompt).not.toContain("After release or broad review, look across the work too.");
    // Do not add a writer or a Git check after the turn has ended.
    expect([...f.handlers.keys()]).toEqual(["before_agent_start"]);
  });

  test("does not inject wisdom guidance into child agents", () => {
    const f = fixture(false);
    expect(f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx)).toBeUndefined();
  });

  test("/wisdom reports the durable location", async () => {
    const f = fixture(true);
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices.at(-1)).toEqual({
      message: "Project wisdom lives in /repo/wisdom/. Put it with the feature or system it explains.",
      severity: undefined,
    });
  });

  test("/wisdom is root-only", async () => {
    const f = fixture(false);
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices.at(-1)).toEqual({
      message: "Project wisdom is unavailable outside the root agent.",
      severity: "warning",
    });
  });
});

const projects: string[] = [];
afterEach(async () => {
  for (const directory of projects.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function project(config?: unknown, gitMarker = true) {
  const root = await mkdtemp(join(tmpdir(), "bruv-wisdom-"));
  projects.push(root);
  const nested = join(root, "src", "feature");
  await mkdir(nested, { recursive: true });
  // Git worktrees use a file here rather than a directory.
  if (gitMarker) await writeFile(join(root, ".git"), "gitdir: /unused/worktree\n");
  if (config !== undefined) {
    await mkdir(join(root, ".bruv"));
    await writeFile(join(root, ".bruv", "settings.json"), JSON.stringify(config));
  }
  return { root, nested };
}

describe("project wisdomDir setting", () => {
  test("defaults to wisdom at the project root when launched in a subdirectory", async () => {
    const p = await project();
    expect(projectWisdomDir(p.nested, true)).toBe(join(p.root, "wisdom"));
  });

  test("command and injected values use the same configured worktree location", async () => {
    const p = await project({ wisdomDir: "docs/team notes", theme: "light" });
    const f = fixture(true, p.nested);
    const directory = join(p.root, "docs", "team notes");
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices.at(-1)?.message).toContain(`Project wisdom lives in ${directory}/.`);
    const result = f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx);
    expect(result.systemPrompt).toContain(`Project wisdom lives in ${directory}/.`);
    expect(result.systemPrompt).toContain(`Values live in ${join(directory, "values.md")}.`);
    expect(result.systemPrompt).not.toContain("{{");
    expect(result.systemPrompt).not.toContain("wisdom/values.md");
  });

  test("a delegated worktree resolves the tracked setting inside its own checkout", async () => {
    const p = await project({ wisdomDir: "docs/agent-notes" }, false);
    function git(...args: string[]) {
      const result = Bun.spawnSync(["git", ...args], { cwd: p.root, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    }
    git("init", "-q");
    git("add", ".bruv/settings.json");
    git("-c", "user.name=Wisdom Test", "-c", "user.email=wisdom@example.test", "commit", "-qm", "fixture");
    const destination = join(p.root, "delegated");
    git("worktree", "add", "--detach", destination, "HEAD");
    const nested = join(destination, "src");
    await mkdir(nested);
    expect(projectWisdomDir(nested, true)).toBe(join(destination, "docs", "agent-notes"));
    expect(projectWisdomDir(p.nested, true)).toBe(join(p.root, "docs", "agent-notes"));
  });

  test("finds a non-Git project by its existing settings file", async () => {
    const p = await project({ wisdomDir: "notes" }, false);
    expect(projectWisdomDir(p.nested, true)).toBe(join(p.root, "notes"));
  });

  test("accepts absolute directories and ignores settings in untrusted projects", async () => {
    const directory = join(tmpdir(), "shared-wisdom");
    const p = await project({ wisdomDir: directory });
    expect(projectWisdomDir(p.nested, true)).toBe(directory);
    expect(projectWisdomDir(p.nested, false)).toBe(join(p.root, "wisdom"));
  });

  test("rejects an invalid field instead of pointing agents at the default", async () => {
    const p = await project({ wisdomDir: " " });
    expect(() => projectWisdomDir(p.nested, true)).toThrow("wisdomDir must be a non-empty string");
  });
});
