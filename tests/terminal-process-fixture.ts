import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { run } from "./helpers";

// All process state belongs to this retained fixture, never the caller's HOME or SDK.
// The test owns tmux shutdown; leave these files available for independent review.
export async function createTerminalProcessFixture(prefix: string) {
  const home = await mkdtemp(join(tmpdir(), prefix));
  const socket = basename(home);
  const env = {
    PATH: process.env.PATH!,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_DATA_HOME: join(home, "data"),
    TMPDIR: join(home, "tmp"),
    BRUV_CODING_AGENT_DIR: join(home, ".bruv", "agent"),
    PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
    HERDR_ENV: "0",
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
  };
  await Promise.all(
    [
      env.XDG_CONFIG_HOME,
      env.XDG_CACHE_HOME,
      env.XDG_DATA_HOME,
      env.TMPDIR,
      env.BRUV_CODING_AGENT_DIR,
      env.PI_CODING_AGENT_DIR,
    ].map((directory) => mkdir(directory, { recursive: true })),
  );
  const config = join(home, "tmux.conf");
  await writeFile(config, "set -g extended-keys on\nset -g extended-keys-format csi-u\n");
  const tmux = (...args: string[]) => run(["tmux", "-L", socket, "-f", config, ...args], { cwd: home, env });
  // tmux accepts multiple command arguments without a shell. env -i also keeps the
  // pane process from regaining inherited credentials/config through the server.
  const paneCommand = (argv: string[], extraEnv: Record<string, string> = {}) => [
    "env",
    "-i",
    ...Object.entries({ ...env, ...extraEnv }).map(([key, value]) => key + "=" + value),
    ...argv,
  ];
  return { home, socket, env, tmux, paneCommand };
}
