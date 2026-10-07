import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RELEASES_URL, UPDATE_ASSETS } from "../src/update";
import { createFixtureReleaseFetch } from "./update-self-fixture";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("private updater fixture transport", () => {
  for (const asset of Object.values(UPDATE_ASSETS)) {
    test("serves only the declared release pair for " + asset, async () => {
      const bruv = new TextEncoder().encode("normal payload");
      const connector = new TextEncoder().encode("connector payload");
      const fetch = createFixtureReleaseFetch(asset, "0.3.0", bruv, connector);
      const release = await (await fetch(new Request(RELEASES_URL))).json();
      expect(release.tag_name).toBe("v0.3.0");
      const names = [asset, asset.replace(/^bruv-/, "bruv-claude-compat-")];
      expect(release.assets.map((item: { name: string }) => item.name)).toEqual(
        names.flatMap((name) => [name, name + ".sha256"]),
      );
      for (const [index, name] of names.entries()) {
        const bytes = index === 0 ? bruv : connector;
        const url = "https://github.com/tnfssc/bruv/releases/download/v0.3.0/" + name;
        expect(release.assets[index * 2]).toEqual({ name, browser_download_url: url });
        expect(release.assets[index * 2 + 1]).toEqual({
          name: name + ".sha256",
          browser_download_url: url + ".sha256",
        });
        expect(await (await fetch(new URL(url))).bytes()).toEqual(bytes);
        // Fresh responses remain readable after an earlier body has been consumed.
        expect(await (await fetch(url)).bytes()).toEqual(bytes);
        expect(await (await fetch(url + ".sha256")).text()).toBe(digest(bytes) + "  " + name + "\n");
      }
      await expect(fetch("https://example.com/not-a-fixture-asset")).rejects.toThrow("Unexpected fixture URL");
      await expect(fetch(RELEASES_URL + "?redirect=elsewhere")).rejects.toThrow("Unexpected fixture URL");
    });
  }
});

// Compile only the private updater, not the product. Payloads come from an existing pair.
describe("private updater fixture runtime", () => {
  let dir: string;
  let runner: string;
  let runnerHash: string;
  const source = join(import.meta.dir, "update-self-fixture.ts");
  beforeAll(async () => {
    dir = await mkdtemp("/var/tmp/bruv-self-fixture-");
    runner = join(dir, "updater-runner");
    const build = await run([process.execPath, "build", "--compile", source, "--outfile", runner]);
    expect(build.code, build.stderr).toBe(0);
    runnerHash = digest(await readFile(runner));
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function run(command: string[], env?: NodeJS.ProcessEnv) {
    const child = Bun.spawn(command, { env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  }

  async function installation() {
    const install = await mkdtemp(join(dir, "install-"));
    const target = join(install, "bruv");
    const connector = join(install, "bruv-claude-compat");
    await writeFile(target, "original bruv", { mode: 0o754 });
    await writeFile(connector, "original connector", { mode: 0o754 });
    return { install, target, connector };
  }

  function fixtureEnv(target: string, normal: string, connector: string, version = "0.3.0") {
    return {
      HOME: dir,
      PATH: "/nonexistent",
      BRUV_TEST_UPDATE_TARGET: target,
      BRUV_TEST_UPDATE_PAYLOAD: normal,
      BRUV_TEST_UPDATE_CONNECTOR_PAYLOAD: connector,
      BRUV_TEST_UPDATE_VERSION: version,
    };
  }

  test("source execution has no compiled authority and leaves the install untouched", async () => {
    const x = await installation();
    const result = await run([process.execPath, source], fixtureEnv(x.target, x.target, x.connector));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Refusing to self-update a source Bun invocation");
    expect(await readFile(x.target, "utf8")).toBe("original bruv");
    expect(await readFile(x.connector, "utf8")).toBe("original connector");
    expect((await readdir(x.install)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
  });

  test("wrong staged version preserves both installed files and removes staging", async () => {
    const x = await installation();
    const normal = join(dir, "wrong-version");
    const connector = join(dir, "connector-stand-in");
    await writeFile(normal, "#!/bin/sh\necho 0.4.0\n");
    await writeFile(connector, "#!/bin/sh\necho bruv-claude-compat 0.3.0\n");
    const result = await run([runner], fixtureEnv(x.target, normal, connector));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Installed files unchanged");
    expect(result.stderr).toContain("version");
    expect(await readFile(x.target, "utf8")).toBe("original bruv");
    expect(await readFile(x.connector, "utf8")).toBe("original connector");
    expect((await readdir(x.install)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    expect(digest(await readFile(runner))).toBe(runnerHash);
  });

  test("compiled authority installs a reusable real pair without modifying the runner or payloads", async () => {
    const pair = process.env.BRUV_TEST_UPDATE_PAIR_DIR ?? join(import.meta.dir, "..", "dist");
    const normal = join(pair, "bruv");
    const connector = join(pair, "bruv-claude-compat");
    const product = await run([normal, "--version"]);
    expect(product.code, product.stderr).toBe(0);
    const version = product.stdout.trim();
    const normalHash = digest(await readFile(normal));
    const connectorHash = digest(await readFile(connector));
    const x = await installation();
    const result = await run([runner], fixtureEnv(x.target, normal, connector, version));
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "updated", version, path: x.target });
    expect(digest(await readFile(x.target))).toBe(normalHash);
    expect(digest(await readFile(x.connector))).toBe(connectorHash);
    const installedEnv = { HOME: dir, PATH: "/nonexistent" };
    const installedProduct = await run([x.target, "--version"], installedEnv);
    const installedConnector = await run([x.connector, "--bruv-version"], installedEnv);
    expect(installedProduct.code, installedProduct.stderr).toBe(0);
    expect(installedProduct.stdout.trim()).toBe(version);
    expect(installedConnector.code, installedConnector.stderr).toBe(0);
    expect(installedConnector.stdout.trim()).toBe("bruv-claude-compat " + version);
    expect((await readdir(x.install)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    expect(digest(await readFile(runner))).toBe(runnerHash);
    expect(digest(await readFile(normal))).toBe(normalHash);
    expect(digest(await readFile(connector))).toBe(connectorHash);
  }, 60_000);
});
