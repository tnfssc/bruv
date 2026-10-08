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

test("missing Git provenance is explicit and does not discard measurements", async () => {
  const source = new URL("../scripts/resource-harness/provenance.ts", import.meta.url).pathname;
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      "import {sourceProvenance} from " + JSON.stringify(source) + ";console.log(JSON.stringify(sourceProvenance()));",
    ],
    { env: { ...process.env, PATH: "/__bruv_test_no_git__" }, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.revision).toBeNull();
  expect(result.dirty).toBeNull();
  expect(result.provenanceError).toContain("git");
});
