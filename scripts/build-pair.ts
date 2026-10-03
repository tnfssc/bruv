import { basename, dirname, resolve } from "node:path";

/** Keep the connector beside the normal CLI, including release target suffixes. */
export function pairedBuildCommands(options: string[], root: string, bun: string): string[][] {
  options = options.filter((arg) => arg !== "--");
  const output = options.find((arg) => arg.startsWith("--outfile="))?.slice("--outfile=".length) ?? "dist/bruv";
  const name = basename(output);
  if (!/^bruv(?:$|-|\.exe$)/.test(name) || name.startsWith("bruv-claude-compat"))
    throw new Error("Paired output must name the normal bruv binary (optionally with a target suffix)");
  const connectorOutput = dirname(resolve(root, output));
  const connector = resolve(connectorOutput, name.replace(/^bruv/, "bruv-claude-compat"));
  const builds: [string, string][] = [
    ["build.ts", resolve(root, output)],
    ["build-claude-compat.ts", connector],
  ];
  return builds.map(([script, outfile]) => [
    bun,
    resolve(root, "scripts", script),
    ...options.filter((arg) => !arg.startsWith("--outfile=")),
    "--outfile=" + outfile,
  ]);
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  for (const command of pairedBuildCommands(process.argv.slice(2), root, process.execPath)) {
    const child = Bun.spawn(command, { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
    const code = await child.exited;
    if (code !== 0) process.exit(code);
  }
}
