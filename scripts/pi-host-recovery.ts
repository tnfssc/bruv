import { execFile } from "node:child_process";
import { copyFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  adaptPiHostFile,
  piHostPatches,
  preparePiHost,
  replacePiHostFiles,
  UnsupportedPiHostFileError,
} from "./pi-host-adaptation";

// The wrapper owns stage lifetime. Tests can supply exact clean fixtures without
// network or cache access; acquisition never has permission to repair the target.
interface RecoveryOptions {
  acquireCleanSource?: (projectRoot: string, stage: string) => Promise<string>;
  notice?: (message: string) => void;
}

async function acquireCleanSource(projectRoot: string, stage: string): Promise<string> {
  await copyFile(join(projectRoot, "package.json"), join(stage, "package.json"));
  await copyFile(join(projectRoot, "bun.lock"), join(stage, "bun.lock"));
  await cp(join(projectRoot, "patches"), join(stage, "patches"), { recursive: true });
  const cache = join(stage, "cache");
  await promisify(execFile)(
    process.execPath,
    ["install", "--frozen-lockfile", "--ignore-scripts", "--cache-dir", cache, "--backend", "copy"],
    {
      cwd: stage,
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: cache },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return join(stage, "node_modules/@earendil-works/pi-coding-agent");
}

export async function preparePiHostWithRecovery(
  projectRoot: string,
  piRoot: string,
  options: RecoveryOptions = {},
): Promise<void> {
  try {
    await preparePiHost(piRoot);
    return;
  } catch (error) {
    if (!(error instanceof UnsupportedPiHostFileError)) throw error;
  }

  const stage = await mkdtemp(join(tmpdir(), "bruv-pi-host-recovery-"));
  try {
    let cleanRoot: string;
    try {
      cleanRoot = await (options.acquireCleanSource ?? acquireCleanSource)(projectRoot, stage);
    } catch (error) {
      throw new Error(
        "Pi host recovery could not obtain a clean dependency install; local host files were not changed. " +
          "Check network/registry access and package.json, bun.lock and patches, then retry bun run prepare:assets. " +
          String(error),
        { cause: error },
      );
    }
    // Strict original/adapted hashes and version gate apply to the clean install
    // too. Never treat a successful download as permission to accept new bytes.
    await preparePiHost(cleanRoot);
    const prepared = await Promise.all(
      piHostPatches.map(async (patch) => {
        const path = join(piRoot, patch.path);
        const after = adaptPiHostFile(patch, await readFile(join(cleanRoot, patch.path), "utf8"));
        return { path, before: await readFile(path, "utf8"), after };
      }),
    );
    await replacePiHostFiles(prepared);
    (options.notice ?? console.warn)(
      "Recovered stale/contaminated Pi host files from a clean isolated install. Only this checkout's host patch files were replaced; shared Bun cache was not changed.",
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
