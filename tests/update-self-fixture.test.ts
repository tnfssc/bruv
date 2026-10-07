import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RELEASES_URL, UPDATE_ASSETS } from "../src/update";
import { createFixtureReleaseFetch } from "./update-self-fixture";

type ExecutablePair = { bruv: string; connector: string };
type Installation = ExecutablePair & { directory: string };

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("private updater fixture transport", () => {
  for (const asset of Object.values(UPDATE_ASSETS)) {
    test("serves only the declared release pair for " + asset, async () => {
      const bruv = new TextEncoder().encode("normal payload");
      const connector = new TextEncoder().encode("connector payload");
      const fetch = createFixtureReleaseFetch(asset, "0.3.0", bruv, connector);
      const release = await (await fetch(new Request(RELEASES_URL))).json();
      const pair = [
        { name: asset, bytes: bruv },
        { name: asset.replace(/^bruv-/, "bruv-claude-compat-"), bytes: connector },
      ];
      const root = "https://github.com/tnfssc/bruv/releases/download/v0.3.0/";
      expect(release).toEqual({
        tag_name: "v0.3.0",
        assets: pair.flatMap(({ name }) => [
          { name, browser_download_url: root + name },
          { name: name + ".sha256", browser_download_url: root + name + ".sha256" },
        ]),
      });
      for (const { name, bytes } of pair) {
        const url = root + name;
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

  async function installation(): Promise<Installation> {
    const directory = await mkdtemp(join(dir, "install-"));
    const bruv = join(directory, "bruv");
    const connector = join(directory, "bruv-claude-compat");
    await writeFile(bruv, "original bruv", { mode: 0o754 });
    await writeFile(connector, "original connector", { mode: 0o754 });
    return { directory, bruv, connector };
  }

  async function expectInstallationUnchanged(installed: Installation) {
    expect(await readFile(installed.bruv, "utf8")).toBe("original bruv");
    expect(await readFile(installed.connector, "utf8")).toBe("original connector");
    expect((await readdir(installed.directory)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
  }

  function fixtureEnv(installed: Installation, payloads: ExecutablePair, version = "0.3.0") {
    return {
      HOME: dir,
      PATH: "/nonexistent",
      BRUV_TEST_UPDATE_TARGET: installed.bruv,
      BRUV_TEST_UPDATE_PAYLOAD: payloads.bruv,
      BRUV_TEST_UPDATE_CONNECTOR_PAYLOAD: payloads.connector,
      BRUV_TEST_UPDATE_VERSION: version,
    };
  }

  test("source execution has no compiled authority and leaves the install untouched", async () => {
    const installed = await installation();
    const result = await run([process.execPath, source], fixtureEnv(installed, installed));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Refusing to self-update a source Bun invocation");
    await expectInstallationUnchanged(installed);
  });

  test("wrong staged version preserves both installed files and removes staging", async () => {
    const installed = await installation();
    const normal = join(dir, "wrong-version");
    const connector = join(dir, "connector-stand-in");
    await writeFile(normal, "#!/bin/sh\necho 0.4.0\n");
    await writeFile(connector, "#!/bin/sh\necho bruv-claude-compat 0.3.0\n");
    const result = await run([runner], fixtureEnv(installed, { bruv: normal, connector }));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Installed files unchanged");
    expect(result.stderr).toContain("version");
    await expectInstallationUnchanged(installed);
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
    const installed = await installation();
    const result = await run([runner], fixtureEnv(installed, { bruv: normal, connector }, version));
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "updated", version, path: installed.bruv });
    expect(digest(await readFile(installed.bruv))).toBe(normalHash);
    expect(digest(await readFile(installed.connector))).toBe(connectorHash);
    const installedEnv = { HOME: dir, PATH: "/nonexistent" };
    const installedProduct = await run([installed.bruv, "--version"], installedEnv);
    const installedConnector = await run([installed.connector, "--bruv-version"], installedEnv);
    expect(installedProduct.code, installedProduct.stderr).toBe(0);
    expect(installedProduct.stdout.trim()).toBe(version);
    expect(installedConnector.code, installedConnector.stderr).toBe(0);
    expect(installedConnector.stdout.trim()).toBe("bruv-claude-compat " + version);
    expect((await readdir(installed.directory)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    expect(digest(await readFile(runner))).toBe(runnerHash);
    expect(digest(await readFile(normal))).toBe(normalHash);
    expect(digest(await readFile(connector))).toBe(connectorHash);
  }, 60_000);
});
