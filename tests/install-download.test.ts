import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
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
async function writeAsset(root: string, name: string, bytes: string) {
  await writeFile(join(root, "assets", name), bytes);
  await writeFile(
    join(root, "assets", name + ".sha256"),
    createHash("sha256").update(bytes).digest("hex") + "  " + name + "\n",
  );
}
async function sandbox(installer: string) {
  const root = await mkdtemp(join(tmpdir(), "bruv-download-install-"));
  roots.push(root);
  const launcher = await readFile(
    process.env.BRUV_TEST_LAUNCHER_TEMPLATE ?? resolve(import.meta.dir, "../scripts/bruv-claude-compat.sh"),
    "utf8",
  );
  for (const name of ["bin", "tools", "assets", "home"]) await mkdir(join(root, name));
  for (const [name, bytes] of [
    ["bruv-linux-x64", normal],
    ["bruv-claude-compat-linux-x64", launcher],
  ]) {
    await writeAsset(root, name!, bytes!);
  }
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "SOURCE.txt"])
    await writeFile(join(root, "assets", name), name);
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
  return { root, run, launcher };
}

describe.each(["../install.sh", "../scripts/install.sh"])("download entrypoint %s", (installer) => {
  test("download installer pairs raw-named wrapper with staged normal, ignoring inherited override", async () => {
    const { root, run, launcher } = await sandbox(installer);
    const result = await run({ BRUV_CLAUDE_COMPAT_BRUV_PATH: "/wrong-bruv" });
    expect(result.code, result.errors).toBe(0);
    expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe(launcher);
    const version = Bun.spawn([join(root, "bin/bruv-claude-compat"), "--version"], {
      // Check the fixture sibling, not the CLI selected by the parent agent session.
      env: { ...process.env, BRUV_CLAUDE_COMPAT_BRUV_PATH: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect((await new Response(version.stdout).text()).trim()).toBe("Bruv connector");
    expect(await version.exited).toBe(0);
  });

  test.each(["bruv-linux-x64", "bruv-claude-compat-linux-x64"])(
    "checksum failure in %s leaves old pair unchanged without probing",
    async (asset) => {
      const { root, run } = await sandbox(installer);
      await writeFile(join(root, "bin/bruv"), "old normal");
      await writeFile(join(root, "bin/bruv-claude-compat"), "old standalone connector");
      await writeAsset(
        root,
        "bruv-linux-x64",
        normal.replace("#!/bin/sh\n", '#!/bin/sh\nprintf probe >> "$PROBE_LOG"\n'),
      );
      await writeFile(join(root, "assets", asset + ".sha256"), "0".repeat(64) + "  " + asset + "\n");
      const result = await run({ PROBE_LOG: join(root, "probes") });
      expect(result.code).not.toBe(0);
      expect(result.errors).toContain("Checksum verification failed: " + asset);
      expect(
        await access(join(root, "probes")).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old normal");
      expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old standalone connector");
      expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    },
  );

  test("download installer failed second rename restores old pair and notices", async () => {
    const { root, run } = await sandbox(installer);
    await writeFile(join(root, "bin/bruv"), "old normal");
    await writeFile(join(root, "bin/bruv-claude-compat"), "old standalone connector");
    const notices = join(root, "home/.local/share/bruv/notices/0.17.0");
    await mkdir(notices, { recursive: true });
    await writeFile(join(notices, "LICENSE"), "old license");
    await writeFile(
      join(root, "tools/mv"),
      '#!/bin/sh\ncase "$2" in */.bruv-install.*/bruv-linux-x64|*/.bruv-install.*/bruv) exit 1;; esac\nexec /bin/mv "$@"\n',
      { mode: 0o755 },
    );
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old normal");
    expect(result.errors).toContain("Cannot install Bruv; restoring previous pair.");
    expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old standalone connector");
    expect(await readFile(join(notices, "LICENSE"), "utf8")).toBe("old license");
    expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
  });

  test("relative download install directory supplies an absolute candidate path", async () => {
    const { root, run } = await sandbox(installer);
    const result = await run({ BRUV_INSTALL_DIR: "bin" });
    expect(result.code, result.errors).toBe(0);
    expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
  });

  test("version probes use private directories and an explicit staged connector pair", async () => {
    const { root, run } = await sandbox(installer);
    const checks = `case "$HOME" in */.bruv-install.*/probe) ;; *) exit 1;; esac
[ "$XDG_CONFIG_HOME" = "$HOME/config" ] && [ "$XDG_CACHE_HOME" = "$HOME/cache" ] && [ "$XDG_DATA_HOME" = "$HOME/data" ] || exit 1
if [ "$1" = --version ]; then [ -z "\${BRUV_CLAUDE_COMPAT_BRUV_PATH:-}" ] || exit 1; fi
`;
    await writeAsset(root, "bruv-linux-x64", normal.replace("#!/bin/sh\n", "#!/bin/sh\n" + checks));
    const result = await run({
      BRUV_CLAUDE_COMPAT_BRUV_PATH: "/wrong-bruv",
      XDG_CONFIG_HOME: "/wrong-config",
      XDG_CACHE_HOME: "/wrong-cache",
      XDG_DATA_HOME: "/wrong-data",
    });
    expect(result.code, result.errors).toBe(0);
  });

  test("connector product mismatch fails before publishing notices or binaries", async () => {
    const { root, run } = await sandbox(installer);
    await writeAsset(root, "bruv-claude-compat-linux-x64", '#!/bin/sh\necho "bruv-claude-compat 0.16.0"\n');
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.errors).toContain("Connector version does not match v0.17.0.");
    expect(await readdir(join(root, "bin"))).toEqual([]);
    expect(await readdir(join(root, "home/.local/share/bruv/notices"))).toEqual([]);
  });

  test("checksum manifest cannot redirect verification to a different filename", async () => {
    const { root, run } = await sandbox(installer);
    const checksum = createHash("sha256").update(normal).digest("hex");
    await writeFile(join(root, "assets/bruv-linux-x64.sha256"), checksum + "  ../../bruv\n");
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.errors).toContain("Invalid checksum manifest: bruv-linux-x64.");
    expect(await readdir(join(root, "bin"))).toEqual([]);
  });

  test("failed second rename on a fresh install removes published connector and notices", async () => {
    const { root, run } = await sandbox(installer);
    await writeFile(
      join(root, "tools/mv"),
      '#!/bin/sh\ncase "$2" in */.bruv-install.*/bruv-linux-x64|*/.bruv-install.*/bruv) exit 1;; esac\nexec /bin/mv "$@"\n',
      { mode: 0o755 },
    );
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.errors).toContain("Cannot install Bruv; restoring previous pair.");
    expect(await readdir(join(root, "bin"))).toEqual([]);
    expect(await readdir(join(root, "home/.local/share/bruv/notices"))).toEqual([]);
  });

  test("interruption after connector publication restores the previous pair", async () => {
    const { root, run } = await sandbox(installer);
    await writeFile(join(root, "bin/bruv"), "old normal");
    await writeFile(join(root, "bin/bruv-claude-compat"), "old connector");
    await writeFile(
      join(root, "tools/mv"),
      '#!/bin/sh\n/bin/mv "$@" || exit $?\ncase "$2" in */.bruv-install.*/bruv-claude-compat-linux-x64|*/.bruv-install.*/bruv-claude-compat) kill -HUP "$PPID";; esac\n',
      { mode: 0o755 },
    );
    const result = await run();
    expect(result.code).toBe(129);
    expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old normal");
    expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old connector");
    expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    expect(await readdir(join(root, "home/.local/share/bruv/notices"))).toEqual([]);
  });

  test("rollback failure preserves the unrestored binary backup for recovery", async () => {
    const { root, run } = await sandbox(installer);
    await writeFile(join(root, "bin/bruv"), "old normal");
    await writeFile(join(root, "bin/bruv-claude-compat"), "old connector");
    await writeFile(
      join(root, "tools/mv"),
      '#!/bin/sh\ncase "$2" in */.bruv-install.*/bruv-linux-x64|*/.bruv-install.*/bruv|*/.bruv-install.*/compat.previous) exit 1;; esac\nexec /bin/mv "$@"\n',
      { mode: 0o755 },
    );
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.errors).toContain("Rollback failed. Recovery files retained at ");
    const files = await readdir(join(root, "bin"));
    const recovery = files.find((file) => file.startsWith(".bruv-install."));
    expect(recovery).toBeDefined();
    expect(files).not.toContain(".bruv-install-lock");
    expect(await readFile(join(root, "bin", recovery!, "compat.previous"), "utf8")).toBe("old connector");
    expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old normal");
  });
});
