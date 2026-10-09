import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { T3LaunchIdentityLedger } from "../../src/t3/tasks/launch-identity";

test("launch size error names the ledger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-launch-wording-"));
  try {
    const path = join(dir, "ledger.json");
    await writeFile(path, Buffer.alloc(64 * 1024 + 1));
    await expect(new T3LaunchIdentityLedger(path).reserve("intent")).rejects.toThrow(
      "T3 launch identity ledger is too large",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
