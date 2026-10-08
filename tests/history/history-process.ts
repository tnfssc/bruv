import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runProcess } from "../helpers/helpers";

// Keep each fixture for inspection. No child inherits the user's home or SDK state.
export async function createHistoryFixture(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await Promise.all(["home", "config", "sdk", "tmp", "sessions"].map((name) => mkdir(join(root, name))));
  return root;
}

export function runHistoryProcess(root: string, args: string[], env: Record<string, string> = {}) {
  return runProcess([process.execPath, ...args], {
    cwd: join(import.meta.dir, "../.."),
    env: {
      PATH: process.env.PATH,
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "config"),
      PI_CODING_AGENT_DIR: join(root, "sdk"),
      TMPDIR: join(root, "tmp"),
      HISTORY_ROOT: join(root, "sessions"),
      ...env,
    },
  });
}
