import { deepStrictEqual, ok } from "node:assert/strict";
import { posix } from "node:path";

type Dependency = string | { version: string };
type Entry = {
  dependencies?: Record<string, Dependency>;
  devDependencies?: Record<string, Dependency>;
  optionalDependencies?: Record<string, Dependency>;
};
type Lock = Record<string, unknown> & {
  importers: Record<string, Entry>;
  packages: Record<string, unknown>;
  snapshots: Record<string, Entry>;
};

/** pnpm prunes unshipped packages from its installed lock, not from the official
 * source lock. Require unchanged pins/metadata and the complete fixture runtime
 * closure; byte equality would force us to fork the upstream dependency graph.
 */
export function assertMigrationDependencies(sourceText: string, installedText: string): void {
  const source = Bun.YAML.parse(sourceText) as Lock;
  const installed = Bun.YAML.parse(installedText) as Lock;
  const metadata = (lock: Lock) =>
    Object.fromEntries(Object.entries(lock).filter(([key]) => key !== "packages" && key !== "snapshots"));
  deepStrictEqual(metadata(installed), metadata(source), "installed lock metadata/importers differ from pinned source");
  for (const section of ["packages", "snapshots"] as const) {
    ok(installed[section] && source[section], "missing lock graph section");
    for (const [key, value] of Object.entries(installed[section])) {
      ok(Object.hasOwn(source[section], key), "unpinned installed dependency: " + key);
      deepStrictEqual(value, source[section][key], "installed " + section + " entry differs from source: " + key);
    }
  }
  const seen = new Set<string>();
  function visit(entry: Entry, importer?: string): void {
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      for (const [name, reference] of Object.entries(entry[field] ?? {})) {
        const version = typeof reference === "string" ? reference : reference.version;
        if (version.startsWith("link:")) {
          ok(importer !== undefined, "unexpected workspace link in package snapshot");
          const key = posix.normalize(posix.join(importer, version.slice(5)));
          if (seen.has("workspace:" + key)) continue;
          seen.add("workspace:" + key);
          ok(installed.importers[key], "missing installed workspace: " + key);
          visit(installed.importers[key], key);
        } else {
          // pnpm aliases store the resolved package name in the reference.
          const key = version.split("(")[0]!.includes("@") ? version : name + "@" + version;
          if (seen.has(key)) continue;
          seen.add(key);
          ok(installed.snapshots[key], "missing installed dependency snapshot: " + key);
          ok(installed.packages[key.split("(")[0]!], "missing installed dependency package: " + key);
          visit(installed.snapshots[key]);
        }
      }
    }
  }
  ok(installed.importers["apps/server"], "missing installed server importer");
  visit(installed.importers["apps/server"], "apps/server");
}
