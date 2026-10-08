import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
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
type Version = [number, number, number];
// Keep metadata/checksum requests bounded separately from ~90 MB release binaries.
const METADATA_TIMEOUT_MS = 300_000;
const DOWNLOAD_TIMEOUT_MS = 900_000;
type ReleaseRequest = (url: string, accept: string, timeoutMs?: number) => Promise<Response>;
type ReleaseArtifact = { name: string; binaryUrl: string; checksumUrl: string };
type StableRelease = { version: string; parts: Version; bruv: ReleaseArtifact; connector: ReleaseArtifact };
type InstalledExecutable = { name: string; path: string; original?: Stats };
type InstalledPair = {
  bruv: Required<InstalledExecutable>;
  connector: InstalledExecutable;
};
type PairProbe = (path: string, args: string[], bruvPath?: string) => Promise<string>;

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
  const request: ReleaseRequest = (url, accept, timeoutMs = METADATA_TIMEOUT_MS) =>
    http(url, {
      headers: { accept, "user-agent": "bruv/" + current },
      signal: AbortSignal.timeout(timeoutMs),
    });
  const release = await fetchStablePair(request, updateAsset);
  const installed = await inspectInstalledPair(deps.executable ?? process.execPath);
  const run = pairProbe(deps.runBinary ?? runBinary);
  const relation =
    release.parts[0] - currentParts[0] || release.parts[1] - currentParts[1] || release.parts[2] - currentParts[2];
  if (relation <= 0) {
    const matched = await installedConnectorMatches(installed.connector, current, run);
    if (relation < 0) {
      if (!matched)
        throw new Error(
          "bruv is newer than the stable release but its connector is missing or mismatched; reinstall a matching pair manually (no downgrade performed).",
        );
      return { status: "newer", version: current };
    }
    if (matched) return { status: "current", version: release.version };
  }
  if (deps.check) return { status: "available", version: release.version };
  deps.onDownload?.(release.version);
  await installReleasePair(
    installed,
    release,
    request,
    run,
    deps.rename ?? rename,
    platform === "darwin" && arch === "arm64",
  );
  return { status: "updated", version: release.version, path: installed.bruv.path };
}

async function fetchStablePair(request: ReleaseRequest, updateAsset: string): Promise<StableRelease> {
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
  const artifact = (name: string): ReleaseArtifact => ({
    name,
    binaryUrl: assetUrl(name),
    checksumUrl: assetUrl(name + ".sha256"),
  });
  return { version: latest, parts: latestParts, bruv: artifact(updateAsset), connector: artifact(connectorAsset) };
}

