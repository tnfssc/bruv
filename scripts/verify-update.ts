/** Exercise the current compiled updater against the actual host release pair.
 * Fake official fetch responses only; no network or running installation replacement.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { updateAssetFor } from "../src/update";

const [input, version, updaterMode] = process.argv.slice(2);
if (updaterMode && updaterMode !== "--legacy-updater") throw new Error("Unknown updater mode: " + updaterMode);
const legacy = updaterMode === "--legacy-updater";
if (!input || !version || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Usage: bun scripts/verify-update.ts <staged-raw-asset> <version> [--legacy-updater]");
const asset = updateAssetFor(process.platform, process.arch);
if (!asset || basename(input) !== asset) throw new Error("Use the raw asset for this host: " + asset);
const connectorAsset = asset.replace(/^bruv-/, "bruv-claude-compat-");
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const candidates = [];
for (const name of [asset, connectorAsset]) {
  const bytes = await readFile(resolve(dirname(input), name));
  const checksum = (await readFile(resolve(dirname(input), name + ".sha256"), "utf8")).trim();
  if (checksum !== hash(bytes) + "  " + name) throw new Error("Staged release checksum mismatch: " + name);
  candidates.push({ name, bytes, expected: hash(bytes) });
}
const directory = await mkdtemp(join(tmpdir(), "bruv-update-gate-"));
try {
  const install = join(directory, "install");
  await mkdir(install);
  const installed = [join(install, "bruv"), join(install, "bruv-claude-compat")];
  const originals = ["previous normal", "previous connector"];
  for (let i = 0; i < installed.length; i++) await writeFile(installed[i]!, originals[i]!, { mode: 0o755 });
  for (const candidate of candidates) await writeFile(join(directory, candidate.name), candidate.bytes);
  const runner = join(directory, "runner.ts");
  await writeFile(
    runner,
    [
      "import { updateBruv, RELEASES_URL } from " +
        JSON.stringify(resolve(import.meta.dir, legacy ? "../tests/update-v0.16.3-fixture.ts" : "../src/update.ts")) +
        ";",
      'import { rename } from "node:fs/promises";',
      "const root = " + JSON.stringify("https://github.com/tnfssc/bruv/releases/download/v" + version + "/") + ";",
      "const names = " + JSON.stringify(candidates.map((candidate) => candidate.name)) + ";",
      "const assets = new Map(await Promise.all(names.map(async name => [name, await Bun.file(" +
        JSON.stringify(directory) +
        ' + "/" + name).bytes()])));',
      "const result = await updateBruv({ executable: " +
        JSON.stringify(installed[0]) +
        ', currentVersion: "' +
        (legacy ? "0.16.3" : "0.0.0") +
        '", rename: async (from, to) => { if (process.argv.includes("--fail-normal-rename") && to === ' +
        JSON.stringify(installed[0]) +
        ') throw new Error("injected normal rename failure"); await rename(from, to); }, fetch: async input => {',
      "const url = String(input);",
      "if (url === RELEASES_URL) return Response.json({tag_name: " +
        JSON.stringify("v" + version) +
        ', prerelease:false, draft:false, assets:names.flatMap(name=>[name,name+".sha256"]).map(name=>({name,browser_download_url:root+name}))});',
      "for (const [name, bytes] of assets) {",
      "if (url === root + name) return new Response(bytes);",
      'if (url === root + name + ".sha256") return new Response((process.argv.includes("--corrupt=" + name) ? "0".repeat(64) : new Bun.CryptoHasher("sha256").update(bytes).digest("hex")) + "  " + name);',
      "}",
      'throw new Error("Unexpected request: " + url); }}); console.log(JSON.stringify(result));',
    ].join("\n"),
  );
  const executable = join(directory, "updater-runner");
  const build = await Bun.build({ entrypoints: [runner], compile: { outfile: executable } });
  if (!build.success) throw new Error("Could not compile current updater: " + build.logs.join("\n"));
  const runnerHash = hash(await readFile(executable));
  for (const candidate of candidates) {
    const failed = spawnSync(executable, ["--corrupt=" + candidate.name], { encoding: "utf8" });
    if (failed.status === 0 || !failed.stderr.includes("Checksum verification failed for " + candidate.name))
      throw new Error("Compiled paired updater failed checksum gate: " + failed.stderr);
    for (let i = 0; i < installed.length; i++) {
      if ((await readFile(installed[i]!, "utf8")) !== originals[i])
        throw new Error("Checksum failure changed installed pair");
    }
  }
  const rollback = spawnSync(executable, ["--fail-normal-rename"], { encoding: "utf8" });
  if (rollback.status === 0 || !rollback.stderr.includes("Previous installation restored"))
    throw new Error("Compiled updater failed rollback gate: " + rollback.stderr);
  for (let i = 0; i < installed.length; i++) {
    if ((await readFile(installed[i]!, "utf8")) !== originals[i]) throw new Error("Rollback changed installed pair");
  }
  const updated = spawnSync(executable, [], { encoding: "utf8" });
  if (updated.status !== 0) throw new Error("Compiled paired updater failed replacement: " + updated.stderr);
  const result = JSON.parse(updated.stdout);
  if (result.status !== "updated" || result.version !== version) throw new Error("Unexpected paired update result");
  for (let i = 0; i < installed.length; i++) {
    if (hash(await readFile(installed[i]!)) !== candidates[i]!.expected) throw new Error("Replacement SHA256 mismatch");
    const home = join(directory, "home-" + i);
    await mkdir(home);
    const actual = spawnSync(installed[i]!, ["--bruv-version"], {
      encoding: "utf8",
      env: { HOME: home, PATH: "/usr/bin:/bin" },
    });
    const expected = version;
    if (actual.status !== 0 || actual.stdout.trim() !== expected)
      throw new Error("Replacement version mismatch: " + actual.stdout + actual.stderr);
  }
  // Once installed outside the old updater's stage, expose the SDK-facing version.
  const sdkVersion = spawnSync(installed[1]!, ["--version"], {
    encoding: "utf8",
    env: { HOME: join(directory, "home-1"), PATH: "/usr/bin:/bin" },
  });
  if (sdkVersion.status !== 0 || sdkVersion.stdout.trim() !== "2.1.280 (Bruv compatibility; bruv " + version + ")")
    throw new Error("Installed launcher retained the legacy version label: " + sdkVersion.stdout + sdkVersion.stderr);
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
