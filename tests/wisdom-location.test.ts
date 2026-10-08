import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectWisdomDir } from "../src/wisdom/location";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function directory() {
  const root = await mkdtemp(join(tmpdir(), "bruv-wisdom-location-"));
  directories.push(root);
  return root;
}

async function settings(root: string, text: string) {
  await mkdir(join(root, ".bruv"), { recursive: true });
  await writeFile(join(root, ".bruv", "settings.json"), text);
}

test("without a project marker, wisdom stays at the supplied cwd rather than its parents", async () => {
  const root = await directory();
  const cwd = join(root, "src", "feature");
  await mkdir(cwd, { recursive: true });
  expect(projectWisdomDir(cwd, true)).toBe(join(cwd, "wisdom"));
});

test("the nearest marker owns the setting; a nested Git root does not inherit parent wisdom", async () => {
  const root = await directory();
  await mkdir(join(root, ".git"));
  await settings(root, '{"wisdomDir":"outer-notes"}');
  const nested = join(root, "nested");
  const cwd = join(nested, "src");
  await mkdir(cwd, { recursive: true });
  await settings(nested, '{"wisdomDir":"inner-notes"}');
  expect(projectWisdomDir(cwd, true)).toBe(join(nested, "inner-notes"));

  await rm(join(nested, ".bruv"), { recursive: true });
  await writeFile(join(nested, ".git"), "gitdir: /unused/worktree\n");
  expect(projectWisdomDir(cwd, true)).toBe(join(nested, "wisdom"));
});

test("symlinked cwd keeps its lexical path and settings symlinks are read normally", async () => {
  const container = await directory();
  const root = join(container, "checkout");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".bruv"));
  const configuration = join(container, "settings.json");
  await writeFile(configuration, '{"wisdomDir":"notes"}');
  await symlink(configuration, join(root, ".bruv", "settings.json"));
  const alias = join(container, "alias");
  await symlink(root, alias, "dir");
  expect(projectWisdomDir(join(alias, "src"), true)).toBe(join(alias, "notes"));
});

test("BOM-prefixed settings allow parent-relative directories without creating them", async () => {
  const container = await directory();
  const root = join(container, "checkout");
  await settings(root, '\uFEFF{"wisdomDir":"../shared-notes"}');
  const destination = join(container, "shared-notes");
  expect(projectWisdomDir(root, true)).toBe(destination);
  await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
});

test("malformed settings fail for trusted projects but are not parsed for untrusted projects", async () => {
  const root = await directory();
  await settings(root, "not JSON");
  expect(() => projectWisdomDir(root, true)).toThrow(SyntaxError);
  expect(projectWisdomDir(root, false)).toBe(join(root, "wisdom"));
});

test.skipIf(process.getuid?.() === 0)("settings permission errors are not treated as a missing setting", async () => {
  const root = await directory();
  await settings(root, '{"wisdomDir":"notes"}');
  await chmod(join(root, ".bruv", "settings.json"), 0o000);
  expect(() => projectWisdomDir(root, true)).toThrow(/EACCES/);
  expect(projectWisdomDir(root, false)).toBe(join(root, "wisdom"));
});
