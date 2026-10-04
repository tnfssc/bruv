import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "scripts/smoke.sh");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bruv-smoke-test-"));
  roots.push(root);
  await mkdir(join(root, "bin"));
  await mkdir(join(root, "dist"));
  await writeFile(
    join(root, "bin/bun"),
    '#!/bin/sh\nif [ "$1" = run ] && [ "$2" = build ]; then\n  echo build >> builds\n  cp fixture-bruv dist/bruv\n  cp fixture-connector dist/bruv-claude-compat\n  exit\nfi\nif [ "$1" = -e ]; then\n  echo 1.2.3\n  exit\nfi\nexit 1\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(root, "fixture-bruv"),
    '#!/bin/sh\ncase "$1" in\n  --version) /bin/mkdir -p "$HOME/.bruv"; echo 1.2.3 ;;\n  --help) /bin/mkdir -p "$HOME/.bruv"; echo "bruv - AI coding assistant" ;;\n  web) echo "external, unmodified T3" ;;\nesac\n',
    { mode: 0o755 },
  );
  await writeFile(join(root, "fixture-connector"), '#!/bin/sh\necho "bruv-claude-compat 1.2.3"\n', {
    mode: 0o755,
  });
  const run = (args: string[] = []) =>
    Bun.spawnSync(["/bin/sh", script, ...args], {
      cwd: root,
      env: { ...process.env, PATH: join(root, "bin") + ":/usr/bin:/bin" },
      stdout: "pipe",
      stderr: "pipe",
    });
  const builds = async () => (await readFile(join(root, "builds"), "utf8")).trim().split("\n").length;
  return { root, run, builds };
}

test("standalone smoke builds by default, while explicit reuse keeps the same CLI checks without rebuilding", async () => {
  const { root, run, builds } = await fixture();
  expect(run().exitCode).toBe(0);
  expect(await builds()).toBe(1);
  expect(run(["--reuse-build"]).exitCode).toBe(0);
  expect(await builds()).toBe(1);
  // Reuse must still check both versions and the side-effect-free web guidance.
  await writeFile(join(root, "dist/bruv-claude-compat"), '#!/bin/sh\necho "bruv-claude-compat wrong-version"\n', {
    mode: 0o755,
  });
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  await writeFile(join(root, "dist/bruv-claude-compat"), await readFile(join(root, "fixture-connector")), {
    mode: 0o755,
  });
  await writeFile(
    join(root, "dist/bruv"),
    (await readFile(join(root, "fixture-bruv"), "utf8")).replace("external, unmodified T3", "bundled web"),
    { mode: 0o755 },
  );
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  // Reuse must still execute the CLI version/help assertions.
  await writeFile(join(root, "dist/bruv"), "#!/bin/sh\necho wrong-version\n", { mode: 0o755 });
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  expect(await builds()).toBe(1);
});

test("reuse requires an executable pair and invalid arguments cannot trigger a build", async () => {
  const { root, run } = await fixture();
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  await writeFile(join(root, "dist/bruv"), "not executable");
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  await writeFile(join(root, "dist/bruv"), await readFile(join(root, "fixture-bruv")), { mode: 0o755 });
  await chmod(join(root, "dist/bruv"), 0o755);
  expect(run(["--reuse-build"]).stderr.toString()).toContain("requires executable ./dist/bruv-claude-compat");
  await writeFile(join(root, "dist/bruv-claude-compat"), "not executable", { mode: 0o644 });
  expect(run(["--reuse-build"]).exitCode).not.toBe(0);
  for (const args of [["--unknown"], ["--reuse-build", "--unknown"], ["--", "--reuse-build"]]) {
    const result = run(args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("usage:");
  }
  expect(await Bun.file(join(root, "builds")).exists()).toBe(false);
});

test("CI and release smoke reuse their preceding build", async () => {
  const ci = await Bun.file(join(import.meta.dir, "..", ".github/workflows/ci.yml")).text();
  expect(ci).toContain("run: bun run ci");
  const runner = await Bun.file(join(import.meta.dir, "..", "scripts/ci.sh")).text();
  const build = runner.indexOf("bun run build");
  expect(build).toBeGreaterThan(-1);
  expect(runner.indexOf("bun run smoke -- --reuse-build")).toBeGreaterThan(build);
  expect(runner).toContain("'Standalone paired smoke test' smoke.log");
  const release = await Bun.file(join(import.meta.dir, "..", ".github/workflows/release.yml")).text();
  const releaseBuild = release.indexOf("run: bun run build 2>&1");
  const smoke = release.indexOf("run: bun run smoke -- --reuse-build 2>&1");
  expect(releaseBuild).toBeGreaterThan(-1);
  expect(smoke).toBeGreaterThan(releaseBuild);
  expect(release.slice(smoke, release.indexOf("\n", smoke))).toContain("artifacts/release/smoke.log");
});
