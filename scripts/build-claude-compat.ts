import { resolve, basename } from "node:path";
import { lstat } from "node:fs/promises";
import { nativeHelperPlugin } from "./live-helper-bundle";

const root = resolve(import.meta.dir, "..");
let output = "dist/bruv-claude-compat";
let target: string | undefined;
let helper: string | undefined;
for (const argument of process.argv.slice(2)) {
  if (argument === "--") continue;
  if (argument.startsWith("--outfile=")) output = argument.slice("--outfile=".length);
  else if (argument.startsWith("--target=")) target = argument.slice("--target=".length);
  else if (argument.startsWith("--live-helper=")) helper = argument.slice("--live-helper=".length);
  else throw new Error("Unknown connector build option: " + argument);
}
if (!output || target === "" || helper === "") throw new Error("Connector build options require nonempty values");
const outfile = resolve(root, output);
if (["bruv", "bruv.exe"].includes(basename(outfile)))
  throw new Error("Connector build must not overwrite the normal Bruv executable");
try {
  if ((await lstat(outfile)).isSymbolicLink()) throw new Error("Connector output must not be a symlink");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
// Prepare exactly the normal Pi host and runtime assets; no web build, no root
// CLI changes, and no parallel engine/resources implementation.
await import("./prepare-assets");
const plugins = helper
  ? [await nativeHelperPlugin(helper, target ?? "bun-" + process.platform + "-" + process.arch)]
  : [];
const result = await Bun.build({
  entrypoints: [resolve(root, "src/claude-compat/cli.ts")],
  compile: { outfile, ...(target ? { target } : {}) } as Exclude<
    Parameters<typeof Bun.build>[0]["compile"],
    boolean | string | undefined
  >,
  minify: true,
  plugins,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
} else console.log("Built Bruv connector " + outfile);
