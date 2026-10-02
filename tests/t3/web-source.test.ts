import { buildWeb } from "../../integrations/t3/build/build";
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenerateWebPatch } from "../../integrations/t3/build/regenerate-patch";
import { verifyWebSource } from "../../integrations/t3/build/verify-source";

test("web source verification requires the exact canonical patch without changing the real index", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-web-source-test-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  try {
    git("init", "--quiet");
    await writeFile(join(root, "source.ts"), "export const value = 1;\n");
    await writeFile(join(root, "obsolete.ts"), "removed by the canonical patch\n");
    await writeFile(join(root, ".gitignore"), "ignored-build/\ncanonical.patch\n");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture");
    await writeFile(join(root, "source.ts"), "export const value = 2;\n");
    await writeFile(join(root, "added.ts"), "export const added = true;\n");
    await rm(join(root, "obsolete.ts"));
    git("add", "-N", "added.ts");
    const patch = join(root, "canonical.patch");
    await writeFile(patch, git("diff", "--binary"));
    const before = await readFile(join(root, ".git/index"));
    await verifyWebSource(root, patch);
    expect(await readFile(join(root, ".git/index"))).toEqual(before);
    await writeFile(join(root, "obsolete.ts"), "unreviewed resurrection\n");
    await expect(verifyWebSource(root, patch)).rejects.toThrow("untracked");
    await rm(join(root, "obsolete.ts"));
    await writeFile(join(root, "source.ts"), "unreviewed mutation\n");
    await expect(verifyWebSource(root, patch)).rejects.toThrow("differs");
    await writeFile(join(root, "source.ts"), "export const value = 2;\n");
    await writeFile(join(root, "untracked.ts"), "unreviewed addition\n");
    await expect(verifyWebSource(root, patch)).rejects.toThrow("untracked");
    await rm(join(root, "untracked.ts"));
    await rm(join(root, "added.ts"));
    await expect(verifyWebSource(root, patch)).rejects.toThrow("differs");
    expect(await readFile(join(root, ".git/index"))).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical patch regeneration exports source renames without changing the real index", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-web-export-"));
  const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  try {
    git(["init", "-q"]);
    await writeFile(join(root, "DieService.ts"), "export const service = 'die_task_launch';\n");
    git(["add", "DieService.ts"]);
    git(["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "base"]);
    const revision = git(["rev-parse", "HEAD"]).trim();
    const before = await readFile(join(root, ".git/index"));
    await rm(join(root, "DieService.ts"));
    await writeFile(join(root, "BruvService.ts"), "export const service = 'bruv_task_launch';\n");
    const patch = join(root, ".git", "bruv.patch");
    await expect(regenerateWebPatch(root, patch, "wrong-revision")).rejects.toThrow("source.json");
    await regenerateWebPatch(root, patch, revision);
    expect(await readFile(patch, "utf8")).toContain("+++ b/BruvService.ts");
    expect(await readFile(patch, "utf8")).toContain("bruv_task_launch");
    await verifyWebSource(root, patch);
    expect(await readFile(join(root, ".git/index"))).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepared source rejection preserves an existing packed-web receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-web-prepared-test-"));
  const artifactRoot = await mkdtemp(join(tmpdir(), "bruv-web-receipt-test-"));
  const receipt = join(artifactRoot, "dist/bruv-web.archive.manifest.json");
  const previous = process.env.BRUV_T3_SOURCE;
  try {
    execFileSync("git", ["-C", root, "init", "--quiet"]);
    await writeFile(join(root, "source.ts"), "export const value = 1;\n");
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    process.env.BRUV_T3_SOURCE = root;
    await Bun.write(receipt, "existing verified receipt\n");
    await expect(buildWeb({ prepared: true, root: artifactRoot })).rejects.toThrow(
      "does not match integrations/t3/upstream/source.json",
    );
    expect(await readFile(receipt, "utf8")).toBe("existing verified receipt\n");
  } finally {
    if (previous === undefined) delete process.env.BRUV_T3_SOURCE;
    else process.env.BRUV_T3_SOURCE = previous;
    await rm(root, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
