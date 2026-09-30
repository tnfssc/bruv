import { execFileSync } from "node:child_process";
import { lstat, readlink, readdir, realpath, rename, rm } from "node:fs/promises";
import { resolve, join, relative as relativePath, sep } from "node:path";
import { verifyWebSource } from "../integrations/t3/build/verify-source";

// Local producer receipt, NOT an artifact-cache trust mechanism. Never restore it
// from elsewhere. dist/die-web is deliberately not consulted by consumers.
const manifestName = "dist/die-web.archive.manifest.json";
const lifetime = 12 * 60 * 60 * 1000;
const hash = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const excluded = new Set([".git", "node_modules", "dist", ".turbo"]);
async function tree(directory: string): Promise<string> {
  const entries: [string, string][] = [];
  async function walk(path: string, relative: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (excluded.has(entry.name)) continue;
      const name = relative + entry.name;
      if (entry.isDirectory()) await walk(join(path, entry.name), name + "/");
      else {
        const absolute = join(path, entry.name);
        if (entry.isSymbolicLink()) {
          const target = await realpath(absolute);
          const within = relativePath(directory, target);
          if (within === ".." || within.startsWith(".." + sep) || within.split(sep).some((part) => excluded.has(part)))
            throw new Error("Packed web input symlink escapes the owned input tree: " + name);
          // Internal targets are hashed by the normal tree walk. Do not follow
          // directory links (or cycles), and never omit external mutable inputs.
          entries.push([name, "symlink:" + (await readlink(absolute))]);
        } else {
          const metadata = String((await lstat(absolute)).mode & 0o777);
          entries.push([name, metadata + ":" + hash(await Bun.file(absolute).bytes())]);
        }
      }
    }
  }
  await walk(directory, "");
  return hash(JSON.stringify(entries));
}
async function identity(root: string, source: string) {
  const patch = resolve(root, "integrations/t3/upstream/die.patch");
  const pin = await Bun.file(resolve(root, "integrations/t3/upstream/source.json")).json();
  const revision = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (revision !== pin.revision) throw new Error("Packed web source pin mismatch");
  await verifyWebSource(source, patch);
  const files = ["package.json", "bun.lock", "mise.toml", "src/t3/web/archive.ts", "scripts/packed-web.ts"];
  const inputs: Record<string, string> = {};
  for (const file of files) inputs[file] = hash(await Bun.file(resolve(root, file)).bytes());
  // Include build/verifier/patch/bootstrap/pin/chunk-test code, including ignored
  // env/config files in upstream. Generated outputs and installed packages are
  // excluded; this assumes the same trusted frozen-install workspace.
  inputs.integration = await tree(resolve(root, "integrations/t3"));
  inputs.source = await tree(source);
  for (const file of ["node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml"]) {
    const installed = Bun.file(resolve(source, file));
    inputs[file] = (await installed.exists()) ? hash(await installed.bytes()) : "absent";
  }
  // npm lifecycle/step plumbing and PATH are invocation metadata, not payload
  // configuration. Tool versions are checked separately. Hash other inherited
  // variables without writing their potentially secret values to the receipt.
  const environment = Object.fromEntries(
    Object.entries(process.env)
      .filter(
        ([key]) =>
          !/^(npm_(lifecycle_(event|script)$|package_(json|name|version)$|execpath$|node_execpath$|command$|config_(user_agent|local_prefix)$)|_$|SHLVL$|PWD$|OLDPWD$|INIT_CWD$|DIE_T3_SOURCE$|PATH$|GITHUB_(ACTION|ENV|OUTPUT|STEP_SUMMARY|STATE)$)/.test(
            key,
          ),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const tool = (name: string) => execFileSync(name, ["--version"], { encoding: "utf8" }).trim();
  return {
    workspace: await realpath(root),
    source: await realpath(source),
    revision,
    inputs,
    environment: hash(JSON.stringify(environment)),
    bun: Bun.version,
    node: tool("node"),
    pnpm: tool("pnpm"),
    platform: process.platform,
    arch: process.arch,
  };
}
function inputKey(value: Awaited<ReturnType<typeof identity>>): string {
  const { workspace: _workspace, source: _source, ...content } = value;
  return hash(JSON.stringify({ version: 1, ...content }));
}
/** Exact content key for a future trusted restore owner; no origin authorization. */
export async function packedWebInputKey(root: string): Promise<string> {
  const pin = await Bun.file(resolve(root, "integrations/t3/upstream/source.json")).json();
  const source = resolve(process.env.DIE_T3_SOURCE ?? root + "/.cache/die-t3code-" + pin.revision);
  return inputKey(await identity(root, source));
}
async function archiveIdentity(root: string) {
  const bytes = await Bun.file(resolve(root, "dist/die-web.archive.gz")).bytes();
  if (!bytes.length) throw new Error("Packed web archive is empty");
  return { sha256: hash(bytes), size: bytes.length };
}
export async function invalidatePackedWeb(root: string): Promise<void> {
  await rm(resolve(root, manifestName), { force: true });
}
/** Call only after the fresh producer's source/type/chunk/portable checks and packing. */
export async function recordVerifiedPackedWeb(root: string, source: string): Promise<void> {
  const inputs = await identity(root, source);
  const manifest = {
    version: 1,
    inputKey: inputKey(inputs),
    created: Date.now(),
    producer: "buildWeb",
    identity: inputs,
    archive: await archiveIdentity(root),
  };
  const destination = resolve(root, manifestName);
  await Bun.write(destination + ".tmp", JSON.stringify(manifest, null, 2) + "\n");
  await rename(destination + ".tmp", destination);
}
export async function verifyPackedWeb(root: string): Promise<string> {
  try {
    const manifest = await Bun.file(resolve(root, manifestName)).json();
    if (
      manifest.version !== 1 ||
      manifest.producer !== "buildWeb" ||
      !Number.isFinite(manifest.created) ||
      manifest.created > Date.now() ||
      Date.now() - manifest.created > lifetime
    )
      throw new Error("missing or expired producer identity");
    const pin = await Bun.file(resolve(root, "integrations/t3/upstream/source.json")).json();
    const source = resolve(process.env.DIE_T3_SOURCE ?? root + "/.cache/die-t3code-" + pin.revision);
    if (JSON.stringify(manifest.identity) !== JSON.stringify(await identity(root, source)))
      throw new Error("build inputs changed");
    if (manifest.inputKey !== inputKey(manifest.identity)) throw new Error("input key mismatch");
    const archive = await archiveIdentity(root);
    if (JSON.stringify(manifest.archive) !== JSON.stringify(archive)) throw new Error("archive bytes changed");
    return archive.sha256;
  } catch (error) {
    throw new Error("Cannot reuse packed web; run a fresh build:web producer: " + String(error));
  }
}

/** Shared dispatch keeps compile-only selection independently testable. */
export async function prepareWebPayload(
  root: string,
  mode: "fresh" | "repack" | "packed",
  actions: { fresh: () => Promise<void>; repack: () => Promise<void> },
): Promise<void> {
  if (mode === "packed") console.log("Verified packed web runtime (sha256 " + (await verifyPackedWeb(root)) + ")");
  else {
    await invalidatePackedWeb(root);
    if (mode === "fresh") await actions.fresh();
    else await actions.repack();
  }
}
