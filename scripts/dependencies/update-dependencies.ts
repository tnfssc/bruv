import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface DependencyManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface UpdateOptions {
  fixture?: boolean;
  env?: Record<string, string | undefined>;
}

const fixtureRepository = "tnfssc/die-dependency-pr-fixture-20260930";
const sections = ["dependencies", "devDependencies"] as const;
const protectedToolchainPackage = "@types/bun";

/** Explicit names allow Bun to update exact pins and cross major versions too. */
export function selectDependencyNames(manifest: DependencyManifest, options: UpdateOptions = {}): string[] {
  const names = [...new Set(sections.flatMap((section) => Object.keys(manifest[section] ?? {})))].sort();
  if (options.fixture) {
    const env = options.env ?? {};
    if (env.GITHUB_REPOSITORY !== fixtureRepository || env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
      throw new Error(`--fixture is only allowed for workflow_dispatch in ${fixtureRepository}`);
    }
    if (!names.includes("resolve.exports")) throw new Error("Fixture requires root dependency resolve.exports");
    return ["resolve.exports"];
  }
  return names.filter((name) => name !== protectedToolchainPackage);
}

/** Check root Pi declarations only; no vendor hashes or migrations belong here. */
export function validatePiAlignment(manifest: DependencyManifest): void {
  const entries = sections.flatMap((section) =>
    Object.entries(manifest[section] ?? {}).filter(([name]) => name.startsWith("@earendil-works/pi-")),
  );
  if (new Set(entries.map(([, version]) => version)).size > 1) {
    throw new Error(
      `Root Pi package versions are not aligned: ${entries.map(([name, version]) => `${name}=${version}`).join(", ")}`,
    );
  }
}

/** Only a valid update can produce the review artifact. */
export function validateDependencyUpdate(before: DependencyManifest, after: DependencyManifest): void {
  for (const section of sections) {
    if (before[section]?.[protectedToolchainPackage] !== after[section]?.[protectedToolchainPackage]) {
      throw new Error("bun update changed the protected @types/bun toolchain version");
    }
  }
  validatePiAlignment(after);
}

type Versions = Record<string, string | undefined>;

/** Compare own package entries in name order; absent entries have no version. */
function versionChanges(before: Versions, after: Versions) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .map((name) => ({
      name,
      before: Object.hasOwn(before, name) ? before[name] : undefined,
      after: Object.hasOwn(after, name) ? after[name] : undefined,
    }))
    .filter((change) => change.before !== change.after);
}

export function markdownVersionSummary(before: DependencyManifest, after: DependencyManifest): string {
  const rows = sections.flatMap((section) =>
    versionChanges(before[section] ?? {}, after[section] ?? {}).map(
      (change) => `| ${section} | ${change.name} | ${change.before ?? "—"} | ${change.after ?? "—"} |`,
    ),
  );
  if (rows.length === 0) {
    return "# Dependency version updates\n\nNo root dependency version declarations changed. Any dependency changes are lockfile-only.\n";
  }
  return [
    "# Dependency version updates",
    "",
    "| Section | Package | Before | After |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** Ignore lockfile metadata: only the resolved package identifier is a version. */
function resolvedVersions(lockText: string): Versions {
  type Lock = { packages: Record<string, [string, ...unknown[]]> };
  const { packages } = Bun.JSONC.parse(lockText) as Lock;
  return Object.fromEntries(Object.entries(packages).map(([name, entry]) => [name, entry?.[0]]));
}

/** Include transitive changes too: root declarations can stay unchanged. */
export function markdownLockSummary(beforeText: string, afterText: string): string {
  const rows = versionChanges(resolvedVersions(beforeText), resolvedVersions(afterText)).map(
    (change) => `| ${change.name} | ${change.before ?? "—"} | ${change.after ?? "—"} |`,
  );
  if (rows.length === 0)
    return "\n## Lockfile packages\n\nNo resolved package versions changed; review any lockfile metadata diff.\n";
  return [
    "",
    "## Lockfile packages (including transitives)",
    "",
    "| Package key | Before | After |",
    "| --- | --- | --- |",
    ...rows.slice(0, 200),
    ...(rows.length > 200 ? ["", "Further package changes omitted; see the full lockfile diff."] : []),
    "",
  ].join("\n");
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--fixture"))
      throw new Error("Usage: bun scripts/dependencies/update-dependencies.ts [--fixture]");
    const root = fileURLToPath(new URL("../", import.meta.url));
    const manifestFile = Bun.file(new URL("../../package.json", import.meta.url));
    const before = (await manifestFile.json()) as DependencyManifest;
    const lockFile = Bun.file(new URL("../../bun.lock", import.meta.url));
    const beforeLock = await lockFile.text();
    const names = selectDependencyNames(before, { fixture: args.includes("--fixture"), env: process.env });
    if (names.length > 0) {
      const child = Bun.spawn([process.execPath, "update", "--latest", ...names], {
        cwd: root,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await child.exited;
      if (exitCode !== 0) throw new Error(`bun update failed with exit code ${exitCode}`);
    }
    const after = (await manifestFile.json()) as DependencyManifest;
    validateDependencyUpdate(before, after);
    const artifactDir = new URL("../../artifacts/dependency-update", import.meta.url);
    await mkdir(artifactDir, { recursive: true });
    await Bun.write(
      new URL("versions.md", artifactDir),
      markdownVersionSummary(before, after) + markdownLockSummary(beforeLock, await lockFile.text()),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
