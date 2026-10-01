/** Local native proof only. Not packaging: the real cached web archive has no manifest. */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { adaptPiHostFile, piHostPatches } from "./pi-host-adaptation";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
if (args.length !== 2) throw Error("Usage: bun scripts/tasks-ui-proof-build.ts REAL_WEB_ARCHIVE OUTPUT_BINARY");
const archive = resolve(args[0]);
const outfile = resolve(args[1]);
const git = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw Error(r.stderr);
  return r.stdout.trim();
};
if (git("status", "--porcelain", "--untracked-files=no")) throw Error("Commit tracked source before building proof");
const sourceCommit = git("rev-parse", "HEAD");
// Shared cached dependencies are read-only. Preparation may copy owned assets,
// but must not need to patch any shared Pi host file.
for (const patch of piHostPatches) {
  const before = await readFile(resolve(root, "node_modules/@earendil-works/pi-coding-agent", patch.path), "utf8");
  if (before !== adaptPiHostFile(patch, before))
    throw Error("Cached Pi host needs adaptation; refuse dependency writes");
}
await import("./prepare-assets");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = await readFile(archive);
await mkdir(resolve(root, "dist"), { recursive: true });
if (archive !== resolve(root, "dist/bruv-web.archive.gz")) {
  // Replace the owned link/file, never copy through a pre-existing cache symlink.
  const embedded = resolve(root, "dist/bruv-web.archive.gz");
  await rm(embedded, { force: true });
  await symlink(archive, embedded);
}
await mkdir(dirname(outfile), { recursive: true });
const result = await Bun.build({ entrypoints: [resolve(root, "src/cli.ts")], compile: { outfile }, minify: true });
if (!result.success) throw new AggregateError(result.logs, "Native proof compile failed");
if (git("rev-parse", "HEAD") !== sourceCommit || git("status", "--porcelain", "--untracked-files=no"))
  throw Error("Source changed during compilation; discard binary");
const record = {
  purpose: "local native UI proof, not packaging or release",
  sourceCommit,
  sourceRoot: root,
  trackedSourceClean: true,
  archive,
  archiveSha256: hash(bytes),
  archiveManifest: null,
  binary: outfile,
  binarySha256: hash(await readFile(outfile)),
  bunVersion: Bun.version,
  builtAt: new Date().toISOString(),
};
await Bun.write(outfile + ".build.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
