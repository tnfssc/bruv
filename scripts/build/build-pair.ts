import { basename, dirname, resolve } from "node:path";

/** One connector build refreshes both siblings, including release target suffixes. */
export function pairedBuildCommand(options: string[], root: string, bun: string): string[] {
  options = options.filter((arg) => arg !== "--");
  const output = options.find((arg) => arg.startsWith("--outfile="))?.slice("--outfile=".length) ?? "dist/bruv";
  const name = basename(output);
  if (!/^bruv(?:$|-|\.exe$)/.test(name) || name.startsWith("bruv-claude-compat"))
    throw new Error("Paired output must name the normal bruv binary (optionally with a target suffix)");
  const connector = resolve(root, dirname(output), name.replace(/^bruv/, "bruv-claude-compat"));
  return [
    bun,
    resolve(root, "scripts/build", "build-claude-compat.ts"),
    ...options.filter((arg) => !arg.startsWith("--outfile=")),
    `--outfile=${connector}`,
  ];
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../..");
  const command = pairedBuildCommand(process.argv.slice(2), root, process.execPath);
  const child = Bun.spawn(command, { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}
