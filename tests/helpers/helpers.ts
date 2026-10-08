import { mkdirSync } from "node:fs";
import { join } from "node:path";

// The caller owns and retains this mkdtemp root. No parent configuration or credentials cross into a child.
export function ownedFixtureEnv(root: string): Record<string, string> {
  const home = join(root, "home");
  const config = join(home, "config");
  const cache = join(home, "cache");
  const data = join(home, "data");
  const sdk = join(home, "sdk");
  const temp = join(root, "tmp");
  const hooks = join(root, "empty-git-hooks");
  const bun = join(home, ".bun");
  for (const dir of [home, config, cache, data, sdk, temp, hooks, bun]) mkdirSync(dir, { recursive: true });
  return {
    PATH: "/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: data,
    PI_CODING_AGENT_DIR: sdk,
    BRUV_CODING_AGENT_DIR: sdk,
    TMPDIR: temp,
    BUN_INSTALL: bun,
    BUN_INSTALL_CACHE_DIR: join(cache, "bun"),
    NPM_CONFIG_USERCONFIG: join(config, "npmrc"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(config, "gitconfig"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: hooks,
    GIT_TERMINAL_PROMPT: "0",
    HERDR_ENV: "0",
  };
}

export function offlineTestEnv(
  source: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source, HERDR_ENV: "0" };
  delete env.HERDR_SOCKET_PATH;
  delete env.HERDR_PANE_ID;
  return env;
}

export async function run(
  command: string[],
  options: { env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: offlineTestEnv(options.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}
