import { eventDecision } from "./bounded-log";
import { test, expect } from "bun:test";
test("reserve outcome slot and cap complete JSON envelope", () => {
  expect(eventDecision(158, 20000)).toBeNull();
  expect(eventDecision(159, 1)).toContain("count");
  expect(eventDecision(0, 20001)).toContain("byte");
});
