import { expect, test } from "bun:test";
import { allowedAnswer } from "./policy";
const q = { id: "q_real", status: "pending" };
test("controller permits only explicit exact pending choice or idempotent answered retry", () => {
  expect(allowedAnswer({ id: q.id, choice: "A" }, q, false)).toBe(true);
  expect(allowedAnswer({ id: q.id, choice: "A" }, q, true)).toBe(false);
  expect(allowedAnswer({ id: q.id, choice: "A" }, { ...q, status: "answered" }, true)).toBe(true);
  for (const input of [{ id: q.id, choice: "B" }, { id: "other", choice: "A" },
    { id: q.id, choice: "A", extra: "ignored" }, null, [q.id, "A"]])
    expect(allowedAnswer(input, q, false)).toBe(false);
  expect(allowedAnswer({ id: q.id, choice: "A" }, undefined, false)).toBe(false);
});
