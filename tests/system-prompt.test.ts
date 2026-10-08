import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bruvSystemPrompt } from "../src/prompts";
import { bruvSystemPromptFallback, withBruvSystemPrompt } from "../src/system-prompt";

async function systemPromptFiles(files: { project?: string; global?: string }) {
  // Retain each owned fixture for the parent's isolated gate inspection.
  const root = await mkdtemp(join(tmpdir(), "bruv-system-prompt-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(join(cwd, ".bruv"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  if (files.project !== undefined) await writeFile(join(cwd, ".bruv", "SYSTEM.md"), files.project);
  if (files.global !== undefined) await writeFile(join(agentDir, "SYSTEM.md"), files.global);
  return { cwd, agentDir };
}

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

test.each([
  { name: "caller trust", args: [], projectTrusted: true },
  { name: "last long trust flag", args: ["--no-approve", "--approve"], projectTrusted: undefined },
])("preserves project SYSTEM.md with $name", async ({ args, projectTrusted }) => {
  const paths = await systemPromptFiles({ project: "PROJECT" });
  expect(withBruvSystemPrompt(args, { ...paths, projectTrusted })).toBe(args);
});

test.each([
  { name: "long denial flag", args: ["--no-approve"], projectTrusted: undefined },
  { name: "last short trust flag", args: ["-a", "-na"], projectTrusted: undefined },
  { name: "caller denial", args: [], projectTrusted: false },
])("injects Bruv instead of project SYSTEM.md with $name", async ({ args, projectTrusted }) => {
  const paths = await systemPromptFiles({ project: "PROJECT" });
  expect(withBruvSystemPrompt(args, { ...paths, projectTrusted })).toEqual([
    ...args,
    "--system-prompt",
    bruvSystemPrompt(),
  ]);
});

test("positional trust flags cannot authorize project SYSTEM.md", async () => {
  const paths = await systemPromptFiles({ project: "PROJECT" });
  expect(withBruvSystemPrompt(["-na", "--", "-a"], paths)).toEqual([
    "-na",
    "--system-prompt",
    bruvSystemPrompt(),
    "--",
    "-a",
  ]);
});

test("preserves global SYSTEM.md without project trust", async () => {
  const paths = await systemPromptFiles({ global: "GLOBAL" });
  const args: string[] = [];
  expect(withBruvSystemPrompt(args, paths)).toBe(args);
});

test("config receives no session-only prompt option", () => {
  for (const args of [["config"], ["config", "--help"], ["config", "-l", "--approve"]]) {
    expect(withBruvSystemPrompt(args, { cwd: "/missing", agentDir: "/missing" })).toBe(args);
  }
  expect(withBruvSystemPrompt(["--", "config"], { cwd: "/missing", agentDir: "/missing" })).toContain(
    "--system-prompt",
  );
});

test.each([
  { name: "no override uses Bruv", files: {}, projectTrusted: false, expected: bruvSystemPrompt() },
  {
    name: "untrusted project uses Bruv",
    files: { project: "PROJECT" },
    projectTrusted: false,
    expected: bruvSystemPrompt(),
  },
  { name: "trusted project is discovered", files: { project: "PROJECT" }, projectTrusted: true, expected: "PROJECT" },
  {
    name: "trusted project precedes global",
    files: { project: "PROJECT", global: "GLOBAL" },
    projectTrusted: true,
    expected: "PROJECT",
  },
  {
    name: "untrusted project leaves global eligible",
    files: { project: "PROJECT", global: "GLOBAL" },
    projectTrusted: false,
    expected: "GLOBAL",
  },
])("SDK fallback: $name", async ({ files, projectTrusted, expected }) => {
  const paths = await systemPromptFiles(files);
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted });
  const loader = new DefaultResourceLoader({
    ...paths,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: bruvSystemPromptFallback({ ...paths, projectTrusted: settingsManager.isProjectTrusted() }),
  });
  await loader.reload();
  expect(loader.getSystemPrompt()).toBe(expected);
});
