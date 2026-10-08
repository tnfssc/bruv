import { run as runProcess } from "./helpers";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("owned SDK lifecycle keeps rewrite bodies, sorted trees, migrations, paths and discovery isolation", async () => {
  // Retain the owned fixture, including SDK spools, for the parent's isolated gate audit.
  const root = await mkdtemp(join(tmpdir(), "bruv-history-lifecycle-"));
  const home = join(root, "home");
  const config = join(root, "config");
  const sdk = join(root, "sdk");
  const temp = join(root, "tmp");
  await Promise.all([home, config, sdk, temp].map((path) => mkdir(path)));
  const { stdout, stderr, code } = await runProcess(
    [process.execPath, join(import.meta.dir, "fixtures", "history-storage-lifecycle.mjs")],
    {
      cwd: join(import.meta.dir, ".."),
      env: {
        HOME: home,
        XDG_CONFIG_HOME: config,
        PI_CODING_AGENT_DIR: sdk,
        TMPDIR: temp,
        PROBE_ROOT: root,
      },
    },
  );
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout.trim()).toBe("ok");
});
