import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const releaseTargets = ["linux-x64", "linux-arm64", "darwin-arm64", "android-arm64"] as const;

/** Probe the shipped script, not a reimplementation. Android syntax is checked
 * with the host POSIX shell here; native Android execution is not claimed. */
export async function verifyReleaseLaunchers(directory: string) {
  for (const target of releaseTargets) {
    const name = "bruv-claude-compat-" + target;
    const source = join(directory, name);
    const bytes = await readFile(source);
    const shebang = target === "android-arm64" ? "#!/system/bin/sh\n" : "#!/bin/sh\n";
    if (!bytes.toString().startsWith(shebang) || bytes.length > 4096)
      throw new Error(name + " must be a tiny POSIX launcher with " + shebang.trim());
    if (!((await stat(source)).mode & 0o111)) throw new Error(name + " must be executable");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if ((await readFile(source + ".sha256", "utf8")) !== hash + "  " + name + "\n")
      throw new Error(name + " checksum does not match the launcher");
    const temporary = await mkdtemp(join(tmpdir(), "bruv release launcher "));
    try {
      // Release assets have target suffixes; installed files have canonical names.
      for (const suffix of ["-" + target, ""]) {
        const launcher = join(temporary, "bruv-claude-compat" + suffix);
        const binary = join(temporary, "bruv" + suffix);
        await copyFile(source, launcher);
        await writeFile(
          binary,
          '#!/bin/sh\n[ "$1" = claude-compat ] || exit 99\nshift\nprintf \'%s\\n\' "$$" "$@"\nexit 37\n',
        );
        await chmod(binary, 0o755);
        const probe = spawnSync("/bin/sh", [launcher, "space argument", "", "*"], {
          cwd: temporary,
          env: { PATH: "/nonexistent", HOME: temporary },
          encoding: "utf8",
        });
        if (probe.error || probe.status !== 37 || probe.stdout !== probe.pid + "\nspace argument\n\n*\n")
          throw new Error(
            name +
              " must exec its matching sibling and forward arguments and exit status (" +
              (suffix || "installed") +
              "): " +
              probe.stderr,
          );
        await rm(launcher);
        await rm(binary);
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  await verifyReleaseLaunchers(resolve(process.argv[2] ?? "dist/release"));
  console.log("Verified all release launcher checksums, interpreters and sibling dispatch (host POSIX shell).");
}
