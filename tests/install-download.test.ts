import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const normal = `#!/bin/sh
case "$1" in
  --version) echo 0.17.0 ;;
  claude-compat)
    case "$2" in
      --bruv-version) echo "bruv-claude-compat 0.17.0" ;;
      --version) echo "Bruv connector" ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
`;
async function writeAsset(assetsDir: string, name: string, bytes: string) {
  await writeFile(join(assetsDir, name), bytes);
  await writeFile(
    join(assetsDir, name + ".sha256"),
    createHash("sha256").update(bytes).digest("hex") + "  " + name + "\n",
  );
}
async function sandbox(root: string, installer: string) {
  const binDir = join(root, "bin");
  const assetsDir = join(root, "assets");
  const noticesDir = join(root, "home/.local/share/bruv/notices");
  const launcher = await readFile(
    process.env.BRUV_TEST_LAUNCHER_TEMPLATE ?? resolve(import.meta.dir, "../scripts/bruv-claude-compat.sh"),
    "utf8",
  );
  for (const name of ["bin", "tools", "assets", "home"]) await mkdir(join(root, name));
  await writeAsset(assetsDir, "bruv-linux-x64", normal);
  await writeAsset(assetsDir, "bruv-claude-compat-linux-x64", launcher);
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "SOURCE.txt"])
    await writeFile(join(assetsDir, name), name);
  await writeFile(join(root, "tools/id"), "#!/bin/sh\necho 1000\n", { mode: 0o755 });
  await writeFile(join(root, "tools/uname"), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n', {
    mode: 0o755,
  });
  await writeFile(
    join(root, "tools/curl"),
    `#!/bin/sh
url=""; out=""
while [ "$#" -gt 0 ]; do
  case "$1" in -o) out=$2; shift;; https:*) url=$1;; esac
  shift
done
case "$url" in
  */releases/latest) printf https://github.com/tnfssc/bruv/releases/tag/v0.17.0 ;;
  https://github.com/tnfssc/bruv/releases/download/v0.17.0/*) cp "$ASSETS/\${url##*/}" "$out" ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  const run = async (env: Record<string, string> = {}) => {
    const child = Bun.spawn(["sh", resolve(import.meta.dir, installer)], {
      cwd: root,
      env: {
        ...process.env,
        HOME: join(root, "home"),
        BRUV_INSTALL_DIR: join(root, "bin"),
        ASSETS: join(root, "assets"),
        PATH: join(root, "tools") + ":/usr/bin:/bin",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { output, errors, code };
  };
  return { root, binDir, assetsDir, noticesDir, run, launcher };
}

async function withSandbox(
  installer: string,
  exercise: (fixture: Awaited<ReturnType<typeof sandbox>>) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "bruv-download-install-"));
  try {
    await exercise(await sandbox(root, installer));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function mockMove(root: string, operation: string) {
  await writeFile(
    join(root, "tools/mv"),
    `#!/bin/sh
# Accept both installer forms: mv SOURCE TARGET and mv -f SOURCE TARGET.
source=$1
[ "$1" != -f ] || source=$2
${operation}
`,
    { mode: 0o755 },
  );
}

// Both download entrypoints publish the canonical staged pair.
const failNormalPublication = `
case "$source" in */.bruv-install.*/bruv) exit 1;; esac
exec /bin/mv "$@"
`;

describe.each(["../install.sh", "../scripts/install.sh"])("download entrypoint %s", (installer) => {
  test("publishes the verified pair and launcher identity, ignoring inherited override", () =>
    withSandbox(installer, async ({ binDir, run, launcher }) => {
      const result = await run({ BRUV_CLAUDE_COMPAT_BRUV_PATH: "/wrong-bruv" });
      expect(result.code, result.errors).toBe(0);
      expect((await readdir(binDir)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
      expect(await readFile(join(binDir, "bruv"), "utf8")).toBe(normal);
      expect(await readFile(join(binDir, "bruv-claude-compat"), "utf8")).toBe(launcher);
      const version = Bun.spawn([join(binDir, "bruv-claude-compat"), "--version"], {
        // Check the fixture sibling, not the CLI selected by the parent agent session.
        env: { ...process.env, BRUV_CLAUDE_COMPAT_BRUV_PATH: "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect((await new Response(version.stdout).text()).trim()).toBe("Bruv connector");
      expect(await version.exited).toBe(0);
    }));

  test.each(["bruv-linux-x64", "bruv-claude-compat-linux-x64"])(
    "checksum failure in %s leaves old pair unchanged without probing",
    (asset) =>
      withSandbox(installer, async ({ root, binDir, assetsDir, run }) => {
        await writeFile(join(binDir, "bruv"), "old normal");
        await writeFile(join(binDir, "bruv-claude-compat"), "old standalone connector");
        await writeAsset(
          assetsDir,
          "bruv-linux-x64",
          normal.replace("#!/bin/sh\n", '#!/bin/sh\nprintf probe >> "$PROBE_LOG"\n'),
        );
        await writeFile(join(assetsDir, asset + ".sha256"), "0".repeat(64) + "  " + asset + "\n");
        const result = await run({ PROBE_LOG: join(root, "probes") });
        expect(result.code).not.toBe(0);
        expect(result.errors).toContain("Checksum verification failed: " + asset);
        expect(
          await access(join(root, "probes")).then(
            () => true,
            () => false,
          ),
        ).toBe(false);
        expect(await readFile(join(binDir, "bruv"), "utf8")).toBe("old normal");
        expect(await readFile(join(binDir, "bruv-claude-compat"), "utf8")).toBe("old standalone connector");
        expect((await readdir(binDir)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
      }),
  );

  test("download installer failed second rename restores old pair and notices", () =>
    withSandbox(installer, async ({ root, binDir, noticesDir, run }) => {
      await writeFile(join(binDir, "bruv"), "old normal", { mode: 0o751 });
      await writeFile(join(binDir, "bruv-claude-compat"), "old standalone connector", { mode: 0o711 });
      const notices = join(noticesDir, "0.17.0");
      await mkdir(notices, { recursive: true });
      await writeFile(join(notices, "LICENSE"), "old license");
      await mockMove(root, failNormalPublication);
      const result = await run();
      expect(result.code).not.toBe(0);
      expect(await readFile(join(binDir, "bruv"), "utf8")).toBe("old normal");
      expect(result.errors).toContain("Cannot install Bruv; restoring previous pair.");
      expect(await readFile(join(binDir, "bruv-claude-compat"), "utf8")).toBe("old standalone connector");
      expect(await readFile(join(notices, "LICENSE"), "utf8")).toBe("old license");
      expect((await stat(join(binDir, "bruv"))).mode & 0o777).toBe(0o751);
      expect((await stat(join(binDir, "bruv-claude-compat"))).mode & 0o777).toBe(0o711);
      expect((await readdir(binDir)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    }));

  test("relative download install directory supplies an absolute candidate path", () =>
    withSandbox(installer, async ({ binDir, run }) => {
      const result = await run({ BRUV_INSTALL_DIR: "bin" });
      expect(result.code, result.errors).toBe(0);
      expect((await readdir(binDir)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    }));

  test("version probes use private directories and an explicit staged connector pair", () =>
    withSandbox(installer, async ({ assetsDir, run }) => {
      const checks = `case "$0" in */.bruv-install.*/bruv) ;; *) exit 1;; esac
