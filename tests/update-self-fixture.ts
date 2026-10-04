// Private compiled runner updates ONLY an explicit temporary install, never itself.
import { createHash } from "node:crypto";
import { RELEASES_URL, UPDATE_ASSET, updateBruv } from "../src/update";
const executable = process.env.BRUV_TEST_UPDATE_TARGET;
const normalPayload = process.env.BRUV_TEST_UPDATE_PAYLOAD;
const connectorPayload = process.env.BRUV_TEST_UPDATE_CONNECTOR_PAYLOAD;
if (!executable || !normalPayload || !connectorPayload)
  throw new Error("Explicit private paired updater fixture paths are required");
const connectorAsset = UPDATE_ASSET.replace(/^bruv-/, "bruv-claude-compat-");
const assets = new Map([
  [UPDATE_ASSET, await Bun.file(normalPayload).bytes()],
  [connectorAsset, await Bun.file(connectorPayload).bytes()],
]);
const root = "https://github.com/tnfssc/bruv/releases/download/v0.3.0/";
const mockFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === RELEASES_URL)
    return Response.json({
      tag_name: "v0.3.0",
      assets: [...assets.keys()]
        .flatMap((name) => [name, name + ".sha256"])
        .map((name) => ({ name, browser_download_url: root + name })),
    });
  for (const [name, bytes] of assets) {
    if (url === root + name) return new Response(bytes);
    if (url === root + name + ".sha256")
      return new Response(createHash("sha256").update(bytes).digest("hex") + "  " + name + "\n");
  }
  throw new Error("Unexpected test URL");
}) as typeof fetch;
console.log(JSON.stringify(await updateBruv({ executable, currentVersion: "0.2.15", fetch: mockFetch })));
