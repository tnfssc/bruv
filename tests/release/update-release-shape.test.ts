/** Reproduce with: bun test tests/release/update-release-shape.test.ts
 * Synthetic cross-platform bytes and probes; no published binary boot or platform execution proof.
 * All updates operate on temporary sibling installations, never installed executables.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { connectorLauncher } from "../../scripts/build/claude-compat-launcher";
import { type UpdateDeps, updateBruv } from "../../src/update";

const targets = [
  { platform: "linux", arch: "x64", asset: "bruv-linux-x64" },
  { platform: "linux", arch: "arm64", asset: "bruv-linux-arm64" },
  { platform: "darwin", arch: "arm64", asset: "bruv-darwin-arm64" },
  { platform: "android", arch: "arm64", asset: "bruv-android-arm64" },
] as const;
const api = "https://api.github.com/repos/tnfssc/bruv/releases/latest";
const root = "https://github.com/tnfssc/bruv/releases/download/v0.8.0/";
const linuxAsset = targets[0].asset;
const connectorFor = (asset: string) => asset.replace(/^bruv-/, "bruv-claude-compat-");
const linuxPair = [linuxAsset, linuxAsset + ".sha256", connectorFor(linuxAsset), connectorFor(linuxAsset) + ".sha256"];
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const magicFor = (asset: string) =>
  asset.endsWith("darwin-arm64") ? [0xcf, 0xfa, 0xed, 0xfe] : [0x7f, 0x45, 0x4c, 0x46];

function rawFixture(asset: string, version = "0.8.0"): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...magicFor(asset), ...new TextEncoder().encode("bruv fixture " + version + " " + asset)]);
}

// Read the staged bytes, not the path alone: a checksum-valid wrong product/version must not pass.
// This simulates executable probes; it does not execute ELF/Mach-O bytes on the host.
const probeFixture: NonNullable<UpdateDeps["runBinary"]> = async (path, args, env) => {
  const bytes = await readFile(path);
  if (basename(path) === "bruv-claude-compat") {
    const stagedBruv = env.BRUV_CLAUDE_COMPAT_BRUV_PATH!;
    const bruvBytes = await readFile(stagedBruv);
    const target = targets.find(({ asset }) =>
      bruvBytes
        .subarray(4)
        .toString()
        .endsWith(" " + asset),
    )!;
    const launcher = await connectorLauncher("bun-" + target.platform + "-" + target.arch);
    if (!bytes.equals(Buffer.from(launcher))) throw new Error("incompatible connector fixture shape");
    return "bruv-claude-compat " + (await probeFixture(stagedBruv, ["--version"], env));
  }
  const identity = /^bruv fixture (\S+) (\S+)$/.exec(bytes.subarray(4).toString());
  if (!identity || !magicFor(identity[2]!).every((byte, index) => bytes[index] === byte))
    throw new Error("incompatible raw fixture shape");
  if (args[0] === "--live-self-test") return "";
  return identity[2]!.startsWith("bruv-claude-compat-") ? "bruv-claude-compat " + identity[1] : identity[1]!;
};
const compiledInvocation = {
  compiled: true,
  currentVersion: "0.7.1",
  platform: "linux",
  arch: "x64",
  runBinary: probeFixture,
} satisfies UpdateDeps;

async function releaseFixture(onRequest?: (url: string) => Promise<void>) {
  const metadata = {
    tag_name: "v0.8.0",
    prerelease: false,
    draft: false,
    assets: [] as { name: string; browser_download_url: string }[],
  };
  const payloads = new Map<string, Uint8Array<ArrayBuffer> | string | Error>();
  for (const { platform, arch, asset } of targets) {
    for (const name of [asset, connectorFor(asset)]) {
      const bytes =
        name === asset
          ? rawFixture(name)
          : new TextEncoder().encode(await connectorLauncher("bun-" + platform + "-" + arch));
      payloads.set(root + name, bytes);
      payloads.set(root + name + ".sha256", digest(bytes) + "  " + name + "\n");
      for (const filename of [name, name + ".sha256"])
        metadata.assets.push({ name: filename, browser_download_url: root + filename });
    }
  }
  const requests: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    expect(init?.headers).toEqual({
      accept:
        url === api
          ? "application/vnd.github+json"
          : url.endsWith(".sha256")
            ? "text/plain"
            : "application/octet-stream",
      "user-agent": "bruv/0.7.1",
    });
    await onRequest?.(url);
    const payload = payloads.get(url);
    if (payload instanceof Error) throw payload;
    if (url === api) return Response.json(metadata);
    if (payload === undefined) throw new Error("unexpected URL: " + url);
    return new Response(payload);
  };
  return { metadata, payloads, requests, fetch: fetcher as typeof fetch };
}

let temp: string;
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), "bruv-release-shape-"));
});
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function installedPair() {
  const dir = await mkdtemp(join(temp, "target-"));
  const path = join(dir, "bruv");
  const connector = join(dir, "bruv-claude-compat");
  const original = Buffer.from("original bruv 0.7.1");
  const originalConnector = Buffer.from("original connector 0.7.1");
  await writeFile(path, original, { mode: 0o755 });
  await writeFile(connector, originalConnector, { mode: 0o755 });
  return { dir, path, connector, original, originalConnector };
}
async function noStage(dir: string) {
  expect((await readdir(dir)).filter((name) => name.startsWith(".bruv-update-"))).toEqual([]);
}
async function unchanged(target: Awaited<ReturnType<typeof installedPair>>) {
  expect(await readFile(target.path)).toEqual(target.original);
  expect(await readFile(target.connector)).toEqual(target.originalConnector);
  await noStage(target.dir);
}

for (const { platform, arch, asset } of targets) {
  test("raw paired release installs " + asset + " via exact official URLs and staged identity probes", async () => {
    const target = await installedPair();
    await rm(target.connector); // Preserve release-shape coverage of installing the missing sibling.
    const release = await releaseFixture();
    const probes: { path: string; args: string[]; pairedBruv?: string }[] = [];
    const result = await updateBruv({
      ...compiledInvocation,
      platform,
      arch,
      executable: target.path,
      fetch: release.fetch,
      runBinary: async (path, args, env) => {
        probes.push({ path, args, pairedBruv: env.BRUV_CLAUDE_COMPAT_BRUV_PATH });
        return probeFixture(path, args, env);
      },
    });
    expect(result).toEqual({ status: "updated", version: "0.8.0", path: target.path });
    const connectorAsset = connectorFor(asset);
    expect(release.requests).toEqual([
      api,
      root + asset,
      root + asset + ".sha256",
      root + connectorAsset,
      root + connectorAsset + ".sha256",
    ]);
    expect(await readFile(target.path)).toEqual(Buffer.from(rawFixture(asset)));
    expect(await readFile(target.connector, "utf8")).toBe(await connectorLauncher("bun-" + platform + "-" + arch));
    for (const path of [target.path, target.connector]) expect((await stat(path)).mode & 0o111).not.toBe(0);
    expect(probes.map(({ path, args }) => [basename(path), args])).toEqual([
      ["bruv", ["--version"]],
      ["bruv-claude-compat", ["--bruv-version"]],
      ...(platform === "darwin" ? [["bruv", ["--live-self-test"]]] : []),
    ]);
    const stagedBruv = probes[0]!.path;
    expect(dirname(stagedBruv)).toStartWith(join(target.dir, ".bruv-update-"));
    expect(dirname(probes[1]!.path)).toBe(dirname(stagedBruv));
    expect(probes[0]!.pairedBruv).toBeUndefined();
    expect(probes[1]!.pairedBruv).toBe(stagedBruv);
    await noStage(target.dir);
  });
}

// All four selected assets must be authoritative before any payload is requested.
const invalidAssets = [
  ...linuxPair.map((name) => ({ name, shape: "missing" }) as const),
  ...linuxPair.map((name) => ({ name, shape: "foreign URL" }) as const),
  { name: linuxAsset, shape: "tarball" },
  { name: connectorFor(linuxAsset), shape: "duplicate" },
  { name: connectorFor(linuxAsset) + ".sha256", shape: "wrong tag URL" },
] as const;
for (const { name, shape } of invalidAssets) {
  test(name + " with " + shape + " is rejected before download", async () => {
    const target = await installedPair();
    const release = await releaseFixture();
    const entry = release.metadata.assets.find((asset) => asset.name === name)!;
    switch (shape) {
      case "missing":
        release.metadata.assets = release.metadata.assets.filter((asset) => asset !== entry);
        break;
      case "duplicate":
        release.metadata.assets.push({ ...entry });
        break;
      case "tarball":
        entry.name += ".tar.gz";
        entry.browser_download_url += ".tar.gz";
        break;
      case "foreign URL":
        entry.browser_download_url = "https://example.invalid/" + name;
        break;
      case "wrong tag URL":
        entry.browser_download_url = root.replace("v0.8.0", "v0.7.1") + name;
        break;
    }
    await expect(updateBruv({ ...compiledInvocation, executable: target.path, fetch: release.fetch })).rejects.toThrow(
      "valid official " + name + " asset",
    );
    expect(release.requests).toEqual([api]);
    await unchanged(target);
  });
}

for (const [label, patch] of [
  ["prerelease tag", { tag_name: "v0.8.0-rc.1", prerelease: true }],
  ["flagged prerelease", { prerelease: true }],
  ["draft", { draft: true }],
] as const) {
  test(label + " is rejected before download", async () => {
    const target = await installedPair();
    const release = await releaseFixture();
    Object.assign(release.metadata, patch);
    await expect(updateBruv({ ...compiledInvocation, executable: target.path, fetch: release.fetch })).rejects.toThrow(
      "invalid stable release version",
    );
    expect(release.requests).toEqual([api]);
    await unchanged(target);
  });
}

for (const name of [linuxAsset, connectorFor(linuxAsset)]) {
  for (const failure of ["hash mismatch", "wrong checksum filename"] as const) {
    test(name + " " + failure + " leaves both originals unchanged", async () => {
      const target = await installedPair();
      const release = await releaseFixture();
      release.payloads.set(
        root + name + ".sha256",
        failure === "hash mismatch"
          ? "0".repeat(64) + "  " + name + "\n"
          : digest(release.payloads.get(root + name) as Uint8Array) + "  " + name.replace("x64", "arm64") + "\n",
      );
      await expect(
        updateBruv({ ...compiledInvocation, executable: target.path, fetch: release.fetch }),
      ).rejects.toThrow("Checksum verification failed for " + name);
      await unchanged(target);
    });
  }
}
for (const url of [api, ...linuxPair.map((name) => root + name)]) {
  test("network failure at " + url + " leaves both originals unchanged", async () => {
    const target = await installedPair();
    const release = await releaseFixture();
    release.payloads.set(url, new Error("offline fixture"));
    await expect(updateBruv({ ...compiledInvocation, executable: target.path, fetch: release.fetch })).rejects.toThrow(
      "offline fixture",
    );
    await unchanged(target);
  });
}

const invalidPayloads = [
  { name: linuxAsset, shape: "tarball" },
  { name: linuxAsset, shape: "wrong version" },
  { name: linuxAsset, shape: "wrong product" },
  { name: connectorFor(linuxAsset), shape: "tarball" },
  { name: connectorFor(linuxAsset), shape: "wrong product" },
] as const;
for (const { name, shape } of invalidPayloads) {
  test(name + " checksum-valid " + shape + " fails staged pair probes without replacing either sibling", async () => {
    const target = await installedPair();
    const release = await releaseFixture();
    let bytes: Uint8Array<ArrayBuffer>;
    if (shape === "tarball") {
      bytes = new Uint8Array(512);
      bytes.set(new TextEncoder().encode("ustar"), 257);
    } else
      bytes = rawFixture(
        shape === "wrong product" ? (name === linuxAsset ? connectorFor(name) : linuxAsset) : name,
        shape === "wrong version" ? "0.7.1" : "0.8.0",
      );
    release.payloads.set(root + name, bytes);
    release.payloads.set(root + name + ".sha256", digest(bytes) + "  " + name + "\n");
    await expect(updateBruv({ ...compiledInvocation, executable: target.path, fetch: release.fetch })).rejects.toThrow(
      name !== linuxAsset
        ? "incompatible connector fixture shape"
        : shape === "tarball"
          ? "incompatible raw fixture shape"
          : "Staged Bruv pair version mismatch",
    );
    expect(release.requests).toEqual([api, ...linuxPair.map((name) => root + name)]);
    await unchanged(target);
  });
}

for (const sibling of ["bruv", "bruv-claude-compat"]) {
  test("concurrent replacement of " + sibling + " after download is not overwritten", async () => {
    const target = await installedPair();
    const path = join(target.dir, sibling);
    const replacement = Buffer.from("concurrent owner executable");
    const release = await releaseFixture(async (url) => {
      if (url === root + connectorFor(linuxAsset) + ".sha256") {
        const other = join(target.dir, "other");
        await writeFile(other, replacement);
        await rename(other, path);
      }
    });
    await expect(updateBruv({ ...compiledInvocation, executable: target.path, fetch: release.fetch })).rejects.toThrow(
      sibling + " executable changed during the update",
    );
    expect(await readFile(path)).toEqual(replacement);
    const untouched = sibling === "bruv" ? target.connector : target.path;
    expect(await readFile(untouched)).toEqual(sibling === "bruv" ? target.originalConnector : target.original);
    await noStage(target.dir);
  });
}
