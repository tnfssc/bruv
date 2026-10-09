import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Optional client-side capabilities. No automatic grants, credential discovery or shell execution. */
export const CAPABILITY_MAX_BYTES = 16 * 1024;
export type CapabilityKind = "repo.read" | `tool:${string}` | `skill:${string}`;
export type Grant = Readonly<{ id: string; taskId: string; repoRoot: string; kinds: readonly CapabilityKind[] }>;
export type Request = Readonly<{ id: string; grantId: string; taskId: string; kind: CapabilityKind; input: string }>;
export type Reply = Readonly<{ requestId: string; grantId: string; taskId: string; value?: string; error?: string }>;
const inside = (root: string, target: string) => {
  const rel = relative(root, target);
  return !!rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** Bounded, fatal UTF-8 read; reject symlinks at every path element. Node path-based APIs
 * cannot promise confinement against a hostile process concurrently replacing ancestors. */
export async function readGrantedRepoFile(root: string, name: string): Promise<string> {
  if (!name || name.includes("\0") || isAbsolute(name) || name.split(/[/]/).includes(".."))
    throw new Error("Invalid relative repo file");
  const target = resolve(root, name);
  if (!inside(root, target)) throw new Error("Outside granted repo");
  let part = root;
  for (const piece of relative(root, target).split(sep)) {
    part = resolve(part, piece);
    const st = await lstat(part);
    if (st.isSymbolicLink()) throw new Error("Repo symlink denied");
    if (part !== target && !st.isDirectory()) throw new Error("Not a directory");
  }
  if (!inside(root, await realpath(target))) throw new Error("Outside granted repo");
  const fd = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await fd.stat()).isFile()) throw new Error("Not a regular file");
    const buf = Buffer.alloc(CAPABILITY_MAX_BYTES + 1);
    let used = 0;
    while (used < buf.length) {
      const { bytesRead } = await fd.read(buf, used, buf.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > CAPABILITY_MAX_BYTES) throw new Error("Repo file exceeds read limit");
    return new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, used));
  } finally {
    await fd.close();
  }
}
