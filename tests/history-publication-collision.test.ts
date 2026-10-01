import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a publication collision leaves SessionManager unchanged and permits recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-history-publication-"));
  try {
    const script = String.raw`
      const { readFileSync, rmSync, writeFileSync } = await import("node:fs");
      const { installDiskBackedSessionManager } = await import("./src/history/session-manager.ts");
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");
      installDiskBackedSessionManager();
      const manager = SessionManager.create(process.env.PUBLICATION_ROOT, process.env.PUBLICATION_ROOT);
      const setup = manager.appendThinkingLevelChange("off");
      const file = manager.getSessionFile();
      const before = {
        leaf: manager.getLeafId(),
        entries: manager.getEntries().map(({ id, parentId, type }) => ({ id, parentId, type })),
        branch: manager.getBranch().map(({ id }) => id),
      };
      writeFileSync(file, "collision sentinel\n");
      let errorCode;
      try {
        manager.appendMessage({ role: "user", content: "failed", timestamp: 2 });
      } catch (error) {
        errorCode = error.code;
      }
      const failed = {
        errorCode,
        leaf: manager.getLeafId(),
        entries: manager.getEntries().map(({ id, parentId, type }) => ({ id, parentId, type })),
        branch: manager.getBranch().map(({ id }) => id),
        target: readFileSync(file, "utf8"),
      };
      rmSync(file);
      const recoveredId = manager.appendMessage({ role: "user", content: "recovered", timestamp: 3 });
      const persisted = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      console.log(JSON.stringify({ setup, before, failed, recoveredId, persisted }));
    `;
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, PUBLICATION_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.failed.errorCode).toBe("EEXIST");
    expect(result.failed.target).toBe("collision sentinel\n");
    expect(result.failed.leaf).toBe(result.before.leaf);
    expect(result.failed.entries).toEqual(result.before.entries);
    expect(result.failed.branch).toEqual(result.before.branch);
    expect(result.before.leaf).toBe(result.setup);
    expect(result.persisted.map((entry: { id: string }) => entry.id)).toEqual([
      expect.any(String),
      result.setup,
      result.recoveredId,
    ]);
    expect(
      result.persisted.some(
        (entry: { message?: { content?: unknown } }) =>
          JSON.stringify(entry.message?.content)?.includes("failed") === true,
      ),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
