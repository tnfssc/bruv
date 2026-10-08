import { expect, test } from "bun:test";
import { createHistoryFixture, runHistoryFixture } from "./helpers/history-fixture";

test("disk history retrieval traverses metadata, preserving originals, branches, refs and live exclusions", async () => {
  const fixture = createHistoryFixture("bruv-disk-retrieval-");
  const { stdout, stderr, code } = await runHistoryFixture("history-disk-retrieval.ts", fixture);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout.trim()).toBe("ok");
});
