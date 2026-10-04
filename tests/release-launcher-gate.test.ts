import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseTargets, verifyReleaseLaunchers } from "../scripts/verify-release-launchers";

const body =
  'dir=${0%/*}\nname=${0##*/}\nsuffix=${name#bruv-claude-compat}\nexec "$dir/bruv$suffix" claude-compat "$@"\n';

async function put(root: string, target: string, script: string) {
  const name = "bruv-claude-compat-" + target;
  await writeFile(join(root, name), script, { mode: 0o755 });
  await writeFile(join(root, name + ".sha256"), createHash("sha256").update(script).digest("hex") + "  " + name + "\n");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bruv-launcher-gate-test-"));
  for (const target of releaseTargets)
    await put(root, target, (target === "android-arm64" ? "#!/system/bin/sh\n" : "#!/bin/sh\n") + body);
  return root;
}

test("release launcher gate verifies checksums and suffixed/installed siblings without PATH tools", async () => {
  const root = await fixture();
  try {
    await verifyReleaseLaunchers(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gate rejects a compiled or wrong-interpreter connector and stale checksums", async () => {
  const root = await fixture();
  try {
    await put(root, "android-arm64", "#!/bin/sh\n" + body);
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("#!/system/bin/sh");
    await put(root, "android-arm64", "#!/system/bin/sh\n" + body);
    await put(root, "linux-x64", "ELF compiled connector");
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("tiny POSIX launcher");
    await put(root, "linux-x64", "#!/bin/sh\n" + body);
    await writeFile(join(root, "bruv-claude-compat-linux-x64.sha256"), "invalid checksum\n");
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("checksum does not match");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gate rejects launchers that lose arguments, do not exec, hardcode a release suffix, or cannot execute", async () => {
  const root = await fixture();
  try {
    await put(root, "linux-x64", "#!/bin/sh\n" + body.replace('"$@"', "$@"));
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("forward arguments and exit status");
    await put(root, "linux-x64", "#!/bin/sh\n" + body.replace("exec ", ""));
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("must exec its matching sibling");
    await put(root, "linux-x64", "#!/bin/sh\n" + body.replace("bruv$suffix", "bruv-linux-x64"));
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("installed");
    await put(root, "linux-x64", "#!/bin/sh\n" + body);
    await chmod(join(root, "bruv-claude-compat-linux-x64"), 0o644);
    await expect(verifyReleaseLaunchers(root)).rejects.toThrow("must be executable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
