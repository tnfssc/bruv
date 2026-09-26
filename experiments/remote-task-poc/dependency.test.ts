import { test, expect } from "bun:test";
import { checkReply, checkCapability } from "./dependency";
test("bounded idempotent explicit reply", () => {
  const r = { k: "reply" as const, questionId: "q1" as const, replyId: "r-one", answer: "yes" };
  expect(checkReply(r)).toBe("new");
  expect(checkReply(r, r)).toBe("duplicate");
  expect(checkReply({ ...r, answer: "no" }, r)).toBe("conflict");
  expect(checkReply({ ...r, answer: "x".repeat(81) })).toBe("invalid");
});
test("capability denial cannot become grant", () => {
  const denied = { k: "capability_result" as const, capabilityId: "c1" as const, responseId: "c-one", status: "denied" as const };
  expect(checkCapability(denied)).toBe("new");
  expect(checkCapability(denied, denied)).toBe("duplicate");
  expect(checkCapability({ ...denied, status: "granted", content: "secret" }, denied)).toBe("conflict");
  expect(checkCapability({ ...denied, content: "not allowed" })).toBe("invalid");
});
