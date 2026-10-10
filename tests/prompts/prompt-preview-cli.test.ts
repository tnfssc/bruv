import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { PromptPreview } from "../../src/prompt-preview";

const repo = join(import.meta.dir, "../..");

async function run(args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, "run", "prompt:preview", "--", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function capture(args: string[]): Promise<PromptPreview> {
  const result = await run(args, repo);
  expect(result.stderr).not.toContain("error:");
  expect(result.exitCode).toBe(0);
  const preview = JSON.parse(result.stdout) as PromptPreview;
  expect(result.stdout).toBe(JSON.stringify(preview, null, 2) + "\n");
  expect(preview.preview.networkRequests).toBe(0);
  return preview;
}

async function withColdCheckout(check: (cwd: string) => Promise<void>): Promise<void> {
  const unpreparedRepo = await mkdtemp(join(tmpdir(), "bruv-preview-cli-"));
  try {
    // Copy the actual package entry and source, deliberately excluding dist/runtime-assets.
    await cp(join(repo, "src"), join(unpreparedRepo, "src"), { recursive: true });
    await mkdir(join(unpreparedRepo, "scripts"));
    await cp(join(repo, "scripts/prompt-preview.ts"), join(unpreparedRepo, "scripts/prompt-preview.ts"));
    await cp(join(repo, "package.json"), join(unpreparedRepo, "package.json"));
    await symlink(join(repo, "node_modules"), join(unpreparedRepo, "node_modules"));

    // Negative control: this checkout really cannot initialize production capture.
    const captureAttempt = await run([], unpreparedRepo);
    expect(captureAttempt.exitCode).not.toBe(0);
    expect(captureAttempt.stdout).toBe("");
    expect(captureAttempt.stderr).toContain("Cannot find module '../../dist/runtime-assets/photon_rs_bg.wasm'");

    await check(unpreparedRepo);
  } finally {
    await rm(unpreparedRepo, { recursive: true, force: true });
  }
}

test("package help exits before loading capture dependencies, even after valid options", async () => {
  await withColdCheckout(async (unpreparedRepo) => {
    for (const args of [["--help"], ["-h"], ["--role", "normal", "--help", "--unknown"]]) {
      const result = await run(args, unpreparedRepo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toStartWith("Usage: bun run prompt:preview -- [options]");
      expect(result.stdout).toContain("external project context is excluded");
      expect(result.stdout).toContain("exact captured systemPrompt, tools, and messages");
      expect(result.stderr).not.toContain("error:");
    }
  });
});

test("argument errors precede capture initialization and retain option-specific diagnostics", async () => {
  await withColdCheckout(async (unpreparedRepo) => {
    const cases: Array<[string[], string]> = [
      [["--unknown"], "Unknown option: --unknown"],
      [["--role", "invalid", "--help"], "Invalid --role: invalid"],
      [["--mode", "invalid"], "Invalid --mode: invalid"],
      [["--message", "--help"], "--message requires a value"],
      [["--message", ""], "--message requires a value"],
      ...["--project", "--role", "--mode", "--message", "--goal"].map((option): [string[], string] => [
        [option],
        option + " requires a value",
      ]),
    ];
    for (const [args, diagnostic] of cases) {
      const result = await run(args, unpreparedRepo);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(diagnostic);
      expect(result.stderr).not.toContain("Cannot find module");
      if (args[0] === "--unknown") expect(result.stderr).toContain("Usage: bun run prompt:preview");
    }
  });
});

test("default package invocation emits only pretty capture JSON with isolated production defaults", async () => {
  const preview = await capture([]);
  expect(preview.preview).toMatchObject({
    context: "isolated",
    role: "root",
    rootMode: "orchestrator",
    transientSession: true,
  });
  expect(preview.preview.excluded).toContain("all external project files and guidance");
  expect(preview.preview.excluded).toContain("global and project settings/packages");
  expect(preview.systemPrompt).toContain("Shared work is simpler in one place. Extra worktrees cost care,");
  expect(preview.systemPrompt).not.toContain("You lead work.");
  expect(JSON.stringify(preview.messages)).toContain("Preview this request without sending it to a model.");
  expect(await Bun.file(join(preview.preview.cwd, ".keep")).exists()).toBe(false);
});

test("project, mode, message and goal arguments reach capture without changing disclosure or project state", async () => {
  const project = await mkdtemp(join(tmpdir(), "bruv-preview-cli-project-"));
  try {
    await mkdir(join(project, ".bruv"));
    await writeFile(join(project, ".bruv/SYSTEM.md"), "CLI_PROJECT_BASE");
    await writeFile(join(project, ".bruv/APPEND_SYSTEM.md"), "CLI_PROJECT_APPEND");
    await writeFile(join(project, ".bruv/settings.json"), '{"packages":["npm:must-not-install"]}');
    const before = await readdir(join(project, ".bruv"));
    const preview = await capture([
      "--project",
      relative(repo, project),
      "--role",
      "root",
      "--mode",
      "normal",
      "--mode",
      "fast",
      "--message",
      "superseded-message",
      "--message",
      "-h",
      "--goal",
      "CLI_GOAL",
    ]);
    expect(preview.preview).toMatchObject({
      context: "selected-project",
      cwd: project,
      role: "root",
      rootMode: "fast",
    });
    expect(preview.preview.included).toContain(join(project, ".bruv/SYSTEM.md"));
    expect(preview.preview.included).toContain("representative paused goal state");
    expect(preview.preview.excluded).toContain("global and project settings/packages");
    expect(preview.systemPrompt).toContain("CLI_PROJECT_BASE");
    expect(preview.systemPrompt).toContain("CLI_PROJECT_APPEND");
    expect(JSON.stringify(preview.messages)).toContain("CLI_GOAL");
    expect(preview.messages).toContainEqual(
      expect.objectContaining({ role: "user", content: [{ type: "text", text: "-h" }] }),
    );
    expect(JSON.stringify(preview.messages)).not.toContain("superseded-message");
    expect(await readdir(join(project, ".bruv"))).toEqual(before);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("child role arguments keep explicit identity and the API's root-only mode restriction", async () => {
  for (const role of ["fast", "normal", "orchestrator"] as const) {
    const preview = await capture(["--role", role]);
    expect(preview.preview.role).toBe(role);
    expect(preview.preview.rootMode).toBeUndefined();
    expect(preview.systemPrompt).toContain("You are a " + role + " sub-agent.");
  }
  const result = await run(["--role", "normal", "--mode", "fast"], repo);
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("rootMode applies only to the root role");
});
