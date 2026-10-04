import { resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { normalOutputForConnector, writeConnectorLauncher } from "./claude-compat-launcher";

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
const normal = normalOutputForConnector(outfile);
// Validate both destinations BEFORE compiling; never follow an output link.
for (const path of [outfile, normal]) {
  try {
    const file = await lstat(path);
    if (file.isSymbolicLink() || !file.isFile() || file.nlink > 1)
      throw new Error("Build output must be a regular file, not a symlink or hardlink: " + path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
// The standalone connector build ALSO refreshes its sibling. Never leave a tiny
// launcher pointing at an absent/stale normal executable or compile a second VM.
await import("./prepare-assets");
const command = [process.execPath, resolve(root, "scripts/build.ts"), "--outfile=" + normal];
if (target) command.push("--target=" + target);
if (helper) command.push("--live-helper=" + helper);
const child = Bun.spawn(command, { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
const code = await child.exited;
if (code !== 0) process.exit(code);
await writeConnectorLauncher(outfile, target);
console.log("Built Bruv connector launcher " + outfile);
