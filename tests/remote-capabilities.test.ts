import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGrantedRepoFile, CAPABILITY_MAX_BYTES } from "../src/remote/capabilities";
let dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});
async function repo() {
  const d = await mkdtemp(join(tmpdir(), "bruv-cap-"));
  dirs.push(d);
  await mkdir(join(d, "sub"));
  await writeFile(join(d, "sub", "ok.txt"), "hello");
  return d;
}
test("traversal, symlink, oversized, binary and nonregular denied", async () => {
  const root = await repo();
  await symlink(tmpdir(), join(root, "escape"));
  await writeFile(join(root, "huge"), "x".repeat(CAPABILITY_MAX_BYTES + 1));
  await writeFile(join(root, "binary"), new Uint8Array([255]));
  for (const name of ["../secret", "/etc/passwd", "escape/a", "huge", "binary", "sub"]) {
    expect(readGrantedRepoFile(root, name)).rejects.toThrow();
  }
});
