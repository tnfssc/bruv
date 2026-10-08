import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../../..");

/** Owns each child's writable environment and drains both pipes before returning.
 * Keep the fixture and reports for inspection; no inherited HOME/config/SDK cleanup.
 */
export async function createTerminalPerfProcessFixture() {
  const root = await mkdtemp(join(tmpdir(), "bruv-terminal-perf-process-"));
  const home = join(root, "home");
  const config = join(root, "config");
  const cache = join(root, "cache");
  const data = join(root, "data");
  const state = join(root, "state");
  const sdk = join(root, "sdk");
  const temporary = join(root, "tmp");
  await Promise.all([home, config, cache, data, state, sdk, temporary].map((path) => mkdir(path)));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: data,
    XDG_STATE_HOME: state,
    PI_CODING_AGENT_DIR: sdk,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    SHELL: "/bin/sh",
  };
  return {
    root,
    async run(args: string[]) {
      const child = Bun.spawn([process.execPath, ...args], {
        cwd: repository,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    },
  };
}
