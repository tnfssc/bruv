import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bruvSystemPrompt } from "../src/prompts";
import { withBruvSystemPrompt } from "../src/system-prompt";

test("injects Bruv base before Pi's positional prompt boundary", () => {
  expect(
    withBruvSystemPrompt(["--model", "x", "--", "hello"], {
      cwd: "/missing",
      agentDir: "/missing",
    }),
  ).toEqual(["--model", "x", "--system-prompt", bruvSystemPrompt(), "--", "hello"]);
});

test("preserves explicit CLI system prompts", () => {
  const args = ["--system-prompt", "USER_BASE", "question"];
  expect(withBruvSystemPrompt(args, { cwd: "/missing", agentDir: "/missing" })).toBe(args);
  const positional = ["--", "--system-prompt", "not-an-option"];
  expect(withBruvSystemPrompt(positional, { cwd: "/missing", agentDir: "/missing" })).not.toBe(positional);
});

test("preserves project and global SYSTEM.md overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-system-prompt-"));
  try {
    const cwd = join(root, "project"),
      agentDir = join(root, "agent");
    await mkdir(join(cwd, ".bruv"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(cwd, ".bruv", "SYSTEM.md"), "PROJECT");
    const projectArgs: string[] = [];
    expect(withBruvSystemPrompt(projectArgs, { cwd, agentDir, projectTrusted: true })).toBe(projectArgs);

    const deniedArgs = ["--no-approve"];
    expect(withBruvSystemPrompt(deniedArgs, { cwd, agentDir })).toEqual([
      "--no-approve",
      "--system-prompt",
      bruvSystemPrompt(),
    ]);
    const lastTrustFlagWins = ["--no-approve", "--approve"];
    expect(withBruvSystemPrompt(lastTrustFlagWins, { cwd, agentDir })).toBe(lastTrustFlagWins);

    const explicitlyDenied: string[] = [];
    expect(
      withBruvSystemPrompt(explicitlyDenied, {
        cwd,
        agentDir,
        projectTrusted: false,
      }),
    ).toEqual(["--system-prompt", bruvSystemPrompt()]);
    await rm(join(cwd, ".bruv", "SYSTEM.md"));
    await writeFile(join(agentDir, "SYSTEM.md"), "GLOBAL");
    const globalArgs: string[] = [];
    expect(withBruvSystemPrompt(globalArgs, { cwd, agentDir })).toBe(globalArgs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("config receives no session-only prompt option", () => {
  for (const args of [["config"], ["config", "--help"], ["config", "-l", "--approve"]]) {
    expect(withBruvSystemPrompt(args, { cwd: "/missing", agentDir: "/missing" })).toBe(args);
  }
  expect(withBruvSystemPrompt(["--", "config"], { cwd: "/missing", agentDir: "/missing" })).toContain(
    "--system-prompt",
  );
});
