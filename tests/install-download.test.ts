import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const normal =
  '#!/bin/sh\ncase "$1" in --version) echo 0.17.0;; claude-compat) case "$2" in --bruv-version) echo "bruv-claude-compat 0.17.0";; --version) echo "2.1.280 (Bruv compatibility; bruv 0.17.0)";; *) exit 1;; esac;; *) exit 1;; esac\n';
async function sandbox() {
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
    await writeFile(join(root, "assets", name!), bytes!);
    await writeFile(
      join(root, "assets", name! + ".sha256"),
      createHash("sha256").update(bytes!).digest("hex") + "  " + name + "\n",
    );
  }
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "SOURCE.txt"])
    await writeFile(join(root, "assets", name), name);
  await writeFile(join(root, "tools/id"), "#!/bin/sh\necho 1000\n", { mode: 0o755 });
  await writeFile(join(root, "tools/uname"), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n', {
    mode: 0o755,
  });
  await writeFile(
    join(root, "tools/curl"),
    '#!/bin/sh\nurl=""; out=""\nwhile [ "$#" -gt 0 ]; do case "$1" in -o) out=$2; shift;; https:*) url=$1;; esac; shift; done\ncase "$url" in */releases/latest) printf https://github.com/tnfssc/bruv/releases/tag/v0.17.0;; https://github.com/tnfssc/bruv/releases/download/v0.17.0/*) cp "$ASSETS/${url##*/}" "$out";; *) exit 1;; esac\n',
    { mode: 0o755 },
  );
  const run = async (env: Record<string, string> = {}) => {
    const child = Bun.spawn(["sh", resolve(import.meta.dir, "../install.sh")], {
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

test("download installer pairs raw-named wrapper with staged normal, ignoring inherited override", async () => {
  const { root, run, launcher } = await sandbox();
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
  expect((await new Response(version.stdout).text()).trim()).toBe("2.1.280 (Bruv compatibility; bruv 0.17.0)");
  expect(await version.exited).toBe(0);
});

test("download installer checksum failure leaves old pair unchanged", async () => {
  const { root, run } = await sandbox();
  await writeFile(join(root, "bin/bruv"), "old normal");
  await writeFile(join(root, "bin/bruv-claude-compat"), "old standalone connector");
  await writeFile(
    join(root, "assets/bruv-claude-compat-linux-x64.sha256"),
    "0".repeat(64) + "  bruv-claude-compat-linux-x64\n",
  );
  expect((await run()).code).not.toBe(0);
  expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old normal");
  expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old standalone connector");
  expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
});

test("download installer failed second rename restores old pair and notices", async () => {
  const { root, run } = await sandbox();
  await writeFile(join(root, "bin/bruv"), "old normal");
  await writeFile(join(root, "bin/bruv-claude-compat"), "old standalone connector");
  const notices = join(root, "home/.local/share/bruv/notices/0.17.0");
  await mkdir(notices, { recursive: true });
  await writeFile(join(notices, "LICENSE"), "old license");
  await writeFile(
    join(root, "tools/mv"),
    '#!/bin/sh\ncase "$2" in */.bruv-install.*/bruv-linux-x64) exit 1;; esac\nexec /bin/mv "$@"\n',
    { mode: 0o755 },
  );
  const result = await run();
  expect(result.code).not.toBe(0);
  expect(await readFile(join(root, "bin/bruv"), "utf8")).toBe("old normal");
  expect(await readFile(join(root, "bin/bruv-claude-compat"), "utf8")).toBe("old standalone connector");
  expect(await readFile(join(notices, "LICENSE"), "utf8")).toBe("old license");
  expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
});

test("relative download install directory supplies an absolute candidate path", async () => {
  const { root, run } = await sandbox();
  const result = await run({ BRUV_INSTALL_DIR: "bin" });
  expect(result.code, result.errors).toBe(0);
  expect((await readdir(join(root, "bin"))).sort()).toEqual(["bruv", "bruv-claude-compat"]);
});
