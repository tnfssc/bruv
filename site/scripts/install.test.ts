import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const script = resolve(import.meta.dir, "../install.sh");
async function fixture(env: Record<string, string | undefined> = {}) {
  const root = await mkdtemp(join(tmpdir(), "bruv-install-test-"));
  const mocks = join(root, "mocks"),
    assets = join(root, "assets"),
    home = join(root, "home");
  const bin = join(home, ".local/bin"),
    notices = join(home, ".local/share/bruv/notices/0.16.2");
  for (const dir of [mocks, assets, bin, notices]) await mkdir(dir, { recursive: true });
  const write = async (name: string, lines: string[]) => {
    await Bun.write(join(mocks, name), lines.join("\n") + "\n");
    await chmod(join(mocks, name), 0o755);
  };
  await write("uname", [
    "#!/bin/sh",
    'case "$1" in -s) echo "${TEST_OS:-Linux}";; -m) echo "${TEST_ARCH:-x86_64}";; esac',
  ]);
  await write("id", ["#!/bin/sh", 'echo "${TEST_UID:-1000}"']);
  await write("curl", [
    "#!/bin/sh",
    "out=; url=",
    'while [ "$#" -gt 0 ]; do',
    'case "$1" in -o) shift; out=$1;; --proto|--proto-redir|-w) shift;; https://*) url=$1;; esac',
    "shift",
    "done",
    'printf "%s\\n" "$url" >> "$FIXTURE/requests"',
    'case "$url" in',
    '*/releases/latest) echo "https://github.com/tnfssc/bruv/releases/tag/v0.16.2"; exit 0;;',
    "https://github.com/tnfssc/bruv/releases/download/v0.16.2/*) ;;",
    "*) exit 22;;",
    "esac",
    "name=${url##*/}",
    '[ "$name" != "${MISSING:-}" ] || exit 22',
    'cp "$FIXTURE/assets/$name" "$out"',
  ]);
  await write("mv", [
    "#!/bin/sh",
    'if [ "${FAIL_MOVE:-}" = 1 ] && [ "$1" = -f ] && [ "$3" = "$HOME/.local/bin/bruv" ] && [ ! -e "$FIXTURE/move-failed" ]; then',
    'touch "$FIXTURE/move-failed"; exit 1',
    "fi",
    'exec /bin/mv "$@"',
  ]);
  for (const platform of ["linux-x64", "linux-arm64", "darwin-arm64", "android-arm64"])
    for (const prefix of ["bruv", "bruv-claude-compat"]) {
      const name = prefix + "-" + platform;
      const version = prefix === "bruv" ? "0.16.2" : "bruv-claude-compat " + (env.WRONG_VERSION ? "0.16.1" : "0.16.2");
      const bytes =
        '#!/bin/sh\necho probe >> "$FIXTURE/probes"\n[ "$1" != --live-self-test ] || exit 0\necho "' + version + '"\n';
      await Bun.write(join(assets, name), bytes);
      const hash =
        env.BAD_CHECKSUM || (env.BAD_CONNECTOR && prefix === "bruv-claude-compat")
          ? "0".repeat(64)
          : createHash("sha256").update(bytes).digest("hex");
      await Bun.write(join(assets, name + ".sha256"), hash + "  " + (env.BAD_FILENAME ? "../wrong" : name) + "\n");
    }
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "SOURCE.txt"])
    await Bun.write(join(assets, name), name + " release notice");
  await Bun.write(join(bin, "bruv"), "old bruv");
  await Bun.write(join(bin, "bruv-claude-compat"), "old connector");
  await Bun.write(join(notices, "old"), "old notices");
  const child = Bun.spawn(["/bin/sh", script], {
    env: {
      ...process.env,
      PATH: mocks + ":/usr/bin:/bin",
      HOME: home,
      FIXTURE: root,
      ANDROID_ROOT: "",
      PREFIX: "",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { root, bin, notices, code, output, error, clean: () => rm(root, { recursive: true, force: true }) };
}
async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await Bun.file(join(f.bin, "bruv")).text()).toBe("old bruv");
  expect(await Bun.file(join(f.bin, "bruv-claude-compat")).text()).toBe("old connector");
  expect(await Bun.file(join(f.notices, "old")).text()).toBe("old notices");
}
test("POSIX shell syntax", async () => {
  expect(await Bun.spawn(["/bin/sh", "-n", script]).exited).toBe(0);
});
test("paired install, pinned downloads, notices and supported artifact mapping", async () => {
  for (const env of [
    {},
    { TEST_ARCH: "aarch64" },
    { TEST_OS: "Darwin", TEST_ARCH: "arm64" },
    { TEST_ARCH: "aarch64", PREFIX: "/data/data/com.termux/files/usr" },
  ]) {
    const f = await fixture(env);
    try {
      expect(f.code).toBe(0);
      expect(f.output).toContain("Installed Bruv 0.16.2 and matching bruv-claude-compat");
      expect(await Bun.file(join(f.bin, "bruv")).text()).toContain('echo "0.16.2"');
      expect(await Bun.file(join(f.bin, "bruv-claude-compat")).text()).toContain('echo "bruv-claude-compat 0.16.2"');
      for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "SOURCE.txt"])
        expect(await Bun.file(join(f.notices, name)).text()).toContain("release notice");
      const requests = (await Bun.file(join(f.root, "requests")).text()).trim().split("\n");
      expect(requests.filter((url) => url.endsWith("/latest"))).toHaveLength(1);
      expect(requests.slice(1).every((url) => url.includes("/download/v0.16.2/"))).toBe(true);
      const platform =
        env.TEST_OS === "Darwin"
          ? "darwin-arm64"
          : env.PREFIX
            ? "android-arm64"
            : env.TEST_ARCH
              ? "linux-arm64"
              : "linux-x64";
      expect(requests[1]).toEndWith("/bruv-" + platform);
    } finally {
      await f.clean();
    }
  }
});
test("missing pair or notices cannot replace a working install", async () => {
  for (const MISSING of ["bruv-claude-compat-linux-x64", "LICENSE"]) {
    const f = await fixture({ MISSING });
    try {
      expect(f.code).not.toBe(0);
      expect(f.error).toContain("Source guide:");
      await unchanged(f);
      expect(await Bun.file(join(f.root, "probes")).exists()).toBe(false);
    } finally {
      await f.clean();
    }
  }
});
test("checksum or manifest failure happens before executing either binary", async () => {
  for (const env of [{ BAD_CHECKSUM: "1" }, { BAD_CONNECTOR: "1" }, { BAD_FILENAME: "1" }]) {
    const f = await fixture(env);
    try {
      expect(f.code).not.toBe(0);
      await unchanged(f);
      expect(await Bun.file(join(f.root, "probes")).exists()).toBe(false);
    } finally {
      await f.clean();
    }
  }
});
test("connector version mismatch does not replace pair", async () => {
  const f = await fixture({ WRONG_VERSION: "1" });
  try {
    expect(f.code).not.toBe(0);
    expect(f.error).toContain("Connector version");
    await unchanged(f);
  } finally {
    await f.clean();
  }
});
test("failed second rename restores pair and notices", async () => {
  const f = await fixture({ FAIL_MOVE: "1" });
  try {
    expect(f.code).not.toBe(0);
    expect(f.error).toContain("restoring previous pair");
    await unchanged(f);
  } finally {
    await f.clean();
  }
});
test("unsupported platform and root fail before downloading", async () => {
  for (const env of [
    { TEST_OS: "Windows" },
    { TEST_UID: "0" },
    { PREFIX: "/data/data/com.termux/files/usr", ANDROID_ROOT: "/system" },
  ]) {
    const f = await fixture(env);
    try {
      expect(f.code).not.toBe(0);
      await unchanged(f);
      expect(await Bun.file(join(f.root, "requests")).exists()).toBe(false);
    } finally {
      await f.clean();
    }
  }
});
