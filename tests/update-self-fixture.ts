// Private compiled runner updates ONLY an explicit temporary install, never itself.
import { createHash } from "node:crypto";
import { RELEASES_URL, updateAssetFor, updateBruv } from "../src/update";

/** A closed in-memory release: metadata, payloads and hashes describe the same pair. */
export function createFixtureReleaseFetch(
  asset: string,
  version: string,
  bruv: Uint8Array<ArrayBuffer>,
  connector: Uint8Array<ArrayBuffer>,
): typeof fetch {
  const root = "https://github.com/tnfssc/bruv/releases/download/" + encodeURIComponent("v" + version) + "/";
  const assets: { name: string; browser_download_url: string }[] = [];
  const downloads = new Map<string, BodyInit>();
  for (const [name, bytes] of [
    [asset, bruv],
    [asset.replace(/^bruv-/, "bruv-claude-compat-"), connector],
  ] as const) {
    const binaryUrl = root + name;
    const checksumUrl = binaryUrl + ".sha256";
    downloads.set(binaryUrl, bytes);
    downloads.set(checksumUrl, createHash("sha256").update(bytes).digest("hex") + "  " + name + "\n");
    assets.push(
      { name, browser_download_url: binaryUrl },
      { name: name + ".sha256", browser_download_url: checksumUrl },
    );
  }
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === RELEASES_URL) return Response.json({ tag_name: "v" + version, assets });
    const body = downloads.get(url);
    if (body === undefined) throw new Error("Unexpected fixture URL: " + url);
    return new Response(body);
  }) as typeof fetch;
}

if (import.meta.main) {
  const executable = process.env.BRUV_TEST_UPDATE_TARGET;
  const normalPayload = process.env.BRUV_TEST_UPDATE_PAYLOAD;
  const connectorPayload = process.env.BRUV_TEST_UPDATE_CONNECTOR_PAYLOAD;
  if (!executable || !normalPayload || !connectorPayload)
    throw new Error("Explicit private paired updater fixture paths are required");
  const asset = updateAssetFor(process.platform, process.arch);
  if (!asset) throw new Error("Unsupported updater fixture platform: " + process.platform + "-" + process.arch);
  // Shell stand-ins use 0.3.0; a reusable built pair supplies its real version.
  const version = process.env.BRUV_TEST_UPDATE_VERSION ?? "0.3.0";
  const mockFetch = createFixtureReleaseFetch(
    asset,
    version,
    await Bun.file(normalPayload).bytes(),
    await Bun.file(connectorPayload).bytes(),
  );
  // Keep compiled detection and staged binary probes real; only transport is replaced.
  console.log(JSON.stringify(await updateBruv({ executable, currentVersion: "0.2.15", fetch: mockFetch })));
}
