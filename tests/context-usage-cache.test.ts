import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./helpers";

// Prototype patches belong to one child. Retain its owned HOME/config/SDK and
// session files so failed gates can be inspected without touching user state.
test("request projection seeds numeric usage for the whole footer independent of routed limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-context-cache-"));
  const home = join(root, "home");
  const config = join(root, "config");
  const sdk = join(root, "sdk");
  const temp = join(root, "tmp");
  const sessions = join(root, "sessions");
  await Promise.all([home, config, sdk, temp, sessions].map((path) => mkdir(path)));
  const result = await run([process.execPath, resolve(import.meta.dir, "fixtures/context-usage-cache-scenario.mjs")], {
    cwd: resolve(import.meta.dir, ".."),
    env: {
      HOME: home,
      XDG_CONFIG_HOME: config,
      PI_CODING_AGENT_DIR: sdk,
      PI_CODING_AGENT_SESSION_DIR: sessions,
      TMPDIR: temp,
      ROOT: sessions,
    },
  });
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).warmFooterMaterializations).toBe(0);
}, 30000);
