import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function compareStableVersions(left: string, right: string): number {
  const leftParts = left.replace(/^v/, "").split(".").map(Number);
  const rightParts = right.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = leftParts[i] - rightParts[i];
    if (difference) return difference;
  }
  return 0;
}

export function nextReleaseVersion(version: string, latestTag?: string): string {
  const valid = /^v?(\d+)\.(\d+)\.(\d+)$/;
  const current = valid.exec(version);
  if (!current || version.startsWith("v")) throw new Error("package version must be stable semver");
  const last = latestTag ? valid.exec(latestTag) : undefined;
  if (latestTag && (!last || !latestTag.startsWith("v"))) throw new Error("invalid latest stable tag");
  const comparison = latestTag ? compareStableVersions(version, latestTag) : 0;
  if (latestTag && comparison > 0) return version; // Already prepared on develop.
  const base = last && comparison < 0 ? last : current;
  return [base[1], base[2], Number(base[3]) + 1].join(".");
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../..");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const pkgPath = resolve(root, "package.json");
  const packageSource = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(packageSource) as { version: string };
  const tags = git("tag", "-l", "v*")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  tags.sort((a, b) => compareStableVersions(b, a));
  const latest = tags[0];
  const version = nextReleaseVersion(pkg.version, latest);
  const tag = "v" + version;
  if (tags.includes(tag)) throw new Error("release tag already exists: " + tag);
  const notesPath = resolve(root, "support", "releases", "release-" + tag + ".md");
  const range = latest ? latest + "..HEAD" : "HEAD";
  const subjects = git("log", "--format=%s", range).split("\n").filter(Boolean);
  if (!subjects.length) throw new Error("no changes since last release; refusing empty release");
  if (!existsSync(notesPath)) {
    const notes = subjects
      .filter((subject) => !/^Prepare v\d+\.\d+\.\d+ release$/.test(subject))
      .map((subject) => "- " + subject.replace(/[\r\n]/g, " "))
      .join("\n");
    if (!notes) throw new Error("no release changes to document");
    writeFileSync(notesPath, "# " + tag + "\n\n" + notes + "\n");
  }
  if (statSync(notesPath).size === 0) throw new Error("release notes are empty: " + notesPath);
  if (version !== pkg.version) {
    const updated = packageSource.replace('"version": "' + pkg.version + '"', '"version": "' + version + '"');
    if (packageSource === updated) throw new Error("could not update package version");
    writeFileSync(pkgPath, updated);
  }
  process.stdout.write(tag);
}
