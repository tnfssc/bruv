import { afterEach, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installer = join(import.meta.dir, "..", "scripts/install-local.sh");
const roots: string[] = [];
const candidate =
  '#!/bin/sh\necho "$1" >> "$PROBE_LOG"\ncase "$1" in\n--bruv-version) echo "bruv-claude-compat 1.2.3"; exit "${VERSION_STATUS:-0}";;\n--version) echo "1.2.3"; exit "${VERSION_STATUS:-0}";;\n--live-self-test) exit "${SELF_TEST_STATUS:-0}";;\n*) exit 99;;\nesac\n';
const launcher = '#!/bin/sh\nexec "${BRUV_CLAUDE_COMPAT_BRUV_PATH:-$(dirname "$0")/bruv}" "$@"\n';
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "bruv-install-"));
  roots.push(root);
  for (const dir of ["scripts", "dist", "tools", "bin"]) await mkdir(join(root, dir));
  await cp(installer, join(root, "scripts/install-local.sh"));
  await chmod(join(root, "scripts/install-local.sh"), 0o755);
  await writeFile(join(root, "dist/bruv"), candidate, { mode: 0o755 });
  await writeFile(join(root, "dist/bruv-claude-compat"), launcher, { mode: 0o755 });
  await writeFile(
    join(root, "tools/uname"),
    '#!/bin/sh\nif [ "$1" = "-s" ]; then echo "$HOST_OS"; else echo "$HOST_ARCH"; fi\n',
    { mode: 0o755 },
  );
  await writeFile(join(root, "tools/bun"), '#!/bin/sh\necho "bun $*" >> "$BUILD_LOG"\n', { mode: 0o755 });
  await writeFile(join(root, "scripts/build-live-helper.sh"), '#!/bin/sh\necho helper >> "$BUILD_LOG"\n');
  return root;
}

