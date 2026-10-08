// Compile this entrypoint to exercise real root dispatch without any live fetch.
import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { updateAssetFor } from "../../src/update";

const version = process.env.BRUV_TEST_RELEASE_VERSION ?? "99.0.0";
const asset = updateAssetFor(process.platform, process.arch)!;
const connectorAsset = asset.replace(/^bruv-/, "bruv-claude-compat-");
const base = "https://github.com/tnfssc/bruv/releases/download/v" + version + "/";
// Only the downloaded normal executable is a version-probe stand-in. The connector
// bytes below come from the same launcher generator used by the shipping build.
const normal = new TextEncoder().encode(
  [
    "#!/bin/sh",
    'if [ "$1" = "claude-compat" ] && [ "$2" = "--bruv-version" ]; then',
    '  printf "%s\\n" "bruv-claude-compat ' + version + '"',
    "else",
    '  printf "%s\\n" "' + version + '"',
    "fi",
    "",
  ].join("\n"),
);
const connector = new Uint8Array(await readFile(process.env.BRUV_TEST_LAUNCHER!));
// Advertised assets and downloadable bodies come from the same release files.
const files = new Map<string, string | Uint8Array<ArrayBuffer>>();
for (const [name, body] of [
  [asset, normal],
  [connectorAsset, connector],
] as const) {
  const hash =
    process.env.BRUV_TEST_BAD_CHECKSUM === name ? "0".repeat(64) : createHash("sha256").update(body).digest("hex");
  files.set(name, body);
  files.set(name + ".sha256", hash + "  " + name + "\n");
}
globalThis.fetch = (async (url: RequestInfo | URL) => {
  const address = String(url);
  if (process.env.BRUV_TEST_FETCH_LOG) await appendFile(process.env.BRUV_TEST_FETCH_LOG, address + "\n");
  if (address === "https://api.github.com/repos/tnfssc/bruv/releases/latest")
    return Response.json({
      tag_name: "v" + version,
      assets: Array.from(files.keys(), (name) => ({ name, browser_download_url: base + name })),
    });
  if (address.startsWith(base)) {
    const body = files.get(address.slice(base.length));
    if (body !== undefined) return new Response(body);
  }
  throw new Error("Offline fixture rejected unexpected URL: " + address);
}) as typeof fetch;
// Root CLI keeps its actual product version; synthetic release metadata is test-only.
await import("../../src/cli");
