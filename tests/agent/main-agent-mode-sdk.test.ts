import { expect, test } from "bun:test";
import { createHistoryFixture, runHistoryProcess } from "../history/history-process";

// Isolate SDK imports, project discovery, and identity changes before loading the cases.
test("main-agent instruction modes through the real SDK", async () => {
  const root = await createHistoryFixture("bruv-main-mode-sdk-process-");
  const { stdout, stderr, code } = await runHistoryProcess(root, ["test", "./tests/agent/main-agent-mode-sdk.probe.ts"]);
  expect(code, stdout + stderr).toBe(0);
  expect(stdout).toContain("main-agent-mode-sdk: complete");
}, 30_000);
