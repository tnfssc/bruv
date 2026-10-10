import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("compiled web --setup guidance does not launch overrides or modify existing CLI/Claude/T3 state", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-external-web-"));
  try {
    for (const directory of [".claude", ".bruv/agent", ".bruv/web"]) {
      await mkdir(join(home, directory), { recursive: true });
      await writeFile(join(home, directory, "settings.json"), "leave alone");
    }
    const override = join(home, "old-server");
    await writeFile(override, '#!/bin/sh\ntouch "$HOME/launched"\n', { mode: 0o755 });
    const child = Bun.spawn([resolve(import.meta.dir, "../../dist/bruv"), "web", "--setup"], {
      env: { HOME: home, PATH: "/nonexistent", BRUV_WEB_SERVER: override },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(errors).toBe("");
    expect(output).toContain("Setup guide only.");
    expect(await Bun.file(join(home, "launched")).exists()).toBe(false);
    expect(await Bun.file(join(home, ".cache")).exists()).toBe(false);
    for (const directory of [".claude", ".bruv/agent", ".bruv/web"]) {
      expect(await readdir(join(home, directory))).toEqual(["settings.json"]);
      expect(await readFile(join(home, directory, "settings.json"), "utf8")).toBe("leave alone");
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
