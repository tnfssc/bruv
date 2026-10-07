import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateThirdPartyNotices } from "../scripts/generate-third-party-notices";

async function writePackage(
  directory: string,
  manifest: Record<string, unknown>,
  notices: Record<string, string> = {},
): Promise<void> {
  await Bun.write(join(directory, "package.json"), JSON.stringify({ version: "1.0.0", ...manifest }));
  for (const [name, text] of Object.entries(notices)) await Bun.write(join(directory, name), text);
}

describe("third-party notice collection and rendering", () => {
  let root: string;
  let output: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bruv-notice-generator-"));
    output = join(root, "notices.txt");
    await Bun.write(join(root, "third_party/pi/LICENSE"), "Pi license\n");
    await Bun.write(join(root, "third_party/bun/LICENSE.md"), "Bun license\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("walks required, optional, and peer edges with nested versions, cycles, and stable output order", async () => {
    await writePackage(root, { dependencies: { parent: "1.0.0", shared: "1.0.0" } });
    await writePackage(
      join(root, "node_modules/parent"),
      {
        name: "parent",
        dependencies: { shared: "2.0.0" },
        optionalDependencies: { optional: "1.0.0", "missing-optional": "1.0.0" },
        peerDependencies: { peer: "1.0.0", "missing-peer": "1.0.0" },
      },
      { "NOTICE.txt": "parent notice\n\n", LICENSE: "parent license\n", "helper-license.js": "license helper" },
    );
    await writePackage(
      join(root, "node_modules/shared"),
      { name: "shared", dependencies: { parent: "1.0.0" } },
      { COPYING: "shared v1" },
    );
    await writePackage(
      join(root, "node_modules/parent/node_modules/shared"),
      { name: "shared", version: "2.0.0" },
      { LICENSE: "shared v2" },
    );
    for (const name of ["optional", "peer"]) {
      await writePackage(join(root, "node_modules", name), { name, license: "MIT" }, { LICENSE: name });
    }

    expect(await generateThirdPartyNotices(root, output)).toBe(5);
    const content = await Bun.file(output).text();
    expect(content.match(/^(?:parent|shared|optional|peer)@.*$/gm)).toEqual([
      "optional@1.0.0",
      "parent@1.0.0",
      "peer@1.0.0",
      "shared@1.0.0",
      "shared@2.0.0",
    ]);
    expect(content).toContain("Declared license: MIT");
    expect(content).toContain("Declared license: unspecified");
    expect(content).toContain("--- LICENSE ---\nparent license\n\n--- NOTICE.txt ---\nparent notice\n");
    expect(content).not.toContain("license helper");
    expect(content).toContain("shared v1");
    expect(content).toContain("shared v2");
    await generateThirdPartyNotices(root, output);
    expect(await Bun.file(output).text()).toBe(content);
  });

  test("packaged notices take precedence over curated and pinned Pi fallbacks", async () => {
    await writePackage(root, {
      dependencies: { "proxy-agent-negotiate": "1.0.0", "@earendil-works/pi-ai": "1.0.3" },
    });
    await writePackage(
      join(root, "node_modules/proxy-agent-negotiate"),
      { name: "proxy-agent-negotiate" },
      { LICENSE: "packaged proxy license" },
    );
    await writePackage(
      join(root, "node_modules/@earendil-works/pi-ai"),
      { name: "@earendil-works/pi-ai", version: "1.0.3" },
      { LICENSE: "packaged Pi license" },
    );
    // No curated file exists: packaged notices must suffice without reading it.
    expect(await generateThirdPartyNotices(root, output)).toBe(2);
    const content = await Bun.file(output).text();
    expect(content).toContain("packaged proxy license");
    expect(content).toContain("packaged Pi license");
    expect(content).not.toContain("curated");
    expect(content).not.toContain("This pinned");
  });

  test("uses curated notices and only the explicitly pinned Pi upstream fallback", async () => {
    await writePackage(root, {
      dependencies: { "proxy-agent-negotiate": "1.0.0", "@earendil-works/pi-ai": "1.0.3" },
    });
    await writePackage(join(root, "node_modules/proxy-agent-negotiate"), { name: "proxy-agent-negotiate" });
    await writePackage(join(root, "node_modules/@earendil-works/pi-ai"), {
      name: "@earendil-works/pi-ai",
      version: "1.0.3",
    });
    await Bun.write(join(root, "third_party/npm/proxy-agent-negotiate.LICENSE"), "curated proxy license\n");
    expect(await generateThirdPartyNotices(root, output)).toBe(2);
    const content = await Bun.file(output).text();
    expect(content).toContain("--- curated proxy-agent-negotiate.LICENSE ---\ncurated proxy license\n");
    expect(content).toContain(
      "This pinned @earendil-works/pi-ai@1.0.3 package is covered by the Pi upstream license reproduced below.",
    );
    expect(content).toContain("PI UPSTREAM LICENSE (applies only to pinned Pi packages identified above)");
    expect(content).toContain("Pi license");
    expect(content).toContain("BUN RUNTIME UPSTREAM LICENSING");
    expect(content).toContain("Bun license");
  });

  test("rendered bundle budget failure leaves an existing output untouched", async () => {
    await writePackage(root, {});
    await Bun.write(output, "previous valid bundle");
    await expect(generateThirdPartyNotices(root, output, 100)).rejects.toThrow("notice bundle exceeds 100 bytes");
    expect(await Bun.file(output).text()).toBe("previous valid bundle");
  });
});
