import { expect, test } from "bun:test";
import { resolve } from "node:path";

// Isolate Bun module controls from all other tests. Each child imports the exact
// installed SDK 1.0.3 init and real syntax loader, never a copied startup method.
for (const scenario of ["saved", "saved-ready", "empty", "empty-stopped", "rebind-error"]) {
  test("patched SDK startup: " + scenario, async () => {
    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, "fixtures/saved-transcript-startup.ts"), scenario],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PI_PACKAGE_DIR: undefined, NO_COLOR: undefined, HERDR_ENV: "0" },
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
