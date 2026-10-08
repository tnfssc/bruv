import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Isolate Bun module controls from all other tests. Each child imports the exact
// installed SDK 1.1.0 init and real syntax loader, never a copied startup method.
for (const scenario of ["saved", "saved-ready", "empty", "empty-stopped", "rebind-error"]) {
  test("patched SDK startup: " + scenario, async () => {
    // Retain each scenario's files for inspection; never use the caller's SDK state.
    const fixture = await mkdtemp(join(tmpdir(), `bruv-saved-transcript-${scenario}-`));
    const home = join(fixture, "home");
    const config = join(fixture, "config");
    const sdkState = join(fixture, "sdk");
    const temp = join(fixture, "tmp");
    await Promise.all([home, config, sdkState, temp].map((path) => mkdir(path)));

    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, "fixtures/saved-transcript-startup.ts"), scenario],
      {
        cwd: fixture,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          HOME: home,
          XDG_CONFIG_HOME: config,
          PI_CODING_AGENT_DIR: sdkState,
          TMPDIR: temp,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          HERDR_ENV: "0",
        },
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(stdout).scenario).toBe(scenario);
  });
}
