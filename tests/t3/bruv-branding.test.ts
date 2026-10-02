import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

test("canonical T3 patch uses Bruv services while retaining upstream Effect APIs", async () => {
  const patch = await Bun.file(resolve(root, "integrations/t3/upstream/bruv.patch")).text();
  expect(await Bun.file(resolve(root, "integrations/t3/upstream/die.patch")).exists()).toBe(false);
  expect(patch).toContain("class BruvTaskService");
  expect(patch).toContain('"bruv_task_launch"');
  expect(patch).toContain('"BRUV_WEB_BRUV_BINARY"');
  // Upstream API calls no longer have to appear in the maintained delta.
  expect(patch).not.toContain("diff --git a/apps/server/src/orchestration-v2/NativeUsageAccounting.ts");
  expect(patch).not.toContain("diff --git a/apps/server/src/orchestration-v2/Adapters/PiRpc.ts");
  expect(patch).not.toContain("the token must bruv");
  expect(patch).not.toMatch(/(?:Effect|Layer)\.orBruv|(?:Cause|Stream)\.bruv|Cause\.isBruvReason/);
  const additions = patch
    .split("\n")
    .filter((line) => line.startsWith("+"))
    .join("\n");
  expect(additions).not.toMatch(/DIE_|Die(?:Task|Web|Delegation)|die_(?:task|local_job)/);
});
