import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const preload = resolve(import.meta.dir, "fixtures/history-sdk-probe-failure.ts");
const failureMessage = "injected soak append failure";
const cleanupMarker = "PROBE_CLEANUP_OK";

// Only the child imports the preload; its patches never touch the test runner.
async function runFailedSoak(skipManagerDisposal = false) {
  const child = Bun.spawn([process.execPath, "--preload", preload, "scripts/history-sdk-probe.ts"], {
    cwd: root,
    env: { ...process.env, BRUV_TEST_SKIP_MANAGER_DISPOSAL: skipManagerDisposal ? "1" : "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("SDK history probe disposes its pending manager when the live soak fails", async () => {
  const { stdout, stderr, exitCode } = await runFailedSoak();
  expect(exitCode).toBe(1);
  expect(stderr).toContain(failureMessage);
  expect(stdout).toContain(cleanupMarker);
  expect(stdout).not.toContain('"ok":true');
});

test("SDK history probe cleanup check rejects directory removal without manager disposal", async () => {
  const { stdout, stderr, exitCode } = await runFailedSoak(true);
  expect(exitCode).toBe(1);
  expect(stderr).toContain(failureMessage);
  expect(stderr).toContain("Probe must dispose its pending store before directory removal");
  expect(stdout).not.toContain(cleanupMarker);
  expect(stdout).not.toContain('"ok":true');
});
