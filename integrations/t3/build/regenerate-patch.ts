import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sourcePin from "../upstream/source.json";
import { verifyWebSource } from "./verify-source";

/** Export the actual patched source, including file renames and Git blob IDs.
 * A disposable index keeps the developer's staging area untouched.
 */
export async function regenerateWebPatch(
  source: string,
  patch = resolve(import.meta.dir, "../upstream/bruv.patch"),
  revision = sourcePin.revision,
): Promise<void> {
  const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== revision) throw new Error("T3 checkout does not match integrations/t3/upstream/source.json");
  const temporary = await mkdtemp(join(tmpdir(), "bruv-web-patch-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, "index") };
  const git = (args: string[]) => execFileSync("git", ["-C", source, ...args], { env, maxBuffer: 32 * 1024 * 1024 });
  try {
    git(["read-tree", "HEAD"]);
    git(["add", "--all"]);
    const exported = join(temporary, "bruv.patch");
    await writeFile(exported, git(["diff", "--cached", "--binary", "--full-index", "HEAD"]));
    await verifyWebSource(source, exported);
    await writeFile(patch, await readFile(exported));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const source = process.argv[2];
  if (!source) throw new Error("Usage: bun integrations/t3/build/regenerate-patch.ts <patched-checkout>");
  await regenerateWebPatch(resolve(source));
}
