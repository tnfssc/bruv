/** Exact pinned-web cache owner. This is opt-in CI plumbing, not the default build. */
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildWeb, prepareWebSource } from "../integrations/t3/build/build";
import { verifyWebSource } from "../integrations/t3/build/verify-source";
import { recordVerifiedPackedWeb } from "./packed-web";

const root = resolve(import.meta.dir, "..");
const sha = (bytes: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
// No root CLI sources are consumed. The chunk verifier uses a locked root dependency.
// Upstream source.json pins the complete upstream graph (including its lockfile).
export const webInputs = [
  "package.json",
  "bun.lock",
  "mise.toml",
  "scripts/ci-web.ts",
  "scripts/packed-web.ts",
  "src/t3/web/archive.ts",
  "integrations/t3/build/build.ts",
  "integrations/t3/build/verify-source.ts",
  "integrations/t3/upstream/source.json",
  "integrations/t3/upstream/bruv.patch",
  "integrations/t3/upstream/bootstrap.mjs",
  "integrations/t3/upstream/chunks-startup.test.mjs",
];
const fixedEnvironment = {
  CI: "true",
  TZ: "UTC",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  SOURCE_DATE_EPOCH: "0",
  npm_config_userconfig: "/dev/null",
  npm_config_globalconfig: "/dev/null",
  npm_config_registry: "https://registry.npmjs.org",
};
export function producerEnvironment(directory: string): Record<string, string> {
  const tools = [
    process.execPath,
    ...["node", "pnpm"].map((tool) => {
      const path = Bun.which(tool);
      if (!path) throw new Error("Missing producer tool: " + tool);
      return path;
    }),
  ];
  return {
    ...fixedEnvironment,
    PATH: [...new Set(tools.map(dirname)), "/usr/bin", "/bin"].join(":"),
    HOME: resolve(directory, ".cache/ci-web-home"),
    TMPDIR: resolve(directory, ".cache/ci-web-tmp"),
    // Download bytes only; the frozen install always runs, including cache hits.
    PNPM_CONFIG_STORE_DIR: resolve(process.env.PNPM_CONFIG_STORE_DIR ?? directory + "/.cache/ci-pnpm-store"),
  };
}
export async function rejectRootConfiguration(directory: string): Promise<void> {
  for (const entry of await readdir(directory)) {
    if ((entry.startsWith(".env") && entry !== ".env.example") || [".npmrc", ".pnpmfile.cjs"].includes(entry))
      throw new Error("CI web producer rejects configuration outside its contract: " + entry);
  }
  if (process.env.BRUV_T3_SOURCE)
    throw new Error("CI web producer owns BRUV_T3_SOURCE; use the fresh local build for custom sources");
}
export async function ciWebInputKey(directory: string, toolchain?: Record<string, string>): Promise<string> {
  await rejectRootConfiguration(directory);
  const inputs = [];
  for (const path of webInputs) {
    const file = resolve(directory, path);
    const info = await lstat(file);
    if (!info.isFile()) throw new Error("Expected regular producer input: " + path);
    inputs.push([path, info.mode & 0o111, sha(await Bun.file(file).bytes())]);
  }
  const env = producerEnvironment(directory);
  const tool = (name: string, args = ["--version"]) =>
    execFileSync(name, args, { env, cwd: directory, encoding: "utf8" }).trim();
  return sha(
    JSON.stringify({
      version: 1,
      inputs,
      environment: fixedEnvironment,
      tools: toolchain ?? {
        bun: Bun.version,
        node: tool("node"),
        pnpm: tool("pnpm"),
        compiler: tool("cc"),
        os: await Bun.file("/etc/os-release").text(),
        libc: tool("node", ["-p", 'process.report.getReport().header.glibcVersionRuntime ?? "none"']),
      },
      platform: process.platform,
      arch: process.arch,
    }),
  );
}
export async function verifyProducerSource(source: string, patch: string): Promise<void> {
  await verifyWebSource(source, patch);
  // verifyWebSource rejects tracked drift/untracked source; additionally reject
  // ignored user inputs such as Vite .env files. Only producer outputs are allowed.
  const ignored = execFileSync(
    "git",
    ["-C", source, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
    { encoding: "utf8" },
  );
  for (const path of ignored.split("\0").filter(Boolean)) {
    if (
      !path.split("/").some((part) => ["node_modules", "dist", ".turbo"].includes(part)) &&
      !path.endsWith(".tsbuildinfo") &&
      !path.startsWith(".vite-hooks/_/") &&
      path !== ".generated/" &&
      !path.startsWith(".generated/third-party-licenses/")
    )
      throw new Error("CI web producer rejects ignored input: " + path);
  }
}
export async function cacheDigest(cache: string, key: string): Promise<string | undefined> {
  try {
    for (const file of ["receipt.json", "payload.gz"]) if (!(await lstat(resolve(cache, file))).isFile()) return;
    const receipt = await Bun.file(resolve(cache, "receipt.json")).json();
    const bytes = await Bun.file(resolve(cache, "payload.gz")).bytes();
    if (
      receipt.version === 1 &&
      receipt.inputKey === key &&
      bytes.length > 0 &&
      receipt.size === bytes.length &&
      receipt.sha256 === sha(bytes)
    )
      return receipt.sha256;
  } catch {
    /* Miss, malformed receipt or corrupt bytes: normal fresh build. */
  }
}
export async function saveCache(cache: string, key: string, archive: string): Promise<void> {
  await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });
  await cp(archive, resolve(cache, "payload.gz"));
  const bytes = await Bun.file(archive).bytes();
  await Bun.write(
    resolve(cache, "receipt.json"),
    JSON.stringify({ version: 1, inputKey: key, size: bytes.length, sha256: sha(bytes) }) + "\n",
  );
}
async function produce(command: "prepare" | "bundle") {
  const env = producerEnvironment(root);
  for (const directory of [env.HOME!, env.TMPDIR!]) {
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
  }
  const child = Bun.spawn([process.execPath, "--no-env-file", import.meta.path, "--producer", command], {
    cwd: root,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error("CI web " + command + " failed (exit " + code + ")");
}
async function main() {
  const [command, detail] = process.argv.slice(2);
  if (command === "--producer") {
    const pin = await Bun.file(resolve(root, "integrations/t3/upstream/source.json")).json();
    const source = resolve(root, ".cache/bruv-t3code-" + pin.revision);
    const patch = resolve(root, "integrations/t3/upstream/bruv.patch");
    if (detail === "prepare") {
      // Pinned license generation owns this output cache; never consume a user
      // populated copy in a new producer. Source/deps/dist are not restored.
      await rm(resolve(source, ".generated"), { recursive: true, force: true });
      await prepareWebSource({ verify: verifyProducerSource });
      await verifyProducerSource(source, patch);
    } else if (detail === "bundle") {
      await verifyProducerSource(source, patch);
      await buildWeb({ prepared: true });
      await verifyProducerSource(source, patch);
    } else throw new Error("Unknown producer command");
    return;
  }
  const key = await ciWebInputKey(root);
  if (command === "key") {
    console.log("web-v1-" + key);
    return;
  }
  if (command !== "build") throw new Error("Usage: bun scripts/ci-web.ts key|build");
  await produce("prepare");
  if (key !== (await ciWebInputKey(root))) throw new Error("Producer inputs changed during preparation");
  const pin = await Bun.file(resolve(root, "integrations/t3/upstream/source.json")).json();
  const source = resolve(root, ".cache/bruv-t3code-" + pin.revision);
  const cache = resolve(root, ".cache/ci-packed-web");
  const archive = resolve(root, "dist/bruv-web.archive.gz");
  if (await cacheDigest(cache, key)) {
    await mkdir(dirname(archive), { recursive: true });
    await cp(resolve(cache, "payload.gz"), archive);
    console.log("Exact pinned-web cache hit (source/deps prepared; all behavioral tests still run)");
  } else {
    console.log("Pinned-web cache miss/invalid; building and checking fresh");
    await produce("bundle");
    if (key !== (await ciWebInputKey(root))) throw new Error("Producer inputs changed during build");
    await saveCache(cache, key, archive);
  }
  // Rebind only after exact input/digest checks to the existing same-workspace
  // receipt. That receipt itself is NOT a cross-run authorization mechanism.
  await recordVerifiedPackedWeb(root, source);
}
if (import.meta.main) await main();
