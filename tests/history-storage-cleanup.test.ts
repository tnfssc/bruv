import { expect, test } from "bun:test";
import { createHistoryFixture, runHistoryProcess } from "./history-process";

test("temporary preparation and failed factories leave no live-process pending journals", async () => {
  const root = await createHistoryFixture("bruv-history-cleanup-");
  const { stdout, stderr, code } = await runHistoryProcess(root, ["tests/history-storage-cleanup.probe.mjs"]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout.trim()).toBe("ok");
});