case "$HOME" in */.bruv-install.*/probe) ;; *) exit 1;; esac
[ "$XDG_CONFIG_HOME" = "$HOME/config" ] && [ "$XDG_CACHE_HOME" = "$HOME/cache" ] && [ "$XDG_DATA_HOME" = "$HOME/data" ] || exit 1
if [ "$1" = --version ]; then [ -z "\${BRUV_CLAUDE_COMPAT_BRUV_PATH:-}" ] || exit 1; fi
`;
      await writeAsset(assetsDir, "bruv-linux-x64", normal.replace("#!/bin/sh\n", "#!/bin/sh\n" + checks));
      const result = await run({
        BRUV_CLAUDE_COMPAT_BRUV_PATH: "/wrong-bruv",
        XDG_CONFIG_HOME: "/wrong-config",
        XDG_CACHE_HOME: "/wrong-cache",
        XDG_DATA_HOME: "/wrong-data",
      });
      expect(result.code, result.errors).toBe(0);
    }));

  test("connector product mismatch fails before publishing notices or binaries", () =>
    withSandbox(installer, async ({ binDir, assetsDir, noticesDir, run }) => {
      await writeAsset(assetsDir, "bruv-claude-compat-linux-x64", '#!/bin/sh\necho "bruv-claude-compat 0.16.0"\n');
      const result = await run();
      expect(result.code).not.toBe(0);
      expect(result.errors).toContain("Connector version does not match v0.17.0.");
      expect(await readdir(binDir)).toEqual([]);
      expect(await readdir(noticesDir)).toEqual([]);
    }));

  test("checksum manifest cannot redirect verification to a different filename", () =>
    withSandbox(installer, async ({ binDir, assetsDir, run }) => {
      const checksum = createHash("sha256").update(normal).digest("hex");
      await writeFile(join(assetsDir, "bruv-linux-x64.sha256"), checksum + "  ../../bruv\n");
      const result = await run();
      expect(result.code).not.toBe(0);
      expect(result.errors).toContain("Invalid checksum manifest: bruv-linux-x64.");
      expect(await readdir(binDir)).toEqual([]);
    }));

  test("failed second rename on a fresh install removes published connector and notices", () =>
    withSandbox(installer, async ({ root, binDir, noticesDir, run }) => {
      await mockMove(root, failNormalPublication);
      const result = await run();
      expect(result.code).not.toBe(0);
      expect(result.errors).toContain("Cannot install Bruv; restoring previous pair.");
      expect(await readdir(binDir)).toEqual([]);
      expect(await readdir(noticesDir)).toEqual([]);
    }));

  test("interruption after connector publication restores the previous pair", () =>
    withSandbox(installer, async ({ root, binDir, noticesDir, run }) => {
      await writeFile(join(binDir, "bruv"), "old normal", { mode: 0o751 });
      await writeFile(join(binDir, "bruv-claude-compat"), "old connector", { mode: 0o711 });
      await mockMove(
        root,
        `
