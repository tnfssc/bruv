import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGrantedRepoFile, CAPABILITY_MAX_BYTES } from "../../src/remote/capabilities";

test("granted reads stay inside the repository without following symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-cap-"));
  try {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "ok.txt"), "hello");
    await symlink(tmpdir(), join(root, "escape"));

    expect(await readGrantedRepoFile(root, "sub/ok.txt")).toBe("hello");
    await expect(readGrantedRepoFile(root, "../secret")).rejects.toThrow("Invalid relative repo file");
    await expect(readGrantedRepoFile(root, "/etc/passwd")).rejects.toThrow("Invalid relative repo file");
    await expect(readGrantedRepoFile(root, "escape/a")).rejects.toThrow("Repo symlink denied");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("granted reads require bounded UTF-8 regular files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-cap-"));
  try {
    await writeFile(join(root, "huge"), "x".repeat(CAPABILITY_MAX_BYTES + 1));
    await writeFile(join(root, "binary"), new Uint8Array([255]));
    await mkdir(join(root, "sub"));

    await expect(readGrantedRepoFile(root, "huge")).rejects.toThrow("Repo file exceeds read limit");
    await expect(readGrantedRepoFile(root, "binary")).rejects.toThrow(TypeError);
    await expect(readGrantedRepoFile(root, "sub")).rejects.toThrow("Not a regular file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
