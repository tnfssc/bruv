import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedFixtureEnv } from "../helpers/helpers";

// Import production/SDK modules only inside the isolated child, never the test launcher's HOME.
if (process.env.BRUV_WORKTREE_TEST_ROOT) {
  await import("./fixtures/worktree-workspace-cases");
} else {
  test("worktree workspace journeys in a retained owned runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "bruv-worktree-test-"));
    const env = {
      ...ownedFixtureEnv(root),
      SHELL: "/bin/sh",
      BRUV_WORKTREE_TEST_ROOT: root,
      BRUV_WORKTREE_ROOT: join(root, "worktrees"),
    };
    const argv = [process.execPath, "test", "--preload", join(import.meta.dir, "../setup.ts"), import.meta.path];
    // A fresh cwd avoids inherited bunfig preloads; argv/env are recorded without human secrets.
    await writeFile(join(root, "launch.json"), JSON.stringify({ argv, cwd: root, env }, null, 2));
    const child = Bun.spawn(argv, { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await writeFile(join(root, "stdout.log"), stdout);
    await writeFile(join(root, "stderr.log"), stderr);
    expect(code, "Retained fixture: " + root + "\n" + stdout + "\n" + stderr).toBe(0);
  }, 30_000);
}
