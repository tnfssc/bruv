import { resolve } from "node:path";
import { nativeHelperPlugin } from "./live/helper-bundle";

const root = resolve(import.meta.dir, "..");
let output = "dist/bruv";
let target: string | undefined;
let helper: string | undefined;
for (const argument of process.argv.slice(2)) {
  if (argument === "--") continue;
  if (argument.startsWith("--outfile=")) output = argument.slice("--outfile=".length);
  else if (argument.startsWith("--live-helper=")) helper = argument.slice("--live-helper=".length);
  else if (argument.startsWith("--target=")) target = argument.slice("--target=".length);
  else throw new Error("Unknown build option: " + argument);
}
if (!output) throw new Error("--outfile requires a path");
if (target === "") throw new Error("--target requires a value");
if (helper === "") throw new Error("--live-helper requires a path");
const plugins = helper ? [await nativeHelperPlugin(helper, target ?? `bun-${process.platform}-${process.arch}`)] : [];
const outfile = resolve(root, output);
// This file is not executed or probed for permissions during the build.
const compile = { outfile, ...(target ? { target } : {}) };
const result = await Bun.build({
  entrypoints: [resolve(root, "src/cli.ts")],
  compile: compile as Exclude<Parameters<typeof Bun.build>[0]["compile"], boolean | string | undefined>,
  minify: true,
  plugins,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("Built " + outfile);
