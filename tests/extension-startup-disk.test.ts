import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./helpers";

for (const corruptMiddle of [false, true]) {
  test(`installed extension startup filters disk metadata${corruptMiddle ? " across a corrupt middle row" : " before reading old checkpoints"}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "bruv-extension-startup-"));
    try {
      const result = await run([process.execPath, "tests/extension-startup-disk.probe.ts"], {
        env: {
          ...process.env,
          PROBE_ROOT: root,
          PROBE_CORRUPT_MIDDLE: corruptMiddle ? "1" : undefined,
          BRUV_SUBAGENT_DEPTH: "0",
          BRUV_SUBAGENT_TYPE: undefined,
          BRUV_ROOT_RUNTIME_SOCKET: undefined,
          BRUV_ROOT_RUNTIME_TOKEN: undefined,
          T3_MCP_URL: undefined,
          T3_MCP_BEARER_TOKEN: undefined,
        },
      });
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("without auxiliary originals");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
}