/bin/mv "$@" || exit $?
case "$source" in */.bruv-install.*/bruv-claude-compat) kill -HUP "$PPID";; esac
`,
      );
      const result = await run();
      expect(result.code).toBe(129);
      expect(await readFile(join(binDir, "bruv"), "utf8")).toBe("old normal");
      expect(await readFile(join(binDir, "bruv-claude-compat"), "utf8")).toBe("old connector");
      expect((await stat(join(binDir, "bruv"))).mode & 0o777).toBe(0o751);
      expect((await stat(join(binDir, "bruv-claude-compat"))).mode & 0o777).toBe(0o711);
      expect((await readdir(binDir)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
      expect(await readdir(noticesDir)).toEqual([]);
    }));

  test("rollback failure preserves the unrestored binary backup for recovery", () =>
    withSandbox(installer, async ({ root, binDir, run }) => {
      await writeFile(join(binDir, "bruv"), "old normal");
      await writeFile(join(binDir, "bruv-claude-compat"), "old connector");
      await mockMove(
        root,
        `
case "$source" in
  */.bruv-install.*/bruv|*/.bruv-install.*/compat.previous) exit 1;;
esac
exec /bin/mv "$@"
`,
      );
      const result = await run();
      expect(result.code).not.toBe(0);
      expect(result.errors).toContain("Rollback failed. Recovery files retained at ");
      const files = await readdir(binDir);
      const recovery = files.find((file) => file.startsWith(".bruv-install."));
      expect(recovery).toBeDefined();
      expect(files).not.toContain(".bruv-install-lock");
      expect(await readFile(join(binDir, recovery!, "compat.previous"), "utf8")).toBe("old connector");
      expect(await readFile(join(binDir, "bruv"), "utf8")).toBe("old normal");
    }));
});
