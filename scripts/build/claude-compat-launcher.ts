import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export function normalOutputForConnector(output: string): string {
  const name = basename(output);
  if (!/^bruv-claude-compat(?:$|-(?:linux|darwin|android)-[a-z0-9-]+$)/.test(name))
    throw new Error(
      "Connector output must be named bruv-claude-compat (optionally with a supported target suffix); must not overwrite normal Bruv",
    );
  return resolve(dirname(output), name.replace("bruv-claude-compat", "bruv"));
}

/** Unix system shell only: never a second Bun runtime, env shell or PATH bruv. */
export async function connectorLauncher(target = "bun-" + process.platform + "-" + process.arch): Promise<string> {
  if (!/^bun-(linux|darwin|android)-/.test(target)) throw new Error("Unsupported launcher target: " + target);
  const interpreter = target.startsWith("bun-android-") ? "/system/bin/sh" : "/bin/sh";
  const template = await readFile(new URL("./bruv-claude-compat.sh", import.meta.url), "utf8");
  return template.replace("#!/bin/sh", "#!" + interpreter);
}

export async function writeConnectorLauncher(output: string, target?: string): Promise<void> {
  normalOutputForConnector(output);
  try {
    const file = await lstat(output);
    if (file.isSymbolicLink() || !file.isFile() || file.nlink > 1)
      throw new Error("Connector output must be a regular file, not a symlink or hardlink");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, await connectorLauncher(target));
  await chmod(output, 0o755);
}
