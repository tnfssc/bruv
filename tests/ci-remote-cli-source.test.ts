import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function successfulOutput(child: { stdout: ReadableStream; stderr: ReadableStream; exited: Promise<number> }) {
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code, stderr + "\n" + stdout).toBe(0);
  return stdout;
}

for (const { name, request, error } of [
  { name: "malformed JSON", request: "{", error: "JSON" },
  {
    name: "unsupported hello fields",
    request: JSON.stringify({ op: "hello", unexpected: true }),
    error: "Unsupported remote request field",
  },
  { name: "unknown operation", request: JSON.stringify({ op: "not-an-op" }), error: "Invalid request" },
]) {
  test(`source CLI rejects ${name} before owner dispatch and writes one JSON response`, async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-remote-source-cli-"));
    try {
      const child = Bun.spawn([process.execPath, join(root, "src/cli.ts"), "--remote-control"], {
        cwd: home,
        env: { ...process.env, HOME: home, HERDR_ENV: "0", SHELL: "/bin/bash" },
        stdin: new Blob([request]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await successfulOutput(child);
      expect(stdout.trim().split("\n")).toHaveLength(1);
      const response = JSON.parse(stdout);
      expect(response.code).toBe("request_failed");
      expect(response.error).toContain(error);
      // handleRemoteRequest creates this directory before dispatching even hello.
      expect(existsSync(join(home, ".bruv", "remote-owner"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15000);
}

test("real source CLI offline PTY: inbox, local capability, confirmation, durable revoke", async () => {
  // Python owns the isolated home and CLI lifetime. This proves local revocation,
  // not SSH delivery or cancellation.
  const child = Bun.spawn(["python3", join(root, "tests/ci-remote-offline-source-pty.py")], {
    cwd: root,
    env: { ...process.env, BUN_BIN: process.execPath, SHELL: "/bin/bash", HERDR_ENV: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await successfulOutput(child);
  expect(stdout).toContain("PASS source terminal");
}, 20000);
