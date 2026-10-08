import { expect, test } from "bun:test";
import { resolve } from "node:path";

test.skipIf(process.platform !== "linux" || process.env.BRUV_REMOTE_JOBS_E2E !== "1")(
  "compiled normal CLI real execute jobs.targets/subagent(target) yields and wakes through session-isolated jobs coordinator",
  async () => {
    const child = Bun.spawn(["bash", resolve(import.meta.dir, "../../scripts/remote/remote-e2e.sh")], {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...process.env, BUN_BIN: process.execPath, REMOTE_E2E_SCRIPT: "scripts/remote/remote-jobs-e2e.ts" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, err + "\n" + out).toBe(0);
    expect(out).toContain(
      "PASS compiled CLI print/json boundary; normal CLI execute jobs.targets/subagent(target) -> two parent yields",
    );
  },
  300_000,
);
