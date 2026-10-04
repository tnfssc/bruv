import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import bruvPackage from "../package.json";

export const RELEASES_URL = "https://api.github.com/repos/tnfssc/bruv/releases/latest";
export const UPDATE_ASSETS = {
  "linux-x64": "bruv-linux-x64",
  "linux-arm64": "bruv-linux-arm64",
  "darwin-arm64": "bruv-darwin-arm64",
  "android-arm64": "bruv-android-arm64",
} as const;
export type UpdateAssetKey = keyof typeof UPDATE_ASSETS;
export const UPDATE_ASSET = UPDATE_ASSETS["linux-x64"];
export function updateAssetFor(platform: NodeJS.Platform, arch: string): string | undefined {
  return UPDATE_ASSETS[`${platform}-${arch}` as UpdateAssetKey];
}
export type UpdateResult = { status: "updated" | "current" | "newer" | "available"; version: string; path?: string };
export type UpdateDeps = {
  fetch?: typeof fetch;
  executable?: string;
  currentVersion?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  compiled?: boolean;
  check?: boolean;
  runBinary?: (path: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;
  rename?: typeof rename;
  onDownload?: (version: string) => void;
};
function version(value: string): [number, number, number] | undefined {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/** Only Bun's virtual compiled module namespace, not similarly named source directories. */
export function isCompiledInvocation(moduleUrl = import.meta.url): boolean {
  return moduleUrl.startsWith("file:///$bunfs/");
}
export async function updateBruv(deps: UpdateDeps = {}): Promise<UpdateResult> {
  if (!(deps.compiled ?? isCompiledInvocation()))
    throw new Error("Refusing to self-update a source Bun invocation; run the compiled bruv executable.");
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const updateAsset = updateAssetFor(platform, arch);
  if (!updateAsset)
    throw new Error(
      "Self-update is currently supported only on Linux x64/arm64, macOS arm64, and Android/Termux arm64.",
    );
  const current = deps.currentVersion ?? bruvPackage.version;
  const currentParts = version(current);
  if (!currentParts) throw new Error("Cannot self-update this development version: " + current);
  const http = deps.fetch ?? fetch;
  const request = (url: string, accept: string) =>
    http(url, {
      headers: { accept, "user-agent": "bruv/" + current },
      signal: AbortSignal.timeout(300_000),
    });
  let release: unknown;
  try {
    const response = await request(RELEASES_URL, "application/vnd.github+json");
    if (!response.ok) throw new Error("GitHub returned HTTP " + response.status);
    release = await response.json();
  } catch (error) {
    throw new Error("Unable to check for updates: " + errorMessage(error));
  }
  if (!isRecord(release) || typeof release.tag_name !== "string")
    throw new Error("GitHub returned an invalid stable release version.");
  const latestParts = version(release.tag_name);
  if (!latestParts || release.prerelease || release.draft)
    throw new Error("GitHub returned an invalid stable release version.");
  const tag = release.tag_name;
  const latest = tag.replace(/^v/, "");
  const relation =
    latestParts[0] - currentParts[0] || latestParts[1] - currentParts[1] || latestParts[2] - currentParts[2];

  const assets: unknown[] = Array.isArray(release.assets) ? release.assets : [];
  const assetUrl = (name: string): string => {
    const matches = assets.filter((asset): asset is Record<string, unknown> => isRecord(asset) && asset.name === name);
    const expected = "https://github.com/tnfssc/bruv/releases/download/" + encodeURIComponent(tag) + "/" + name;
    if (matches.length !== 1 || matches[0]?.browser_download_url !== expected)
      throw new Error("The release is missing a valid official " + name + " asset.");
    return expected;
  };
  const connectorAsset = updateAsset.replace(/^bruv-/, "bruv-claude-compat-");
  // Resolve all four official assets before downloading or changing anything.
  const downloads = [updateAsset, connectorAsset].map((name) => ({
    name,
    binaryUrl: assetUrl(name),
    checksumUrl: assetUrl(name + ".sha256"),
  }));
  let target: string;
  let original: Awaited<ReturnType<typeof stat>>;
  let connectorOriginal: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    target = await realpath(deps.executable ?? process.execPath);
    original = await stat(target);
    if (!original.isFile()) throw new Error("not a regular file");
    if (basename(target) !== "bruv" || original.nlink !== 1)
      throw new Error("expected a single bruv file with sibling bruv-claude-compat");
    connectorOriginal = await inspectOptional(join(dirname(target), "bruv-claude-compat"));
    if (connectorOriginal && (!connectorOriginal.isFile() || connectorOriginal.nlink !== 1))
      throw new Error("connector must be a regular sibling file, not a symlink, directory or hard link");
  } catch (error) {
    throw new Error(
      "Installation layout needs manual action; reinstall the matched pair in one directory: " + errorMessage(error),
    );
  }
  const connector = join(dirname(target), "bruv-claude-compat");
  // Never let a caller's launcher override conceal a mismatched installed pair.
  const probeEnv = { ...process.env };
  delete probeEnv.BRUV_CLAUDE_COMPAT_BRUV_PATH;
  const binaryRunner = deps.runBinary ?? runBinary;
  const run = (path: string, args: string[], bruvPath?: string) =>
    binaryRunner(path, args, bruvPath ? { ...probeEnv, BRUV_CLAUDE_COMPAT_BRUV_PATH: bruvPath } : probeEnv);
  if (relation <= 0) {
    let matched = false;
    if (connectorOriginal) {
      try {
        let product: string | undefined;
        try {
          product = (await run(connector, ["--bruv-version"])).trim();
        } catch {
          /* The old standalone connector does not implement this flag. */
        }
        // Fallback only for an installed pre-migration connector, never a candidate.
        matched =
          product === "bruv-claude-compat " + current ||
          (!product && (await run(connector, ["--version"])).trim() === "bruv-claude-compat " + current);
      } catch {
        /* A broken connector can be repaired from the same stable release. */
      }
    }
    if (relation < 0) {
      if (!matched)
        throw new Error(
          "bruv is newer than the stable release but its connector is missing or mismatched; reinstall a matching pair manually (no downgrade performed).",
        );
      return { status: "newer", version: current };
    }
    if (matched) return { status: "current", version: latest };
  }
  if (deps.check) return { status: "available", version: latest };
  deps.onDownload?.(latest);
  let stage: string | undefined;
  let keepRecovery = false;
  const move = deps.rename ?? rename;
  const replaced: { path: string; backup?: string }[] = [];
  try {
    stage = await mkdtemp(join(dirname(target), ".bruv-update-"));
    const files = [
      { path: target, original, name: "bruv" },
      { path: connector, original: connectorOriginal, name: "bruv-claude-compat" },
    ];
    for (const [index, file] of files.entries()) {
      const asset = downloads[index]!;
      let bytes: Uint8Array;
      try {
        const response = await request(asset.binaryUrl, "application/octet-stream");
        if (!response.ok) throw new Error("HTTP " + response.status);
        bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) throw new Error("empty download");
      } catch (error) {
        throw new Error("Unable to download " + asset.name + ": " + errorMessage(error));
      }
      try {
        const response = await request(asset.checksumUrl, "text/plain");
        if (!response.ok) throw new Error("HTTP " + response.status);
        const escapedAsset = asset.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp("^([a-fA-F0-9]{64})[ \t]+\\*?" + escapedAsset + "$").exec(
          (await response.text()).trim(),
        );
        if (!match) throw new Error("invalid checksum format or filename");
        if (createHash("sha256").update(bytes).digest("hex") !== match[1]!.toLowerCase())
          throw new Error("download does not match the release SHA256");
      } catch (error) {
        throw new Error("Checksum verification failed for " + asset.name + ": " + errorMessage(error));
      }
      const staged = join(stage, file.name);
      const mode = (Number(file.original?.mode ?? original.mode) & 0o777) | 0o100;
      await writeFile(staged, bytes, { mode, flag: "wx" });
      await chmod(staged, mode);
    }
    // Product versions are independent of Claude compatibility --version output.
    if (
      (await run(join(stage, "bruv"), ["--version"])).trim() !== latest ||
      (await run(join(stage, "bruv-claude-compat"), ["--bruv-version"], join(stage, "bruv"))).trim() !==
        "bruv-claude-compat " + latest
    )
      throw new Error("Staged Bruv pair version mismatch (expected " + latest + ")");
    if (platform === "darwin" && arch === "arm64") await run(join(stage, "bruv"), ["--live-self-test"]);
    for (const file of files) {
      if (file.original) await copyFile(file.path, join(stage, file.name + ".previous"));
    }
    for (const file of files) {
      const now = await inspectOptional(file.path);
      if (!sameFile(now, file.original))
        throw new Error(file.name + " executable changed during the update; run bruv update again");
    }
    // Two renames are NOT a transaction. Keep originals until both have succeeded.
    for (const file of [files[1]!, files[0]!]) {
      await move(join(stage, file.name), file.path);
      replaced.push({ path: file.path, backup: file.original ? join(stage, file.name + ".previous") : undefined });
    }
  } catch (error) {
    const failures: string[] = [];
    for (const file of replaced.reverse()) {
      try {
        if (file.backup) await move(file.backup, file.path);
        else await rm(file.path);
      } catch (rollbackError) {
        failures.push(
          (file.backup ? "restore " + file.backup + " to " + file.path : "remove newly added " + file.path) +
            ": " +
            errorMessage(rollbackError),
        );
      }
    }
    keepRecovery = failures.length > 0;
    throw new Error(
      "Could not update Bruv pair; check installation-directory permissions: " +
        errorMessage(error) +
        (keepRecovery
          ? ". Rollback failed: " +
            failures.join("; ") +
            ". Stop Bruv/T3 sessions. Recovery files retained at " +
            stage +
            "; restore *.previous to their sibling installed names (or reinstall the matching pair). Do not treat this install as updated."
          : replaced.length
            ? ". Previous installation restored."
            : ". Installed files unchanged."),
    );
  } finally {
    if (stage && !keepRecovery) await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
  return { status: "updated", version: latest, path: target };
}
async function inspectOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function sameFile(a: Awaited<ReturnType<typeof lstat>> | undefined, b: Awaited<ReturnType<typeof lstat>> | undefined) {
  if (!a || !b) return a === b;
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
async function runBinary(path: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const child = Bun.spawn([path, ...args], { env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(path + " " + args.join(" ") + " failed: " + stderr.trim());
  return stdout;
}
