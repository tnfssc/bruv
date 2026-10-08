import { test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ownedFixtureEnv } from "./helpers";

const suiteFileEnv = "BRUV_FIXTURE_SUITE_FILE";

// The Bun test host, managed jobs and compiled execute workers all descend from
// this allowlisted process. No inherited HOME/config/SDK/provider authority enters.
// Keep each root, launch manifest and output for the parent gate's audit.
async function runOwnedProcess(file: string, args: string[], environment: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "bruv-owned-suite-"));
  const cwd = dirname(dirname(file));
  // JobService passes login flags to SHELL. This owned executable runs the same
  // command with non-login sh: no system/user startup files can redirect HOME.
  const shell = join(root, "fixture-shell");
  await writeFile(shell, '#!/bin/sh\nshift\nexec /bin/sh -c "$@"\n', { mode: 0o700 });
  const env = {
    ...ownedFixtureEnv(root),
    SHELL: shell,
    ...environment,
  };
  // Source remains in the durable worktree, never a copied /tmp code checkout.
  await writeFile(join(root, "launch.json"), JSON.stringify({ executable: process.execPath, args, cwd, env }, null, 2));
  await writeFile(join(root, "suite-source.ts"), await readFile(file));
  console.log(`Owned suite evidence: ${root}`);
  const child = spawn(process.execPath, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  const out = Buffer.concat(stdout),
    err = Buffer.concat(stderr);
  await Promise.all([
    writeFile(join(root, "stdout.log"), out),
    writeFile(join(root, "stderr.log"), err),
    writeFile(join(root, "result.json"), JSON.stringify(result, null, 2)),
  ]);
  if (result.code !== 0)
    throw new Error(
      `Fixture failed (${result.code ?? result.signal}); evidence: ${root}\n${out.toString()}${err.toString()}`,
    );
}

export function ownedProcessSuite(file: string, defineTests: () => void): void {
  if (process.env[suiteFileEnv] === file) {
    defineTests();
    return;
  }
  test(
    `owned process: ${basename(file)}`,
    () => runOwnedProcess(file, ["test", "--timeout", "30000", file], { [suiteFileEnv]: file }),
    120_000,
  );
}

// Environment-specific assertions have their own executable entry, not a filtered
// re-entry into a test suite. The entry must throw on assertion failure.
export function ownedProcessScenario(file: string, env: Record<string, string>): Promise<void> {
  return runOwnedProcess(file, ["run", file], env);
}
