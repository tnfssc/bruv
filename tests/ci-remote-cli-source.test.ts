import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
test("source CLI remote entry validates request fields and preserves JSON pipe boundary", async () => {
  const home = await mkdtemp(join(tmpdir(), "die-remote-source-cli-"));
  try {
    for (const request of [
      "{",
      JSON.stringify({ op: "hello", unexpected: true }),
      JSON.stringify({ op: "not-an-op" }),
    ]) {
      const child = Bun.spawn([process.execPath, join(root, "src/cli.ts"), "--remote-control"], {
        cwd: home,
        env: { ...process.env, HOME: home, HERDR_ENV: "0", SHELL: "/bin/bash" },
        stdin: new Blob([request]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code, stderr).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ code: "request_failed" });
      expect(stdout.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(stdout).error).toBeTruthy();
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 15000);

test("real source CLI offline PTY: inbox, local capability, confirmation, durable revoke", async () => {
  const child = Bun.spawn(["python3", join(root, "tests/ci-remote-offline-source-pty.py")], {
    cwd: root,
    env: { ...process.env, BUN_BIN: process.execPath, SHELL: "/bin/bash", HERDR_ENV: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code, stderr + "\n" + stdout).toBe(0);
  expect(stdout).toContain("PASS source terminal");
}, 20000);
