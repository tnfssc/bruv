import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyWebSource } from "./verify-source";

test("source verification applies both patches and rejects unreviewed changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-source-test-"));
  const repo = join(dir, "source");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  try {
    git("init", "-q");
    await writeFile(join(repo, "input.txt"), "base\n");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-qm", "base");
    await writeFile(join(repo, "input.txt"), "first\n");
    const first = join(dir, "first.patch");
    await writeFile(first, git("diff"));
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-qm", "first");
    await writeFile(join(repo, "input.txt"), "second\n");
    const second = join(dir, "second.patch");
    await writeFile(second, git("diff"));
    git("reset", "-q", "--mixed", "HEAD~1");
    await verifyWebSource(repo, [first, second]);
    await writeFile(join(repo, "input.txt"), "unreviewed\n");
    await expect(verifyWebSource(repo, [first, second])).rejects.toThrow("differs");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
