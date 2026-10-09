import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const assetNames = [
  "bruv-linux-x64",
  "bruv-linux-x64.sha256",
  "bruv-linux-arm64",
  "bruv-linux-arm64.sha256",
  "bruv-darwin-arm64",
  "bruv-darwin-arm64.sha256",
  "bruv-android-arm64",
  "bruv-android-arm64.sha256",
  "bruv-claude-compat-linux-x64",
  "bruv-claude-compat-linux-x64.sha256",
  "bruv-claude-compat-linux-arm64",
  "bruv-claude-compat-linux-arm64.sha256",
  "bruv-claude-compat-darwin-arm64",
  "bruv-claude-compat-darwin-arm64.sha256",
  "bruv-claude-compat-android-arm64",
  "bruv-claude-compat-android-arm64.sha256",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_LICENSES.txt",
  "SOURCE.txt",
] as const;

type Asset = { name: string; size: number; digest: string | null };
type Release = { draft: boolean; assets: Asset[] };

/** Fail closed on extras, duplicates or different bytes; only absent draft assets are repairable. */
export function missingReleaseAssets(release: Release, expected: Map<string, Asset>): string[] {
  const seen = new Set<string>();
  for (const asset of release.assets) {
    const local = expected.get(asset.name);
    if (!local || seen.has(asset.name) || asset.size !== local.size || asset.digest !== local.digest)
      throw new Error(`Release asset differs from verified build: ${asset.name}`);
    seen.add(asset.name);
  }
  const missing = [...expected.keys()].filter((name) => !seen.has(name));
  if (missing.length && !release.draft) throw new Error("Published release is incomplete; refusing to change it");
  return missing;
}

export function tagAction(remoteSha: string | undefined, expectedSha: string): "push" | "reuse" {
  if (!remoteSha) return "push";
  if (remoteSha !== expectedSha) throw new Error("Release tag points to a different commit");
  return "reuse";
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: "inherit" });

// Draft releases can return 404 from /releases/tags even after gh release create succeeds.
// The authenticated releases list includes drafts for the workflow's write-capable token.
export async function findRelease(repo: string, tag: string, token: string): Promise<Release | undefined> {
  const base = `https://api.github.com/repos/${repo}/releases`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const response = await fetch(`${base}/tags/${encodeURIComponent(tag)}`, { headers });
  if (response.ok) return parseRelease(await response.json());
  if (response.status !== 404) throw new Error(`GitHub release lookup failed: HTTP ${response.status}`);
  // Check all pages so a hidden draft cannot trigger a duplicate creation.
  for (let page = 1; ; page++) {
    const list = await fetch(`${base}?per_page=100&page=${page}`, { headers });
    if (!list.ok) throw new Error(`GitHub release list failed: HTTP ${list.status}`);
    const entries: unknown = await list.json();
    if (!Array.isArray(entries)) throw new Error("Invalid release list response");
    const matches = entries.filter(
      (entry) => entry && typeof entry === "object" && "tag_name" in entry && entry.tag_name === tag,
    );
    if (matches.length > 1) throw new Error(`Multiple releases for tag ${tag}`);
    if (matches.length) return parseRelease(matches[0]);
    if (entries.length < 100) return undefined;
  }
}

function parseRelease(data: unknown): Release {
  if (
    !data ||
    typeof data !== "object" ||
    !("draft" in data) ||
    !("assets" in data) ||
    typeof data.draft !== "boolean" ||
    !Array.isArray(data.assets)
  )
    throw new Error("Invalid release response");
  return data as Release;
}

function remoteTagCommit(tag: string): string | undefined {
  // Annotated tags advertise both the tag object and its peeled commit; compare the commit.
  const refs = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`);
  const lines = refs.split("\n");
  const ref =
    lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`)) ??
    lines.find((line) => line.endsWith(`refs/tags/${tag}`));
  return ref?.split("\t")[0];
}

function verifyRemoteTag(tag: string, sha: string, event: string): void {
  const action = tagAction(remoteTagCommit(tag), sha);
  if (event === "workflow_dispatch") {
    git("fetch", "origin", "develop");
    if (git("rev-parse", "origin/develop") !== sha)
      throw new Error("develop advanced during verification; refusing stale publication");
    if (action === "push") git("push", "origin", `${sha}:refs/tags/${tag}`);
  } else if (action !== "reuse") {
    throw new Error("Push-triggered release requires the remote tag");
  }
  // Re-read after any push to catch concurrent creation before touching the release API.
  const actual = remoteTagCommit(tag);
  tagAction(actual, sha);
  if (!actual) throw new Error("Tag push did not create the remote tag");
}

async function readExpectedAssets(): Promise<Map<string, Asset>> {
  const expected = new Map<string, Asset>();
  for (const name of assetNames) {
    const bytes = await readFile(join("dist/release", name));
    expected.set(name, {
      name,
      size: bytes.length,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });
  }
  return expected;
}

// Return a complete, byte-verified snapshot. Only drafts may be repaired.
async function ensureCompleteRelease(
  repo: string,
  tag: string,
  token: string,
  expected: Map<string, Asset>,
): Promise<Release> {
  const getRelease = () => findRelease(repo, tag, token);
  const notes = execFileSync("bun", ["scripts/release/select-release-notes.ts", tag], { encoding: "utf8" }).trim();
  const existing = await getRelease();
  if (!existing) {
    gh(
      "release",
      "create",
      tag,
      "--verify-tag",
      "--draft",
      "--generate-notes",
      "--notes-file",
      notes,
      "--title",
      tag,
      ...assetNames.map((name) => join("dist/release", name)),
    );
  }
  const release = existing ?? (await getRelease());
  if (!release) throw new Error("Release was not created");
  const missing = missingReleaseAssets(release, expected);
  if (!missing.length) return release;

  gh("release", "upload", tag, ...missing.map((name) => join("dist/release", name)));
  const completed = await getRelease();
  if (!completed || missingReleaseAssets(completed, expected).length)
    throw new Error("Release assets still incomplete");
  return completed;
}

async function main() {
  const {
    RELEASE_TAG: tag,
    RELEASE_SHA: sha,
    GH_TOKEN: token,
    GITHUB_REPOSITORY: repo,
    GITHUB_EVENT_NAME: event,
  } = process.env;
  if (
    !tag ||
    !sha ||
    !token ||
    !repo ||
    !event ||
    !/^v[0-9]+[.][0-9]+[.][0-9]+$/.test(tag) ||
    !/^[a-f0-9]{40}$/.test(sha)
  )
    throw new Error("Missing or invalid release environment");
  verifyRemoteTag(tag, sha, event);

  const expected = await readExpectedAssets();
  const ready = await ensureCompleteRelease(repo, tag, token, expected);
  if (ready.draft) gh("release", "edit", tag, "--draft=false");
  const final = await findRelease(repo, tag, token);
  if (!final || final.draft || missingReleaseAssets(final, expected).length)
    throw new Error("Release publication not verified");
  console.log(`Published ${tag} from ${sha} with verified release assets.`);
}

if (import.meta.main) await main();
