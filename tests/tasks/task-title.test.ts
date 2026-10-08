import { expect, test } from "bun:test";
import { launchTaskTitle } from "../../src/tasks/task-title";

test("launch names prefer explicit metadata and use a bounded literal prompt preview when absent", () => {
  expect(launchTaskTitle("Review guide", "Different prompt")).toBe("Review guide");
  expect(launchTaskTitle("  ", "Review\n the guide\u001b[31m\u001b[0m")).toBe("Review the guide");
  const preview = launchTaskTitle(undefined, "Inspect renderer " + "x".repeat(200));
  expect(preview).toHaveLength(120);
  expect(preview).toStartWith("Inspect renderer ");
  expect(preview).toEndWith("…");
  expect(launchTaskTitle(undefined, undefined)).toBe("");
});
