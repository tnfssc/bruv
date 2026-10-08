import { expect, test } from "bun:test";
import { parseOptions } from "../../scripts/terminal-perf/options.js";
test("performance CLI defaults and numeric options", () => {
  expect(parseOptions([])).toMatchObject({ budgetMs: 8, scales: [100, 500, 1000], strict: false });
  expect(
    parseOptions([
      "--samples",
      "3",
      "--warmup",
      "0",
      "--scales",
      "10,10,20",
      "--case",
      "input",
      "--case",
      "resize",
      "--strict",
    ]),
  ).toMatchObject({ samples: 3, warmup: 0, scales: [10, 20], cases: ["input", "resize"], strict: true });
  expect(parseOptions(["--budget", "0.5"]).budgetMs).toBe(0.5);
});
test("invalid performance CLI options fail instead of quietly running a different benchmark", () => {
  for (const args of [
    ["--samples", "0"],
    ["--warmup", "-1"],
    ["--samples", "1.5"],
    ["--scales", "1,"],
    ["--budget", "NaN"],
    ["--case"],
    ["--oops"],
  ]) {
    expect(() => parseOptions(args)).toThrow();
  }
});
