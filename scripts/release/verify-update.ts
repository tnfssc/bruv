/** Exercise the current compiled updater against the actual host release pair.
 * Fake official fetch responses only; no network or running installation replacement.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { updateAssetFor } from "../../src/update";
import { describeUpdateProbe } from "./verify-update-probe";

const [input, version, updaterMode] = process.argv.slice(2);
if (updaterMode && updaterMode !== "--legacy-updater") throw new Error(`Unknown updater mode: ${updaterMode}`);
const legacy = updaterMode === "--legacy-updater";
if (!input || !version || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Usage: bun scripts/release/verify-update.ts <staged-raw-asset> <version> [--legacy-updater]");
const asset = updateAssetFor(process.platform, process.arch);
if (!asset || basename(input) !== asset) throw new Error(`Use the raw asset for this host: ${asset}`);
const connectorAsset = asset.replace(/^bruv-/, "bruv-claude-compat-");
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const releaseDirectory = resolve(dirname(input));
const bruv = await readCandidate(releaseDirectory, asset);
const connector = await readCandidate(releaseDirectory, connectorAsset);
const candidates = [bruv, connector];
const directory = await mkdtemp(join(tmpdir(), "bruv-update-gate-"));
try {
  await mkdir(join(directory, "install"));
  // Match the updater's realpath target even when TMPDIR is an alias (macOS /var -> /private/var).
  const install = await realpath(join(directory, "install"));
  const installedPair = [
    {
      ...bruv,
      path: join(install, "bruv"),
      original: "previous normal",
      versionArg: "--version",
      versionOutput: version,
    },
    {
      ...connector,
      path: join(install, "bruv-claude-compat"),
      original: "previous connector",
      versionArg: "--bruv-version",
      versionOutput: `bruv-claude-compat ${version}`,
    },
  ] as const;
  const [installedBruv, installedConnector] = installedPair;
  for (const file of installedPair) await writeFile(file.path, file.original, { mode: 0o755 });
  for (const candidate of candidates) await writeFile(join(directory, candidate.name), candidate.bytes);
  const runner = join(directory, "runner.ts");
  const updaterSource = resolve(
    import.meta.dir,
    legacy ? "../../tests/release/update-v0.16.3-fixture.ts" : "../../src/update.ts",
  );
  await writeFile(
    runner,
    `
import { updateBruv, RELEASES_URL } from ${JSON.stringify(updaterSource)};
import { rename } from "node:fs/promises";

const root = ${JSON.stringify(`https://github.com/tnfssc/bruv/releases/download/v${version}/`)};
const names = ${JSON.stringify(candidates.map((candidate) => candidate.name))};
const directory = ${JSON.stringify(directory)};
const installedBruv = ${JSON.stringify(installedBruv.path)};
const assets = await Promise.all(names.map(async name => ({
  name,
  bytes: await Bun.file(directory + "/" + name).bytes(),
})));

try {
  const result = await updateBruv({
    executable: installedBruv,
    currentVersion: ${JSON.stringify(legacy ? "0.16.3" : "0.0.0")},
    rename: async (from, to) => {
      if (process.argv.includes("--fail-normal-rename") && to === installedBruv)
        throw new Error("injected normal rename failure");
      await rename(from, to);
    },
    fetch: async input => {
      const url = String(input);
      if (url === RELEASES_URL) return Response.json({
        tag_name: ${JSON.stringify(`v${version}`)},
        prerelease: false,
        draft: false,
        assets: names.flatMap(name => [name, name + ".sha256"]).map(name => ({
          name, browser_download_url: root + name,
        })),
      });
      for (const { name, bytes } of assets) {
        if (url === root + name) return new Response(bytes);
        if (url === root + name + ".sha256") {
          const checksum = process.argv.includes("--corrupt=" + name)
            ? "0".repeat(64)
            : new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
          return new Response(checksum + "  " + name);
        }
      }
      throw new Error("Unexpected request: " + url);
    },
  });
  console.log(JSON.stringify(result));
} catch (error) {
  // Print only the message: source excerpts can falsely include the rollback success marker.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
`,
  );
  const executable = join(directory, "updater-runner");
  const build = await Bun.build({ entrypoints: [runner], compile: { outfile: executable } });
  if (!build.success) throw new Error(`Could not compile current updater: ${build.logs.join("\n")}`);
  const runnerHash = hash(await readFile(executable));
  const runnerHome = join(directory, "runner-home");
  await mkdir(runnerHome);
  const runnerEnv = {
    ...process.env,
    HOME: runnerHome,
    XDG_CONFIG_HOME: join(runnerHome, "config"),
    XDG_CACHE_HOME: join(runnerHome, "cache"),
    XDG_DATA_HOME: join(runnerHome, "data"),
  };
  for (const candidate of candidates) {
    const failed = spawnSync(executable, [`--corrupt=${candidate.name}`], { encoding: "utf8", env: runnerEnv });
    if (failed.status === 0 || !failed.stderr?.includes(`Checksum verification failed for ${candidate.name}`))
      throw new Error(
        "Compiled paired updater failed checksum gate: " +
          describeUpdateProbe(executable, [`--corrupt=${candidate.name}`], failed),
      );
    await assertPairPreserved(installedPair, "Checksum failure changed installed pair");
  }
  const rollback = spawnSync(executable, ["--fail-normal-rename"], { encoding: "utf8", env: runnerEnv });
  if (
    rollback.status === 0 ||
    !rollback.stderr?.includes("injected normal rename failure") ||
    !rollback.stderr?.includes("Previous installation restored")
  )
    throw new Error(
      `Compiled updater failed rollback gate: ${describeUpdateProbe(executable, ["--fail-normal-rename"], rollback)}`,
    );
  await assertPairPreserved(installedPair, "Rollback changed installed pair");
  const updated = spawnSync(executable, [], { encoding: "utf8", env: runnerEnv });
  if (updated.status !== 0)
    throw new Error(`Compiled paired updater failed replacement: ${describeUpdateProbe(executable, [], updated)}`);
  const result = JSON.parse(updated.stdout);
  if (result.status !== "updated" || result.version !== version)
    throw new Error(`Unexpected paired update result: ${describeUpdateProbe(executable, [], updated)}`);
  for (const file of installedPair) {
    if (hash(await readFile(file.path)) !== file.expected) throw new Error("Replacement SHA256 mismatch");
    const home = join(directory, `home-${file.name}`);
    await mkdir(home);
    const actual = spawnSync(file.path, [file.versionArg], {
      encoding: "utf8",
      env: { HOME: home, PATH: "/usr/bin:/bin" },
    });
    if (actual.status !== 0 || actual.stdout.trim() !== file.versionOutput)
      throw new Error(`Replacement version mismatch: ${describeUpdateProbe(file.path, [file.versionArg], actual)}`);
  }
  // Once installed outside the old updater's stage, expose the label-only CLI identity.
  const displayIdentity = spawnSync(installedConnector.path, ["--version"], {
    encoding: "utf8",
    env: { HOME: join(directory, `home-${installedConnector.name}`), PATH: "/usr/bin:/bin" },
  });
  if (
    displayIdentity.status !== 0 ||
    displayIdentity.stdout.trim() !== "Bruv connector" ||
    displayIdentity.stderr !== ""
  )
    throw new Error(
      "Installed launcher retained the legacy version label: " +
        describeUpdateProbe(installedConnector.path, ["--version"], displayIdentity),
    );
  if (hash(await readFile(executable)) !== runnerHash) throw new Error("Gate replaced its running updater");
  if ((await readdir(install)).some((name) => name.startsWith(".bruv-update-")))
    throw new Error("Update staging was not cleaned");
  console.log(
    (legacy ? "Frozen v0.16.3" : "Compiled paired Bruv") +
      " updater: checksum failures preserved BOTH installed files; second-rename rollback restored pair; replacement SHA256 and matched versions " +
      version +
      " passed (" +
      asset +
      " + " +
      connectorAsset +
      ")",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function readCandidate(directory: string, name: string) {
  const bytes = await readFile(join(directory, name));
  const expected = hash(bytes);
  const checksum = (await readFile(join(directory, `${name}.sha256`), "utf8")).trim();
  if (checksum !== `${expected}  ${name}`) throw new Error(`Staged release checksum mismatch: ${name}`);
  return { name, bytes, expected };
}

async function assertPairPreserved(pair: ReadonlyArray<{ path: string; original: string }>, message: string) {
  for (const file of pair) {
    if ((await readFile(file.path, "utf8")) !== file.original) throw new Error(message);
  }
}
