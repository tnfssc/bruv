import { afterEach, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "scripts/smoke.sh");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const buildDriver = `#!/bin/sh
set -eu
if [ "$1" = run ] && [ "$2" = build ]; then
  echo build >> builds
  cp fixture-bruv dist/bruv
  cp fixture-connector dist/bruv-claude-compat
elif [ "$1" = -e ]; then
  echo 1.2.3
else
  exit 1
fi
`;

const bruv = `#!/bin/sh
set -eu
# env -i clears inherited settings, but leaves cwd unchanged. Log probes there.
[ "$PATH" = /nonexistent ]
[ -z "\${BRUV_SMOKE_PARENT_ENV+x}" ]
printf '%s\\n' "$*" >> probes
case "$1" in
  --version) /bin/mkdir -p "$HOME/.bruv"; echo 1.2.3 ;;
  --help) /bin/mkdir -p "$HOME/.bruv"; echo "bruv - AI coding assistant" ;;
  web) echo "Setup guide only." ;;
  claude-compat)
    shift
    case "$1" in
      --bruv-version) echo "bruv-claude-compat 1.2.3" ;;
      --version) echo "Bruv connector" ;;
    esac ;;
esac
`;

const connector = `#!/bin/sh
dir=\${0%/*}
exec "$dir/bruv" claude-compat "$@"
`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bruv-smoke-test-"));
  roots.push(root);
  const smokeTemps = join(root, "smoke-temps");
  for (const dir of ["bin", "dist", "smoke-temps"]) await mkdir(join(root, dir));
  await writeFile(join(root, "bin/bun"), buildDriver, { mode: 0o755 });
  await writeFile(join(root, "fixture-bruv"), bruv, { mode: 0o755 });
  await writeFile(join(root, "fixture-connector"), connector, { mode: 0o755 });

  const installPair = async () => {
    await copyFile(join(root, "fixture-bruv"), join(root, "dist/bruv"));
    await copyFile(join(root, "fixture-connector"), join(root, "dist/bruv-claude-compat"));
  };
  const run = async (args: string[] = []) => {
    const result = Bun.spawnSync(["/bin/sh", script, ...args], {
      cwd: root,
      env: {
        ...process.env,
        PATH: join(root, "bin") + ":/usr/bin:/bin",
        TMPDIR: smokeTemps,
        BRUV_SMOKE_PARENT_ENV: "must not reach probes",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    // Check the script's trap before afterEach removes the fixture itself.
    expect(await readdir(smokeTemps)).toEqual([]);
    return result;
  };
  const buildCount = async () => {
    const log = Bun.file(join(root, "builds"));
    return (await log.exists()) ? (await log.text()).trim().split("\n").length : 0;
  };
  return { root, run, buildCount, installPair };
}

const expectedProbes = ["--version", "--help", "claude-compat --bruv-version", "claude-compat --version", "web"];

for (const reuse of [false, true]) {
  test(
    reuse ? "reuse runs every paired probe without building" : "default smoke builds then runs every paired probe",
    async () => {
      const { root, run, buildCount, installPair } = await fixture();
      if (reuse) await installPair();
      const result = await run(reuse ? ["--reuse-build"] : []);
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      expect(result.stdout.toString()).toBe(
        "bruv paired standalone smoke test passed (not native parity acceptance)\n",
      );
      expect(await buildCount()).toBe(reuse ? 0 : 1);
      expect((await readFile(join(root, "probes"), "utf8")).trim().split("\n")).toEqual(expectedProbes);
    },
  );
}

// Each bad probe starts with a healthy pair: a prior failure cannot mask the next assertion.
for (const [name, source, lastProbe] of [
  ["product version mismatch", bruv.replace("echo 1.2.3", "echo wrong-version"), "--help"],
  ["product help mismatch", bruv.replace("bruv - AI coding assistant", "wrong help"), "--help"],
  [
    "connector product version mismatch",
    bruv.replace("bruv-claude-compat 1.2.3", "bruv-claude-compat wrong-version"),
    "claude-compat --bruv-version",
  ],
  [
    "connector identity mismatch",
    bruv.replace("Bruv connector", "wrong compatibility identity"),
    "claude-compat --version",
  ],
  [
    "connector stderr",
    bruv.replace('echo "Bruv connector"', 'echo "Bruv connector"; echo warning >&2'),
    "claude-compat --version",
  ],
  ["web guidance mismatch", bruv.replace("Setup guide only.", "bundled web"), "web"],
]) {
  test(`reuse rejects ${name} and cleans its temporary pair`, async () => {
    const { root, run, buildCount, installPair } = await fixture();
    await installPair();
    await writeFile(join(root, "dist/bruv"), source);
    const result = await run(["--reuse-build"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).not.toContain("smoke test passed");
    const probes = (await readFile(join(root, "probes"), "utf8")).trim().split("\n");
    expect(probes).toEqual(expectedProbes.slice(0, expectedProbes.indexOf(lastProbe) + 1));
    expect(await buildCount()).toBe(0);
  });
}

for (const binary of ["bruv", "bruv-claude-compat"]) {
  for (const state of ["missing", "not executable"]) {
    test(`reuse requires ${binary} to be present and executable (${state})`, async () => {
      const { root, run, buildCount, installPair } = await fixture();
      await installPair();
      const path = join(root, "dist", binary);
      if (state === "missing") await rm(path);
      else await chmod(path, 0o644);
      const result = await run(["--reuse-build"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(`requires executable ./dist/${binary}`);
      expect(await buildCount()).toBe(0);
      expect(await Bun.file(join(root, "probes")).exists()).toBe(false);
    });
  }
}

for (const args of [["--unknown"], ["--reuse-build", "--unknown"], ["--", "--reuse-build"]]) {
  test(`invalid arguments cannot trigger a build: ${args.join(" ")}`, async () => {
    const { root, run, buildCount } = await fixture();
    const result = await run(args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("usage:");
    expect(await buildCount()).toBe(0);
    expect(await Bun.file(join(root, "probes")).exists()).toBe(false);
  });
}

test("CI and release smoke reuse their preceding build", async () => {
  const ci = await Bun.file(join(import.meta.dir, "..", ".github/workflows/ci.yml")).text();
  expect(ci).toContain("run: bun run ci");
  const runner = await Bun.file(join(import.meta.dir, "..", "scripts/ci.sh")).text();
  const build = runner.indexOf("bun run build");
  expect(build).toBeGreaterThan(-1);
  expect(runner.indexOf("bun run smoke -- --reuse-build")).toBeGreaterThan(build);
  expect(runner).toContain("'Standalone paired smoke test' smoke.log");
  const release = await Bun.file(join(import.meta.dir, "..", ".github/workflows/release.yml")).text();
  expect(release).toContain("run: bun run ci");
  expect(release).toContain("CI_LOG_DIR: artifacts/release/ci");
  expect(release).not.toContain("run: bun run smoke");
});