async function inspectInstalledPair(executable: string): Promise<InstalledPair> {
  let target: string;
  let original: Stats;
  let connectorOriginal: Stats | undefined;
  try {
    target = await realpath(executable);
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
  return {
    bruv: { name: "bruv", path: target, original },
    connector: {
      name: "bruv-claude-compat",
      path: join(dirname(target), "bruv-claude-compat"),
      original: connectorOriginal,
    },
  };
}

function pairProbe(binaryRunner: NonNullable<UpdateDeps["runBinary"]>): PairProbe {
  // Never let a caller's launcher override conceal a mismatched installed pair.
  const probeEnv = { ...process.env };
  delete probeEnv.BRUV_CLAUDE_COMPAT_BRUV_PATH;
  return (path, args, bruvPath) =>
    binaryRunner(path, args, bruvPath ? { ...probeEnv, BRUV_CLAUDE_COMPAT_BRUV_PATH: bruvPath } : probeEnv);
}

async function installedConnectorMatches(
  connector: InstalledExecutable,
  current: string,
  run: PairProbe,
): Promise<boolean> {
  if (!connector.original) return false;
  try {
    let product: string | undefined;
    try {
      product = (await run(connector.path, ["--bruv-version"])).trim();
    } catch {
      /* The old standalone connector does not implement this flag. */
    }
    // Fallback only for an installed pre-migration connector, never a candidate.
    return (
      product === "bruv-claude-compat " + current ||
      (!product && (await run(connector.path, ["--version"])).trim() === "bruv-claude-compat " + current)
    );
  } catch {
    // A broken connector can be repaired from the same stable release.
    return false;
  }
}

async function stageVerifiedExecutable(
  stage: string,
  file: InstalledExecutable,
  artifact: ReleaseArtifact,
  bruvMode: number,
  request: ReleaseRequest,
): Promise<void> {
  let bytes: Uint8Array;
  try {
    const response = await request(artifact.binaryUrl, "application/octet-stream", DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) throw new Error("HTTP " + response.status);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("empty download");
  } catch (error) {
    throw new Error("Unable to download " + artifact.name + ": " + errorMessage(error));
  }
  try {
    const response = await request(artifact.checksumUrl, "text/plain");
    if (!response.ok) throw new Error("HTTP " + response.status);
    const escapedAsset = artifact.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp("^([a-fA-F0-9]{64})[ \t]+\\*?" + escapedAsset + "$").exec((await response.text()).trim());
    if (!match) throw new Error("invalid checksum format or filename");
    if (createHash("sha256").update(bytes).digest("hex") !== match[1]!.toLowerCase())
      throw new Error("download does not match the release SHA256");
  } catch (error) {
    throw new Error("Checksum verification failed for " + artifact.name + ": " + errorMessage(error));
  }
  const staged = join(stage, file.name);
  const mode = (Number(file.original?.mode ?? bruvMode) & 0o777) | 0o100;
  await writeFile(staged, bytes, { mode, flag: "wx" });
  await chmod(staged, mode);
}

async function installReleasePair(
  installed: InstalledPair,
  release: StableRelease,
  request: ReleaseRequest,
  run: PairProbe,
  move: typeof rename,
  checkLiveHelper: boolean,
): Promise<void> {
  let stage: string | undefined;
  let keepRecovery = false;
  const replaced: { path: string; backup?: string }[] = [];
  let phase = "create staging directory";
  try {
    stage = await mkdtemp(join(dirname(installed.bruv.path), ".bruv-update-"));
    phase = "download and stage " + release.bruv.name;
    await stageVerifiedExecutable(stage, installed.bruv, release.bruv, installed.bruv.original.mode, request);
    phase = "download and stage " + release.connector.name;
    await stageVerifiedExecutable(stage, installed.connector, release.connector, installed.bruv.original.mode, request);
    const stagedBruv = join(stage, installed.bruv.name);
    const stagedConnector = join(stage, installed.connector.name);
    phase = "verify staged Bruv pair";
    // Product versions are independent of Claude compatibility --version output.
    if (
      (await run(stagedBruv, ["--version"])).trim() !== release.version ||
      (await run(stagedConnector, ["--bruv-version"], stagedBruv)).trim() !== "bruv-claude-compat " + release.version
    )
      throw new Error("Staged Bruv pair version mismatch (expected " + release.version + ")");
    if (checkLiveHelper) await run(stagedBruv, ["--live-self-test"]);
    phase = "back up installed Bruv pair";
    const files = [installed.bruv, installed.connector];
    for (const file of files) {
      if (file.original) await copyFile(file.path, join(stage, file.name + ".previous"));
    }
    phase = "check installed Bruv pair for concurrent changes";
    for (const file of files) {
      const now = await inspectOptional(file.path);
      if (!sameFile(now, file.original))
        throw new Error(file.name + " executable changed during the update; run bruv update again");
    }
    // Two renames are NOT a transaction. Publish the connector first; retain originals until both succeed.
    for (const file of [installed.connector, installed.bruv]) {
      phase = "replace installed " + file.name;
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
      "Could not update Bruv pair (" +
        phase +
        "): " +
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
}
async function inspectOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function sameFile(a: Stats | undefined, b: Stats | undefined) {
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
