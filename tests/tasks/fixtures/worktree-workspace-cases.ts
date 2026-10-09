import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { JobService } from "../../../src/tasks/job-service";
import { TaskManager } from "../../../src/tasks/task-manager";
import { createWorktree, readWorktreeSetup, resolveWorktreeSource } from "../../../src/tasks/worktree-workspace";

// Loaded only by the owned child of worktree-workspace.test.ts, after SDK/HOME isolation.
const runtimeRoot = process.env.BRUV_WORKTREE_TEST_ROOT!;

async function fixture() {
  const root = await mkdtemp(join(runtimeRoot, "case-"));
  const repo = join(root, "repo");
  const sessionDir = join(root, "sessions");
  await mkdir(repo);
  await mkdir(sessionDir);
  const git = (args: string[]) => execFileSync("git", args, { env: process.env });
  git(["init", "-q", repo]);
  git(["-C", repo, "config", "user.email", "test@example.invalid"]);
  git(["-C", repo, "config", "user.name", "Bruv Test"]);
  await writeFile(join(repo, "tracked.txt"), "committed\n");
  git(["-C", repo, "add", "tracked.txt"]);
  git(["-C", repo, "commit", "-qm", "base"]);
  return { root, repo, sessionDir, worktrees: join(root, "worktrees") };
}

// The child runtime owns environment and workspace roots; this scope only owns/drains jobs.
// All repositories, worktrees, SDK state and journals are retained for audit.
async function withWorktreeJobs(run: (manager: TaskManager, service: JobService) => Promise<void>) {
  const manager = new TaskManager(() => {}, 25);
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    undefined,
    join(runtimeRoot, "profiles.json"),
    undefined,
    undefined,
    {},
  );
  try {
    await run(manager, service);
  } finally {
    await manager.shutdown();
  }
}

