import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The store is process-shared. Give the contract suite its own temp root so it
// cannot expire or consume snapshots belonging to another test or live session.
test("transcript snapshot filesystem contracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-snapshot-contracts-"));
  try {
    const child = Bun.spawn([process.execPath, "test", join(import.meta.dir, "fixtures/transcript-snapshots.ts")], {
      env: { ...process.env, TMPDIR: root, BRUV_SNAPSHOT_TEST_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, output: "" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