async function run(root: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["sh", join(root, "scripts/install-local.sh")], {
    cwd: root,
    env: {
      ...process.env,
      PATH: join(root, "tools") + ":" + process.env.PATH,
      HOME: join(root, "home"),
      BRUV_INSTALL_DIR: join(root, "bin"),
      BRUV_SKIP_BUILD: "1",
      HOST_OS: "Linux",
      HOST_ARCH: "x86_64",
      PROBE_LOG: join(root, "probes"),
      BUILD_LOG: join(root, "builds"),
      ...env,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exited;
}

describe("local installer", () => {
  test("installs only the verified paired executables", async () => {
    const root = await sandbox();
    await mkdir(join(root, "dist/bruv-web/assets"), { recursive: true });
    await writeFile(join(root, "dist/bruv-web/index.html"), "intermediate web build");
    expect(await run(root)).toBe(0);
    expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe(candidate);
    expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n--bruv-version\n");
    expect(await Bun.file(join(root, "builds")).exists()).toBe(false);
  });

  test("atomically replaces an existing executable without staging leftovers", async () => {
    const root = await sandbox();
    await writeFile(join(root, "bin/bruv"), "old", { mode: 0o755 });
    expect(await run(root)).toBe(0);
    expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe(candidate);
    expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
  });

  for (const failure of ["VERSION_STATUS", "SELF_TEST_STATUS"])
    test("preserves the installed executable when " + failure + " fails", async () => {
      const root = await sandbox();
      await writeFile(join(root, "bin/bruv"), "old", { mode: 0o755 });
      expect(await run(root, { HOST_OS: "Darwin", HOST_ARCH: "arm64", [failure]: "1" })).not.toBe(0);
      expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old");
      expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv"]);
    });

  test("Mac arm64 builds and embeds the helper before validating the candidate", async () => {
    const root = await sandbox();
    expect(await run(root, { BRUV_SKIP_BUILD: "0", HOST_OS: "Darwin", HOST_ARCH: "arm64" })).toBe(0);
    expect(await readFile(join(root, "builds"), "utf8")).toBe("helper\nbun run build --live-helper=dist/live-audio\n");
    expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n--bruv-version\n--live-self-test\n");
  });

  test("trusted Mac prebuilt skips both builds, not verification", async () => {
    const root = await sandbox();
    expect(await run(root, { HOST_OS: "Darwin", HOST_ARCH: "arm64" })).toBe(0);
    expect(await Bun.file(join(root, "builds")).exists()).toBe(false);
    expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n--bruv-version\n--live-self-test\n");
  });

  for (const [os, arch] of [
    ["Linux", "aarch64"],
    ["Darwin", "x86_64"],
  ])
    test(os + " " + arch + " does not build/embed a Mac helper", async () => {
      const root = await sandbox();
      expect(await run(root, { BRUV_SKIP_BUILD: "0", HOST_OS: os!, HOST_ARCH: arch! })).toBe(0);
      expect(await readFile(join(root, "builds"), "utf8")).toBe("bun run build\n");
      expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n--bruv-version\n");
    });
});

test("missing connector preserves the existing pair and removes staging", async () => {
  const root = await sandbox();
  await rm(join(root, "dist/bruv-claude-compat"));
  await writeFile(join(root, "bin/bruv"), "old bruv");
  await writeFile(join(root, "bin/bruv-claude-compat"), "old connector");
  expect(await run(root)).not.toBe(0);
  expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old bruv");
  expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old connector");
  expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
});

test("version mismatch preserves both installed binaries", async () => {
  const root = await sandbox();
  await writeFile(join(root, "dist/bruv-claude-compat"), '#!/bin/sh\necho "9.9.9"\n', {
    mode: 0o755,
  });
  await writeFile(join(root, "bin/bruv"), "old bruv");
  await writeFile(join(root, "bin/bruv-claude-compat"), "old connector");
  expect(await run(root)).not.toBe(0);
  expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old bruv");
  expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old connector");
});

test("inherited launcher override cannot replace staged pair verification", async () => {
  const root = await sandbox();
  expect(await run(root, { BRUV_CLAUDE_COMPAT_BRUV_PATH: "/does-not-exist" })).toBe(0);
  expect(await readFile(join(root, "probes"), "utf8")).toBe("--version\n--bruv-version\n");
});

for (const existing of [false, true])
  test("local second rename failure restores old install (connector: " + existing + ")", async () => {
    const root = await sandbox();
    await writeFile(join(root, "bin/bruv"), "old bruv", { mode: 0o751 });
    if (existing) await writeFile(join(root, "bin/bruv-claude-compat"), "old connector", { mode: 0o750 });
    await writeFile(
      join(root, "tools/mv"),
      '#!/bin/sh\ncase "$2" in */.bruv-install-*/bruv) exit 1;; esac\nexec /bin/mv "$@"\n',
      { mode: 0o755 },
    );
    expect(await run(root)).not.toBe(0);
    expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old bruv");
    expect((await stat(join(root, "bin/bruv"))).mode & 0o777).toBe(0o751);
    if (existing) {
      expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old connector");
      expect((await stat(join(root, "bin/bruv-claude-compat"))).mode & 0o777).toBe(0o750);
    }
    expect((await readdir(join(root, "bin"))).sort()).toEqual(existing ? ["bruv", "bruv-claude-compat"] : ["bruv"]);
  });

test("relative local install directory still supplies an absolute staged override", async () => {
  const root = await sandbox();
  expect(await run(root, { BRUV_INSTALL_DIR: "bin" })).toBe(0);
  expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe(launcher);
});

test("first rename failure leaves both installed executables unchanged", async () => {
  const root = await sandbox();
  await writeFile(join(root, "bin/bruv"), "old bruv");
  await writeFile(join(root, "bin/bruv-claude-compat"), "old connector");
  await writeFile(join(root, "tools/mv"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  expect(await run(root)).not.toBe(0);
  expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old bruv");
  expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old connector");
  expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
});

test("failed rollback retains the original pair for recovery", async () => {
  const root = await sandbox();
  await writeFile(join(root, "bin/bruv"), "old bruv");
  await writeFile(join(root, "bin/bruv-claude-compat"), "old connector");
  await writeFile(
    join(root, "tools/mv"),
    '#!/bin/sh\ncase "$2" in */.bruv-install-*/bruv|*.previous) exit 1;; esac\nexec /bin/mv "$@"\n',
    { mode: 0o755 },
  );
  expect(await run(root)).not.toBe(0);
  expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old bruv");
  expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe(launcher);
  const stages = (await readdir(join(root, "bin"))).filter((name) => name.startsWith(".bruv-install-"));
  expect(stages).toHaveLength(1);
  const stage = join(root, "bin", stages[0]!);
  expect(await readFile(join(stage, "bruv.previous"), "utf8")).toBe("old bruv");
  expect(await readFile(join(stage, "bruv-claude-compat.previous"), "utf8")).toBe("old connector");
});

test("an unsafe connector target is rejected before either installed path changes", async () => {
  const root = await sandbox();
  await writeFile(join(root, "bin/bruv"), "old bruv");
  await writeFile(join(root, "external-connector"), "external connector");
  await symlink(join(root, "external-connector"), join(root, "bin/bruv-claude-compat"));
  expect(await run(root)).not.toBe(0);
  expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old bruv");
  expect(await readFile(join(root, "external-connector"), "utf8")).toBe("external connector");
  expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
});
