import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../helpers/helpers";

test("connector storage installs bounded history before resume in a fresh process", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-compat-storage-"));
  try {
    const result = await run([process.execPath, "tests/claude-compat/claude-compat-storage-disk.probe.ts"], {
      env: { ...process.env, PROBE_ROOT: root },
    });
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "" });
    expect(result.stdout.trim()).toBe("connector storage installs disk history before its first resume open");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
