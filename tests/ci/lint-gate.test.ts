import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");

test("the shared CI lint command rejects warnings, but accepts clean files", () => {
  const scratch = join(repo, ".tmp");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "lint-gate-"));
  try {
    copyFileSync(join(repo, "package.json"), join(root, "package.json"));
    const config = JSON.parse(readFileSync(join(repo, "biome.json"), "utf8"));
    // This fixture lives in ignored scratch, but its source must still be checked.
    config.vcs = { enabled: false };
    writeFileSync(join(root, "biome.json"), JSON.stringify(config));
    const source = join(root, "fixture.ts");
    const env = { ...process.env, PATH: `${join(repo, "node_modules/.bin")}:${process.env.PATH}` };
    const lint = () => spawnSync(process.execPath, ["run", "lint"], { cwd: root, env, encoding: "utf8" });

    writeFileSync(source, "export const answer = 42;\n");
    const clean = lint();
    expect(clean.status).toBe(0);

    writeFileSync(source, "export const echo = (value: any) => value;\n");
    const ordinary = spawnSync(join(repo, "node_modules/.bin/biome"), ["lint", "."], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    expect(ordinary.status).toBe(0);
    expect(ordinary.stdout + ordinary.stderr).toContain("lint/suspicious/noExplicitAny");
    const strict = lint();
    expect(strict.status).toBe(1);
    expect(strict.stdout + strict.stderr).toContain("lint/suspicious/noExplicitAny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