describe("local worktree workspace", () => {
  test("parses JSONC setup and preserves async false", async () => {
    const { repo } = await fixture();
    await writeFile(
      join(repo, "t3.json"),
      `{
      // portable setup
      "scripts": [{
        "name": "setup",
        "command": "printf ',} // literal' > setup.txt",
        "runOnWorktreeCreate": true,
        "async": false,
      }],
    }`,
    );
    expect(await readWorktreeSetup(repo)).toMatchObject({
      command: "printf ',} // literal' > setup.txt",
      async: false,
      configDigest: expect.any(String),
    });
  });

  test("JSONC preserves escaped strings and hashes original config bytes", async () => {
    const { repo } = await fixture();
    const command = 'printf "/* literal */ //,} \\"quoted\\""';
    const text =
      '{/* setup */ "scripts": [' +
      JSON.stringify({ name: "setup", command, runOnWorktreeCreate: true }) +
      ", // trailing comment\n],}";
    await writeFile(join(repo, "t3.json"), text);
    expect(await readWorktreeSetup(repo)).toEqual({
      command,
      async: true,
      configDigest: createHash("sha256").update(text).digest("hex"),
    });
  });

  test("rejects malformed JSONC that the removed scanner silently accepted", async () => {
    const { repo } = await fixture();
    // The scanner erased an unclosed comment and accepted a comma-only array.
    for (const text of ['{"scripts": []} /* unfinished', '{"scripts": [,]}']) {
      await writeFile(join(repo, "t3.json"), text);
      await expect(readWorktreeSetup(repo)).rejects.toThrow("Invalid t3.json");
    }
  });

  test("keeps config size and setup schema checks", async () => {
    const { repo } = await fixture();
    await writeFile(join(repo, "t3.json"), " ".repeat(1_000_001));
    await expect(readWorktreeSetup(repo)).rejects.toThrow("Unable to read t3.json");
    await writeFile(join(repo, "t3.json"), '{"scripts":[{"name":"setup","command":"echo ok","async":"false"}]}');
    await expect(readWorktreeSetup(repo)).rejects.toThrow("Invalid t3.json script async");
  });

  test("pins one commit and creates argv-safe retained branches without dirty files", async () => {
    const { repo, worktrees } = await fixture();
    await writeFile(join(repo, "tracked.txt"), "dirty\n");
    await writeFile(join(repo, "secret.env"), "not copied\n");
    const source = await resolveWorktreeSource(repo);
    const first = await createWorktree(source, {
      taskId: "task_one",
      title: "feature; touch PWNED",
      root: worktrees,
    });
    const second = await createWorktree(source, { taskId: "task_two", root: worktrees });
    expect(first.baseOid).toBe(second.baseOid);
    expect(first.path).not.toBe(second.path);
    expect(first.branch).toMatch(/^bruv\/feature-touch-pwned-/);
    expect(await readFile(join(first.path, "tracked.txt"), "utf8")).toBe("committed\n");
    await expect(readFile(join(first.path, "secret.env"), "utf8")).rejects.toThrow();
    expect(
      execFileSync("git", ["-C", first.path, "rev-parse", "HEAD"], { encoding: "utf8", env: process.env }).trim(),
    ).toBe(source.baseOid);
  });

  test("rejects one explicit branch for a prompt batch before workspace side effects", async () => {
    const manager = new TaskManager(() => {});
    const service = new JobService(
      manager,
      () => ({ depth: 0 }),
      undefined,
      join(runtimeRoot, "profiles.json"),
      undefined,
      undefined,
      {},
    );
    try {
      await expect(
        service.handle(
          "subagent",
          { prompts: ["one", "two"], workspace: { kind: "worktree", branch: "one-branch" } },
          { cwd: runtimeRoot } as never,
          new AbortController().signal,
        ),
      ).rejects.toThrow("A workspace branch can only be set for one prompt.");
      expect(manager.list()).toHaveLength(0);
    } finally {
      await manager.shutdown();
    }
  });

  test("rejects option/control refs, invalid task identities, and managed path collisions", async () => {
    const { repo, worktrees } = await fixture();
    await expect(resolveWorktreeSource(repo, "--help")).rejects.toThrow("Invalid worktree base ref");
    await expect(resolveWorktreeSource(repo, "HEAD\nmain")).rejects.toThrow("Invalid worktree base ref");
    const source = await resolveWorktreeSource(repo);
    await expect(createWorktree(source, { taskId: "task_ok/alias", root: worktrees })).rejects.toThrow(
      "Invalid workspace task ID",
    );
    await expect(createWorktree(source, { taskId: "task_bad", branch: "-bad", root: worktrees })).rejects.toThrow(
      "Invalid worktree branch",
    );
    const first = await createWorktree(source, { taskId: "task_collision", root: worktrees });
    await expect(
      createWorktree(source, { taskId: "task_collision", branch: "another", root: worktrees }),
    ).rejects.toThrow("already exists");
    expect(first.path).toContain(worktrees);
  });

  test("rejects branch reuse rather than resetting it", async () => {
    const { repo, worktrees } = await fixture();
    const source = await resolveWorktreeSource(repo);
    await createWorktree(source, { taskId: "task_one", branch: "kept", root: worktrees });
    await expect(createWorktree(source, { taskId: "task_two", branch: "kept", root: worktrees })).rejects.toThrow(
      "already exists",
    );
  });
  test("waitSeconds zero returns a cancellable child while blocking setup is still preparing", async () => {
    const { repo, sessionDir } = await fixture();
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "sleep 30",
            runOnWorktreeCreate: true,
            async: false,
          },
        ],
      }),
    );
    await withWorktreeJobs(async (manager, service) => {
      const started = Date.now();
      const result = (await service.handle(
        "subagent",
        {
          prompt: "blocked",
          workspace: { kind: "worktree" },
          waitSeconds: 0,
        },
        {
          cwd: repo,
          sessionManager: {
            getSessionDir: () => sessionDir,
            getSessionFile: () => undefined,
            getSessionId: () => undefined,
          },
          model: { provider: "test", id: "model" },
          isProjectTrusted: () => true,
        } as never,
        new AbortController().signal,
      )) as { id: string; workspace: { preparationStatus: string } };
      expect(Date.now() - started).toBeLessThan(2000);
      expect(result.id).toMatch(/^task_/);
      expect(result.workspace.preparationStatus).toBe("preparing");
      for (let attempt = 0; attempt < 100 && !manager.inspect(result.id).workspace?.setupTaskId; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      manager.kill(result.id);
      const stopped = await manager.wait(result.id);
      expect(stopped.status).toBe("killed");
      expect(stopped.workspace?.preparationStatus).toBe("failed");
      expect(stopped.workspace?.setupTaskId).toBeTruthy();
      if (stopped.workspace?.setupTaskId)
        expect((await manager.wait(stopped.workspace.setupTaskId)).status).toBe("killed");
    });
  });

  test("the child deadline includes worktree setup and prevents provider start", async () => {
    const { repo, sessionDir } = await fixture();
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "sleep 30",
            runOnWorktreeCreate: true,
            async: false,
          },
        ],
      }),
    );
    await withWorktreeJobs(async (manager, service) => {
      const result = (await service.handle(
        "subagent",
        {
          prompt: "timeout",
          workspace: { kind: "worktree" },
          waitSeconds: 0,
          timeoutSeconds: 0.1,
        },
        {
          cwd: repo,
          sessionManager: {
            getSessionDir: () => sessionDir,
            getSessionFile: () => undefined,
            getSessionId: () => undefined,
          },
          model: { provider: "test", id: "model" },
          isProjectTrusted: () => true,
        } as never,
        new AbortController().signal,
      )) as { id: string };
      const stopped = await manager.wait(result.id);
      expect(stopped.status).toBe("killed");
      expect(stopped.timedOut).toBe(true);
      expect(stopped.pid).toBeUndefined();
      expect(stopped.workspace?.preparationError).toBe("timed out");
    });
  });

  test("repository setup runs automatically without trust approval while child trust remains denied", async () => {
    const { root, repo, sessionDir } = await fixture();
    const markerPath = join(root, "setup-ran");
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "touch " + markerPath,
            runOnWorktreeCreate: true,
            async: false,
          },
        ],
      }),
    );
    await withWorktreeJobs(async (manager, service) => {
      const oldArgv = process.argv;
      process.argv = [
        oldArgv[0],
        oldArgv[1],
        "--system-prompt",
        "fixture-system",
        "--append-system-prompt",
        "fixture-append",
        "--",
        "--system-prompt",
        "do-not-copy",
      ];
      const activate = spyOn(manager, "activatePreparedAgent");
      try {
        const result = (await service.handle(
          "subagent",
          {
            prompt: "untrusted",
            title: "Inspect worktree",
            workspace: { kind: "worktree" },
            waitSeconds: 0,
          },
          {
            cwd: repo,
            sessionManager: {
              getSessionDir: () => sessionDir,
              getSessionFile: () => undefined,
              getSessionId: () => undefined,
            },
            model: { provider: "test", id: "model" },
            isProjectTrusted: () => false,
          } as never,
          new AbortController().signal,
        )) as { id: string };
        for (let attempt = 0; attempt < 100; attempt++) {
          const current = manager.inspect(result.id);
          if (current.workspace?.setupStatus === "completed" && current.workspace.preparationStatus !== "preparing")
            break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const current = manager.inspect(result.id);
        expect(current.title).toBe("Inspect worktree");
        expect(activate.mock.calls[0]?.[1].title).toBe("Inspect worktree");
        expect(current.workspace?.setupStatus).toBe("completed");
        const launch = activate.mock.calls[0]![1];
        expect(launch.args).toEqual([
          "--no-approve",
          "--system-prompt",
          "fixture-system",
          "--append-system-prompt",
          "fixture-append",
          "--session",
          launch.agent!.sessionFile,
          "--mode",
          "json",
          "-p",
          "--model",
          "test/model",
          "--",
          "untrusted",
        ]);
        expect(launch).toMatchObject({
          id: result.id,
          cwd: current.workspace!.path,
          closeStdin: true,
          // waitSeconds:0 transfers actual background ownership at reservation/spawn.
          notifyOnComplete: true,
          env: { BRUV_SUBAGENT_DEPTH: "1", BRUV_SUBAGENT_TYPE: "normal" },
        });
        expect(dirname(launch.agent!.sessionFile)).toBe(sessionDir);
        expect(await readFile(launch.agent!.sessionFile, "utf8")).toContain("bruv-agent");
        // The reserved task owns the deadline from preparation onward.
        expect(launch.timeoutMs).toBeUndefined();
        expect(await readFile(markerPath, "utf8")).toBe("");
        if (current.status === "running") manager.kill(result.id);
      } finally {
        process.argv = oldArgv;
        activate.mockRestore();
      }
    });
  });

  test("async setup allows activation before settling and publishes its eventual failure", async () => {
    const { root, repo, sessionDir } = await fixture();
    const releasePath = join(root, "release-setup");
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "/bin/sh -c 'while [ ! -f \"" + releasePath + "\" ]; do sleep 0.01; done; exit 7'",
            runOnWorktreeCreate: true,
            async: true,
          },
        ],
      }),
    );
    await withWorktreeJobs(async (manager, service) => {
      const activate = spyOn(manager, "activatePreparedAgent");
      try {
        const result = (await service.handle(
          "subagent",
          { prompt: "async setup", workspace: { kind: "worktree" }, waitSeconds: 0 },
          {
            cwd: repo,
            sessionManager: {
              getSessionDir: () => sessionDir,
              getSessionFile: () => undefined,
              getSessionId: () => undefined,
            },
            model: { provider: "test", id: "model" },
            isProjectTrusted: () => false,
          } as never,
          new AbortController().signal,
        )) as { id: string };
        for (let attempt = 0; attempt < 100 && !activate.mock.calls.length; attempt++)
          await new Promise((resolve) => setTimeout(resolve, 5));
        expect(activate.mock.calls).toHaveLength(1);
        const launch = activate.mock.calls[0]![1];
        expect(dirname(launch.agent!.sessionFile)).toBe(sessionDir);
        expect(await readFile(launch.agent!.sessionFile, "utf8")).toContain("bruv-agent");
        expect(launch.env).toMatchObject({
          HOME: process.env.HOME,
          PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
          BRUV_CODING_AGENT_DIR: process.env.BRUV_CODING_AGENT_DIR,
        });
        const workspace = manager.inspect(result.id).workspace!;
        expect(workspace.preparationStatus).toBe("ready");
        expect(workspace.setupStatus).toBe("running");
        const setupId = workspace.setupTaskId!;
        expect(manager.inspect(setupId).status).toBe("running");
        await writeFile(releasePath, "");
        expect((await manager.wait(setupId)).exitCode).toBe(7);
        expect(manager.inspect(result.id).workspace?.setupStatus).toBe("failed");
      } finally {
        activate.mockRestore();
      }
    });
  });

  test("a synchronous setup failure retains every batch identity without killing siblings", async () => {
    const { repo, sessionDir } = await fixture();
    await writeFile(
      join(repo, "t3.json"),
      JSON.stringify({
        scripts: [
          {
            name: "setup",
            command: "case $(git branch --show-current) in *agent-2*) exit 9;; esac",
            runOnWorktreeCreate: true,
            async: false,
          },
        ],
      }),
    );
    await withWorktreeJobs(async (manager, service) => {
      const results = (await service.handle(
        "subagent",
        {
          prompts: ["one", "two", "three"],
          workspace: { kind: "worktree" },
          waitSeconds: 0,
        },
        {
          cwd: repo,
          sessionManager: {
            getSessionDir: () => sessionDir,
            getSessionFile: () => undefined,
            getSessionId: () => undefined,
          },
          model: { provider: "test", id: "model" },
          isProjectTrusted: () => true,
        } as never,
        new AbortController().signal,
      )) as Array<{ id: string }>;
      expect(new Set(results.map((item) => item.id)).size).toBe(3);
      const second = await manager.wait(results[1].id);
      expect(second.status).toBe("failed");
      expect(second.workspace?.path).not.toBe(repo);
      expect(manager.inspect(results[0].id).termination).toBeUndefined();
      expect(manager.inspect(results[2].id).termination).toBeUndefined();
    });
  });
});
