import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../helpers/helpers";

/** Retained on purpose: only these owned paths may receive scenario writes. */
export function createHistoryFixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  const config = join(root, "config");
  const cache = join(root, "cache");
  const data = join(root, "data");
  const state = join(root, "state");
  const sdk = join(root, "sdk");
  const sessions = join(root, "sdk-sessions");
  const temp = join(root, "tmp");
  for (const path of [home, config, cache, data, state, sdk, sessions, temp]) mkdirSync(path);
  return {
    root,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: config,
      XDG_CACHE_HOME: cache,
      XDG_DATA_HOME: data,
      XDG_STATE_HOME: state,
      PI_CODING_AGENT_DIR: sdk,
      PI_CODING_AGENT_SESSION_DIR: sessions,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      PROBE_ROOT: root,
      HERDR_ENV: "0",
    },
  };
}

export function runHistoryFixture(
  name: string,
  fixture: ReturnType<typeof createHistoryFixture>,
  env: Record<string, string> = {},
) {
  return run([process.execPath, join(import.meta.dir, "..", "fixtures", name)], {
    cwd: join(import.meta.dir, "../..", ".."),
    env: { ...fixture.env, ...env },
  });
}
