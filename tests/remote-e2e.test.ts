import { expect, test } from "bun:test";
import { resolve } from "node:path";

// Deliberately opt-in: Docker/SSH Linux fixture runs the built normal CLI, not source mocks.
// Build first, then DIE_REMOTE_E2E=1 bun test tests/remote-e2e.test.ts.
test.skipIf(process.platform !== "linux" || process.env.DIE_REMOTE_E2E !== "1")(
  "normal CLI Docker/SSH fake-provider owner continues, answers native question, and reconnects",
  async () => {
    const runner = resolve(import.meta.dir, "../scripts/remote-e2e.sh");
    const child = Bun.spawn(["bash", runner], {
      cwd: resolve(import.meta.dir, ".."),
      env: { ...process.env, BUN_BIN: process.execPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr + "\n" + stdout).toBe(0);
    expect(stdout).toContain("PASS normal CLI RPC agent remote execute helper");
  },
  300_000,
);

// Opt in separately: real compiled terminal and disposable Docker/SSH native owner.
test.skipIf(process.platform !== "linux" || process.env.DIE_REMOTE_PTY_E2E !== "1")("compiled CLI /remote native question PTY", async () => {
  const runner = resolve(import.meta.dir, "../scripts/remote-e2e.sh");
  const child = Bun.spawn(["bash", runner], { cwd: resolve(import.meta.dir, ".."), env: { ...process.env, BUN_BIN: process.execPath, REMOTE_E2E_SCRIPT: "scripts/remote-pty-e2e.ts" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, stderr + "\n" + stdout).toBe(0);
  expect(stdout).toContain("PASS compiled CLI PTY remote menu");
}, 300_000);
