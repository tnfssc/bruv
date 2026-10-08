import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { extractNativeHelper } from "../src/live/helper";

// Execute the real diagnostic and real subprocesses, substituting only embedded
// resolution. A shell fixture cannot prove macOS audio or provider readiness.
async function probe(self: string, protocol: string) {
  const root = await mkdtemp(join(tmpdir(), "live-self-test-"));
  const bytes = Buffer.from(
    [
      "#!/bin/sh",
      'printf "%s\n" "$*" >> "$HOME/calls"',
      'printf "%s" "$OPENAI_API_KEY" > "$HOME/credential"',
      'if [ "$1" = --self-test ]; then',
      self,
      "else",
      'cat > "$HOME/input"',
      protocol,
      "fi",
      "",
    ].join("\n"),
  );
  try {
    const helper = await extractNativeHelper(bytes, createHash("sha256").update(bytes).digest("hex"), root);
    // Module mocks are confined to this child; no root-suite module cache changes.
    const runner = [
      'import { mock } from "bun:test";',
      'import { rm } from "node:fs/promises";',
      "mock.module(" + JSON.stringify(join(import.meta.dir, "../src/live/helper.ts")) + ", () => ({",
      "resolveEmbeddedNativeHelper: async () => ({ path: " + JSON.stringify(helper.path) + ",",
      "cleanup: () => rm(" + JSON.stringify(dirname(helper.path)) + ", { recursive: true, force: true }) }) }));",
      "const { testEmbeddedNativeHelper } = await import(" +
        JSON.stringify(join(import.meta.dir, "../src/live/self-test.ts")) +
        ");",
      "try { await testEmbeddedNativeHelper(); } catch (e) { console.error(e.message); process.exitCode = 1; }",
    ].join("\n");
    const run = spawnSync(process.execPath, ["-e", runner], {
      encoding: "utf8",
      timeout: 12_000,
      env: { ...process.env, HOME: root, TMPDIR: root, OPENAI_API_KEY: "fixture-secret" },
    });
    expect(run.error).toBeUndefined();
    expect(await Bun.file(helper.path).exists()).toBe(false);
    expect(await readFile(join(root, "credential"), "utf8")).toBe("");
    const calls = await readFile(join(root, "calls"), "utf8");
    if (calls !== "--self-test\n") {
      expect(await readFile(join(root, "input"), "utf8")).toBe('{"type":"stop"}\n');
    }
    const pidFile = Bun.file(join(root, "pid"));
    if (await pidFile.exists()) {
      const pid = Number(await pidFile.text());
      expect(() => process.kill(pid, 0)).toThrow();
    }
    return { ...run, calls };
  } finally {
    await releaseFixture(root);
  }
}

async function releaseFixture(root: string) {
  // Also release the fixture if the diagnostic regresses and leaves it alive.
  const pidFile = Bun.file(join(root, "pid"));
  if (await pidFile.exists()) {
    try {
      process.kill(Number(await pidFile.text()), "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  await rm(root, { recursive: true, force: true });
}

const greeting = 'printf \'%s\\n\' \'{"type":"hello","protocol":1}\' \'{"type":"stopped"}\'';

test("release diagnostic runs self-test then stop-only protocol and cleans up", async () => {
  const run = await probe("exit 0", greeting);
  expect(run.status).toBe(0);
  expect(run.calls).toBe("--self-test\n\n");
  expect(run.stdout).toBe("Embedded native helper self-test and protocol v1 passed (no devices)\n");
});

test("self-test failure skips protocol and still cleans up", async () => {
  const run = await probe("exit 7", greeting);
  expect(run.status).toBe(1);
  expect(run.calls).toBe("--self-test\n");
  expect(run.stderr).toContain("Embedded native helper self-test failed");
});

test("protocol failure and mismatch still clean up", async () => {
  const malformed = "printf '%s\\n' 'not JSON'";
  for (const protocol of [
    "exit 7",
    'printf \'%s\\n\' \'{"type":"hello","protocol":2}\' \'{"type":"stopped"}\'',
    'printf \'%s\\n\' \'{"type":"hello","protocol":1}\'',
    malformed,
  ]) {
    const run = await probe("exit 0", protocol);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    if (protocol === "exit 7") expect(run.stderr).toContain("protocol test failed");
    else if (protocol !== malformed) expect(run.stderr).toContain("protocol mismatch");
  }
});

for (const phase of ["self-test", "protocol"]) {
  test(phase + " timeout leaves no process or extraction behind", async () => {
    const hang = 'echo "$$" > "$HOME/pid"; exec sleep 30';
    const run = await probe(phase === "self-test" ? hang : "exit 0", phase === "protocol" ? hang : greeting);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(phase === "self-test" ? "self-test failed" : "protocol test failed");
  }, 15_000);
}
