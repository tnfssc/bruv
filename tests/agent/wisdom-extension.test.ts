import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerProjectWisdom } from "../../src/wisdom/extension";
import { projectWisdomDir } from "../../src/wisdom/location";

const execFileAsync = promisify(execFile);

function fixture(root: boolean | ((ctx: ExtensionContext) => boolean) = true, cwd = "/repo", trusted = true) {
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
  registerProjectWisdom(pi, { isRoot: typeof root === "function" ? root : () => root });
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
    expect(result.systemPrompt).toContain("Prompts and wisdom use nearby voice.");
    expect(result.systemPrompt).toContain("Before big work ends or changes hands");
    expect(result.systemPrompt).toContain("At handoff, say what wisdom and values changed, or why values stayed same.");
    expect(result.systemPrompt).toContain("Nothing new? No forced change.");
    expect(result.systemPrompt).not.toContain(".agents/notes");
    expect(result.systemPrompt).not.toContain("pending");
    expect(result.systemPrompt).not.toContain("index.md");
  });

  test("wisdom goes with the code before saying done", () => {
    const f = fixture(true);
    const { systemPrompt } = f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx);
    expect(systemPrompt).toContain("Save wisdom with code as work moves,");
    expect(systemPrompt).toContain("before the last commit, PR, or handoff.");
    expect(systemPrompt).toContain("Save wisdom with code as work moves, before the last commit, PR, or handoff.");
    expect(systemPrompt).toContain("Edits not committed or commits not shared? Say what is left.");
    expect(systemPrompt).toContain("Done means code and wisdom are where user asked. Check files and commits.");
    expect(systemPrompt).toContain("Task done or PR merged? No more edits there.");
    expect(systemPrompt).toContain(
      "Release facts belong with release or task, not old repo notes.",
    );
    expect(systemPrompt).toContain(
      "Later repo change needs a new task and PR. No quiet edits on the old branch.",
    );
    expect(systemPrompt).not.toContain("After release or broad review, look across the work too.");
    // Do not add a writer or a Git check after the turn has ended.
    expect([...f.handlers.keys()]).toEqual(["before_agent_start"]);
  });

  test("does not inject wisdom guidance into child agents", () => {
    const f = fixture(false);
    expect(f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx)).toBeUndefined();
  });

  test("a failed root authority check denies both effects before asking for trust", async () => {
    const f = fixture(() => {
      throw new Error("identity unavailable");
    });
    f.ctx.isProjectTrusted = () => {
      throw new Error("child must not resolve project settings");
    };
    expect(f.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, f.ctx)).toBeUndefined();
    expect(f.notices).toEqual([]);
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices).toEqual([
      { message: "Project wisdom is unavailable outside the root agent.", severity: "warning" },
    ]);
  });

  test("root eligibility is checked at each effect, not captured at registration", async () => {
    let root = true;
    const f = fixture(() => root);
    const beforeStart = f.handlers.get("before_agent_start")![0];
    expect(beforeStart({ systemPrompt: "base" }, f.ctx).systemPrompt).toStartWith("base\n\n");
    root = false;
    expect(beforeStart({ systemPrompt: "base" }, f.ctx)).toBeUndefined();
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices.at(-1)?.severity).toBe("warning");
    root = true;
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices.at(-1)?.message).toContain("Project wisdom lives in /repo/wisdom/.");
    expect(beforeStart({ systemPrompt: "base" }, f.ctx).systemPrompt).toStartWith("base\n\n");
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

// Retain owned mkdtemp fixtures for inspection by the parent gate.
async function project(config?: unknown, gitMarker = true) {
  const root = await mkdtemp(join(tmpdir(), "bruv-wisdom-"));
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

// Each subprocess starts with only its owned HOME/config/SDK state, never caller credentials.
async function isolatedProcessEnv(root: string): Promise<Record<string, string>> {
  const home = join(root, "home");
  const config = join(root, "config");
  const cache = join(root, "cache");
  const sdk = join(root, "sdk");
  const temporary = join(root, "tmp");
  for (const directory of [home, config, cache, sdk, temporary]) await mkdir(directory);
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    PI_CODING_AGENT_DIR: sdk,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    BRUV_SUBAGENT_DEPTH: "0",
  };
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

  test("each effect resolves current trust and settings without reading wisdom contents", async () => {
    const p = await project({ wisdomDir: "notes/$&" });
    const f = fixture(true, p.nested, false);
    const beforeStart = f.handlers.get("before_agent_start")![0];
    expect(beforeStart({ systemPrompt: "base" }, f.ctx).systemPrompt).toContain(
      `Project wisdom lives in ${join(p.root, "wisdom")}/.`,
    );
    f.ctx.isProjectTrusted = () => true;
    const configured = beforeStart({ systemPrompt: "base" }, f.ctx).systemPrompt;
    expect(configured).toContain(`Project wisdom lives in ${join(p.root, "notes/$&")}/.`);
    expect(configured).toContain(`Values live in ${join(p.root, "notes/$&", "values.md")}.`);
    await writeFile(join(p.root, ".bruv", "settings.json"), JSON.stringify({ wisdomDir: "new-notes" }));
    await f.commands.get("wisdom")!.handler("", f.ctx);
    expect(f.notices.at(-1)?.message).toContain(`Project wisdom lives in ${join(p.root, "new-notes")}/.`);
    expect(beforeStart({ systemPrompt: "base" }, f.ctx).systemPrompt).toContain(
      `Values live in ${join(p.root, "new-notes", "values.md")}.`,
    );
  });

  test("a delegated worktree resolves the tracked setting inside its own checkout", async () => {
    const p = await project({ wisdomDir: "docs/agent-notes" }, false);
    const env = await isolatedProcessEnv(p.root);
    function git(...args: string[]) {
      const result = Bun.spawnSync(["git", ...args], { cwd: p.root, env, stdout: "pipe", stderr: "pipe" });
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

for (const firstEffect of ["prompt", "command"] as const) {
  test(`production SDK resolves a late-attached child before the first wisdom ${firstEffect}`, async () => {
    const p = await project();
    const env = await isolatedProcessEnv(p.root);
    const { stdout } = await execFileAsync(
      process.execPath,
      [join(import.meta.dir, "fixtures/wisdom-extension-sdk.ts"), p.root, firstEffect],
      { cwd: p.root, env, encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL" },
    );
    const line = stdout.split("\n").find((line) => line.startsWith("WISDOM_SDK_RESULT "));
    expect(line).toBeDefined();
    const sdk = JSON.parse(line!.slice("WISDOM_SDK_RESULT ".length)) as {
      prompts: string[];
      notices: Array<{ message: string; severity?: string }>;
      commandPromptCount: number;
    };
    if (firstEffect === "command") {
      expect(sdk.notices).toContainEqual({
        message: "Project wisdom is unavailable outside the root agent.",
        severity: "warning",
      });
      expect(sdk.notices.some(({ message }) => message.startsWith("Project wisdom lives in"))).toBe(false);
      expect(sdk.commandPromptCount).toBe(0);
    }
    expect(sdk.prompts).toHaveLength(2);
    expect(
      sdk.prompts.map((prompt) => ({
        childRole: prompt.includes("You are a normal sub-agent"),
        wisdom: prompt.includes("Project wisdom lives in"),
        values: prompt.includes("Values live in"),
      })),
    ).toEqual([
      { childRole: true, wisdom: false, values: false },
      { childRole: true, wisdom: false, values: false },
    ]);
  }, 20_000);
}
