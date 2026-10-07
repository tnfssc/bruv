import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { profiles } from "../scripts/resource-harness/run";

test("shared Linux release gate runs both resource profiles and retains their artifacts", () => {
  const gate = readFileSync(new URL("../scripts/ci.sh", import.meta.url), "utf8");
  expect(gate).toContain('bun run perf:resources --profile ci --out "$log_dir/resources"');
  expect(gate).toContain('bun run perf:resources --profile stress --out "$log_dir/resources"');
  expect(gate.indexOf("Long task history resource budget")).toBeLessThan(gate.indexOf("Build paired Bruv binaries"));
});

test("stress budgets stop well before the incident's 100k entries and 13.6 GiB RSS", () => {
  expect(profiles.stress.tasks * profiles.stress.updates).toBeGreaterThanOrEqual(100_000);
  expect(profiles.stress.budgets.journalEntries).toBeLessThan(100_000);
  expect(profiles.stress.budgets.rssBytes).toBeLessThanOrEqual(512 * 1024 * 1024);
});
