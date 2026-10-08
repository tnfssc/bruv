import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectorLauncher } from "../scripts/claude-compat-launcher";
import { releaseTargets, verifyReleaseLaunchers } from "../scripts/verify-release-launchers";

type ReleaseTarget = (typeof releaseTargets)[number];

const dispatchBody =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX shell parameter expansion, not JS interpolation.
  'dir=${0%/*}\nname=${0##*/}\nsuffix=${name#bruv-claude-compat}\nexec "$dir/bruv$suffix" claude-compat "$@"\n';

function launcherPath(root: string, target: ReleaseTarget) {
  return join(root, "bruv-claude-compat-" + target);
}

function launcherScript(target: ReleaseTarget, body = dispatchBody) {
  return (target === "android-arm64" ? "#!/system/bin/sh\n" : "#!/bin/sh\n") + body;
}

// Keep packaging valid when testing dispatch: only explicit checksum tests leave it stale.
async function writeLauncher(root: string, target: ReleaseTarget, script: string) {
  const name = "bruv-claude-compat-" + target;
  await writeFile(launcherPath(root, target), script, { mode: 0o755 });
  await writeFile(
    launcherPath(root, target) + ".sha256",
    createHash("sha256").update(script).digest("hex") + "  " + name + "\n",
  );
}

async function withReleaseLaunchers(check: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "bruv-launcher-gate-test-"));
  try {
    for (const target of releaseTargets) await writeLauncher(root, target, launcherScript(target));
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("release gate covers Linux x64/arm64, macOS arm64 and Android arm64", () => {
  expect(releaseTargets).toEqual(["linux-x64", "linux-arm64", "darwin-arm64", "android-arm64"]);
});

test("host POSIX gate verifies checksums, matching suffixed/installed siblings, PID, arguments and exit status without PATH tools", async () => {
  await withReleaseLaunchers(async (root) => {
    await verifyReleaseLaunchers(root);
  });
});

test("shipped launcher templates pass the host POSIX gate for every release target (not native execution)", async () => {
  await withReleaseLaunchers(async (root) => {
    for (const target of releaseTargets) await writeLauncher(root, target, await connectorLauncher("bun-" + target));
    await verifyReleaseLaunchers(root);
  });
});

test("gate rejects an Android launcher with the host interpreter", async () => {
  await withReleaseLaunchers(async (root) => {
    await writeLauncher(root, "android-arm64", "#!/bin/sh\n" + dispatchBody);
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("#!/system/bin/sh");
  });
});

test("gate rejects a compiled connector instead of a tiny POSIX launcher", async () => {
  await withReleaseLaunchers(async (root) => {
    await writeLauncher(root, "linux-x64", "ELF compiled connector");
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("tiny POSIX launcher");
  });
});

test("gate rejects malformed checksum records", async () => {
  await withReleaseLaunchers(async (root) => {
    await writeFile(launcherPath(root, "linux-x64") + ".sha256", "invalid checksum\n");
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("checksum does not match");
  });
});

test("gate rejects a checksum left stale after the launcher bytes change", async () => {
  await withReleaseLaunchers(async (root) => {
    await writeFile(launcherPath(root, "linux-x64"), launcherScript("linux-x64") + "# changed after hashing\n");
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("checksum does not match");
  });
});

test("gate rejects unquoted arguments that lose spaces and empty values", async () => {
  await withReleaseLaunchers(async (root) => {
    await writeLauncher(root, "linux-x64", launcherScript("linux-x64", dispatchBody.replace('"$@"', "$@")));
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("forward arguments and exit status");
  });
});

test("gate rejects a launcher that spawns its sibling instead of preserving its PID with exec", async () => {
  await withReleaseLaunchers(async (root) => {
    await writeLauncher(root, "linux-x64", launcherScript("linux-x64", dispatchBody.replace("exec ", "")));
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("must exec its matching sibling");
  });
});

test("gate rejects a fixed release suffix that works before installation but not after renaming", async () => {
  await withReleaseLaunchers(async (root) => {
    await writeLauncher(
      root,
      "linux-x64",
      launcherScript("linux-x64", dispatchBody.replace("bruv$suffix", "bruv-linux-x64")),
    );
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("(installed)");
  });
});

test("gate rejects an installed-only sibling path in the suffixed release layout", async () => {
  await withReleaseLaunchers(async (root) => {
    await writeLauncher(root, "linux-x64", launcherScript("linux-x64", dispatchBody.replace("bruv$suffix", "bruv")));
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("(-linux-x64)");
  });
});

test("gate rejects a non-executable launcher even though its bytes and checksum are valid", async () => {
  await withReleaseLaunchers(async (root) => {
    await chmod(launcherPath(root, "linux-x64"), 0o644);
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("must be executable");
  });
});
