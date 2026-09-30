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
  return names.filter((name) => name !== "@types/bun");
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

export function markdownVersionSummary(before: DependencyManifest, after: DependencyManifest): string {
  const rows: string[] = [];
  for (const section of sections) {
    const oldVersions = before[section] ?? {};
    const newVersions = after[section] ?? {};
    const names = [...new Set([...Object.keys(oldVersions), ...Object.keys(newVersions)])].sort();
    for (const name of names) {
      if (oldVersions[name] !== newVersions[name]) {
        rows.push(
          "| " +
            section +
            " | " +
            name +
            " | " +
            (oldVersions[name] ?? "—") +
            " | " +
            (newVersions[name] ?? "—") +
            " |",
        );
      }
    }
  }
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

/** Include transitive changes too: root declarations can stay unchanged. */
export function markdownLockSummary(beforeText: string, afterText: string): string {
  const before = Bun.JSONC.parse(beforeText).packages as Record<string, [string, ...unknown[]]>;
  const after = Bun.JSONC.parse(afterText).packages as Record<string, [string, ...unknown[]]>;
  const rows = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((name) => before[name]?.[0] !== after[name]?.[0])
    .map((name) => "| " + name + " | " + (before[name]?.[0] ?? "—") + " | " + (after[name]?.[0] ?? "—") + " |");
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
      throw new Error("Usage: bun scripts/update-dependencies.ts [--fixture]");
    const root = fileURLToPath(new URL("../", import.meta.url));
    const manifestFile = Bun.file(new URL("../package.json", import.meta.url));
    const before = (await manifestFile.json()) as DependencyManifest;
    const lockFile = Bun.file(new URL("../bun.lock", import.meta.url));
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
    for (const section of sections) {
      if (before[section]?.["@types/bun"] !== after[section]?.["@types/bun"]) {
        throw new Error("bun update changed the protected @types/bun toolchain version");
      }
    }
    validatePiAlignment(after);
    const artifactDir = new URL("../artifacts/dependency-update/", import.meta.url);
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
