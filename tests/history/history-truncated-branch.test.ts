import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../helpers/helpers";

test("disk metadata walks preserve truncated native branches and quietly deliver cycle nodes once", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-truncated-history-"));
  try {
    const result = await run([process.execPath, "tests/history/history-truncated-branch.probe.ts"], {
      env: { ...process.env, PROBE_ROOT: root },
    });
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "" });
    expect(result.stdout.trim()).toBe("truncated and cyclic walks preserve originals");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
