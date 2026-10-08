import { test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ownedFixtureEnv } from "./helpers";

const suiteFileEnv = "BRUV_FIXTURE_SUITE_FILE";
const scenarioEnv = "BRUV_FIXTURE_SCENARIO";

// The Bun test host, managed jobs and compiled execute workers all descend from
// this allowlisted process. No inherited HOME/config/SDK/provider authority enters.
// Keep each root, launch manifest and output for the parent gate's audit.
async function runFixture(file: string, scenario?: { name: string; env: Record<string, string> }) {
  const root = await mkdtemp(join(tmpdir(), "bruv-owned-suite-"));
  const cwd = dirname(dirname(file));
  // JobService passes login flags to SHELL. This owned executable runs the same
  // command with non-login sh: no system/user startup files can redirect HOME.
  const shell = join(root, "fixture-shell");
  await writeFile(shell, '#!/bin/sh\nshift\nexec /bin/sh -c "$@"\n', { mode: 0o700 });
  const env = {
    ...ownedFixtureEnv(root),
    SHELL: shell,
    [suiteFileEnv]: file,
    ...(scenario ? { ...scenario.env, [scenarioEnv]: scenario.name } : {}),
  };
  const args = ["test", "--timeout", "30000", file];
  if (scenario) args.push("--test-name-pattern", "^" + scenario.name.replace(/[.*+?^$()|[\]\\]/g, "\\$&") + "$");
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
  test(`owned process: ${basename(file)}`, () => runFixture(file), 120_000);
}

// Synthetic root credentials are launch input to one separate fixture process,
// not mutations of the shared test host's environment.
export function ownedEnvironmentTest(
  file: string,
  name: string,
  env: Record<string, string>,
  scenario: () => Promise<void>,
): void {
  test(name, () => (process.env[scenarioEnv] === name ? scenario() : runFixture(file, { name, env })), 120_000);
}
