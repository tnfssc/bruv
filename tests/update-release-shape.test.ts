/** Reproduce with: bun test tests/update-release-shape.test.ts
 * Test the current updater with temporary raw release fixtures, never installed executables.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateBruv } from "../src/update";

const names = ["bruv-linux-x64", "bruv-linux-arm64", "bruv-darwin-arm64", "bruv-android-arm64"] as const;
const targets: [NodeJS.Platform, string, string][] = [
  ["linux", "x64", names[0]],
  ["linux", "arm64", names[1]],
  ["darwin", "arm64", names[2]],
  ["android", "arm64", names[3]],
];
const pairNames = [...names, ...names.map((name) => name.replace(/^bruv-/, "bruv-claude-compat-"))];
const runBinary = async (path: string) => (path.endsWith("bruv-claude-compat") ? "bruv-claude-compat 0.8.0" : "0.8.0");
const api = "https://api.github.com/repos/tnfssc/bruv/releases/latest";
const root = "https://github.com/tnfssc/bruv/releases/download/v0.8.0/";
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
let temp: string;

// Synthetic, non-runnable raw executable-shaped fixtures. Embedded version is deliberate;
// these do NOT prove a real 0.8.0 compiled binary boots on any target OS.
function fixture(name: string): Uint8Array {
  const header = name.endsWith("darwin-arm64") ? [0xcf, 0xfa, 0xed, 0xfe] : [0x7f, 0x45, 0x4c, 0x46];
  return new Uint8Array([...header, ...new TextEncoder().encode("bruv fixture 0.8.0 " + name)]);
}
function assertRawFixture(name: string, bytes: Uint8Array) {
  const magic = name.endsWith("darwin-arm64") ? [0xcf, 0xfa, 0xed, 0xfe] : [0x7f, 0x45, 0x4c, 0x46];
  if (
    !magic.every((byte, index) => bytes[index] === byte) ||
    !new TextDecoder().decode(bytes).includes("bruv fixture 0.8.0 " + name)
  )
    throw new Error("incompatible tar shape or version for " + name);
}
async function stageAssets(dir: string) {
  await mkdir(dir);
  for (const name of pairNames) {
    const bytes = fixture(name);
    assertRawFixture(name, bytes);
    await writeFile(join(dir, name), bytes);
    await writeFile(join(dir, name + ".sha256"), digest(bytes) + "  " + name + "\n");
  }
}
type Override = {
  tag?: string;
  prerelease?: boolean;
  draft?: boolean;
  checksum?: string;
  fail?: string;
  missingRaw?: boolean;
  onRequest?: (url: string) => void | Promise<void>;
};
function localFetch(dir: string, options: Override = {}) {
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.headers).toEqual({
      accept:
        url === api
          ? "application/vnd.github+json"
          : url.endsWith(".sha256")
            ? "text/plain"
            : "application/octet-stream",
      "user-agent": "bruv/0.7.1",
    });
    await options.onRequest?.(url);
    if (url === options.fail) throw new Error("offline fixture");
    if (url === api)
      return Response.json({
        tag_name: options.tag ?? "v0.8.0",
        prerelease: options.prerelease ?? false,
        draft: options.draft ?? false,
        assets: pairNames
          .flatMap((name) => [options.missingRaw && name === names[0] ? name + ".tar.gz" : name, name + ".sha256"])
          .map((name) => ({ name, browser_download_url: root + name })),
      });
    if (!url.startsWith(root) || !pairNames.some((name) => url === root + name || url === root + name + ".sha256"))
      throw new Error("unexpected non-official URL: " + url);
    const name = url.slice(root.length);
    return new Response(
      name.endsWith(".sha256") && options.checksum !== undefined ? options.checksum : await readFile(join(dir, name)),
    );
  };
  return fetcher as typeof fetch;
}
async function targetFor(name: string) {
  const dir = await mkdtemp(join(temp, "target-"));
  const path = join(dir, "bruv");
  const original = new TextEncoder().encode("original 0.7.1 " + name);
  await writeFile(path, original, { mode: 0o755 });
  return { dir, path, original };
}
async function noStage(dir: string) {
  expect((await readdir(dir)).filter((name) => name.startsWith(".bruv-update-"))).toEqual([]);
}
let assets: string;
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), "bruv-release-shape-"));
  assets = join(temp, "release-assets");
  await stageAssets(assets);
});
afterAll(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});

for (const [platform, arch, name] of targets) {
  test("current updater replaces " + name + " using official URLs and staged raw asset + sha256", async () => {
    const target = await targetFor(name);
    const requests: string[] = [];
    const result = await updateBruv({
      runBinary,
      compiled: true,
      currentVersion: "0.7.1",
      platform,
      arch,
      executable: target.path,
      fetch: localFetch(assets, {
        onRequest: (url) => {
          requests.push(url);
        },
      }),
    });
    expect(result).toEqual({ status: "updated", version: "0.8.0", path: target.path });
    const connector = name.replace(/^bruv-/, "bruv-claude-compat-");
    expect(requests).toEqual([
      api,
      root + name,
      root + name + ".sha256",
      root + connector,
      root + connector + ".sha256",
    ]);
    expect(await readFile(join(target.dir, "bruv-claude-compat"))).toEqual(Buffer.from(fixture(connector)));
    expect(await readFile(target.path)).toEqual(Buffer.from(fixture(name)));
    expect((await stat(target.path)).mode & 0o111).not.toBe(0);
    await noStage(target.dir);
  });
}
for (const [label, override] of [
  ["checksum mismatch", { checksum: "0".repeat(64) + "  bruv-linux-x64\n" }],
  ["checksum wrong filename", { checksum: "0".repeat(64) + "  bruv-linux-arm64\n" }],
  ["binary network failure", { fail: root + names[0] }],
  ["checksum network failure", { fail: root + names[0] + ".sha256" }],
  ["release network failure", { fail: api }],
  ["prerelease", { tag: "v0.8.0-rc.1", prerelease: true }],
  ["flagged prerelease", { prerelease: true }],
  ["draft", { draft: true }],
  ["tarball instead of raw release asset", { missingRaw: true }],
] as const) {
  test(label + " leaves original unchanged", async () => {
    const target = await targetFor(names[0]);
    await expect(
      updateBruv({
        runBinary,
        compiled: true,
        currentVersion: "0.7.1",
        platform: "linux",
        arch: "x64",
        executable: target.path,
        fetch: localFetch(assets, override),
      }),
    ).rejects.toThrow();
    expect(await readFile(target.path)).toEqual(Buffer.from(target.original));
    await noStage(target.dir);
  });
}
test("concurrent replacement after download is not overwritten", async () => {
  const target = await targetFor(names[0]);
  const replacement = Buffer.from("concurrent owner executable");
  let changed = false;
  await expect(
    updateBruv({
      runBinary,
      compiled: true,
      currentVersion: "0.7.1",
      platform: "linux",
      arch: "x64",
      executable: target.path,
      fetch: localFetch(assets, {
        onRequest: async (url) => {
          if (url === root + names[0] + ".sha256" && !changed) {
            changed = true;
            await writeFile(join(target.dir, "other"), replacement);
            const { rename } = await import("node:fs/promises");
            await rename(join(target.dir, "other"), target.path);
          }
        },
      }),
    }),
  ).rejects.toThrow("changed during the update");
  expect(changed).toBe(true);
  expect(await readFile(target.path)).toEqual(replacement);
  await noStage(target.dir);
});
test("fixture preflight rejects tar-shaped payload, even with valid checksum", async () => {
  const tar = new Uint8Array(512);
  tar.set(new TextEncoder().encode("ustar"), 257);
  const validTarChecksum = digest(tar) + "  " + names[0] + "\n";
  expect(validTarChecksum).toMatch(new RegExp("^[a-f0-9]{64}  " + names[0]));
  expect(() => assertRawFixture(names[0], tar)).toThrow("incompatible tar shape");
  expect(() => assertRawFixture(names[0], new TextEncoder().encode("bruv fixture 0.7.1 " + names[0]))).toThrow(
    "incompatible tar shape or version",
  );
  // This shape preflight is synthetic evidence, not platform execution proof.
  // The updater separately runs staged --bruv-version and the existing macOS helper check.
});
