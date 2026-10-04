import { test, expect } from "bun:test";
import { checkReply, checkCapability } from "./dependency";
test("bounded idempotent explicit reply", () => {
  const r = { k: "reply" as const, questionId: "q1" as const, replyId: "r-one", answer: "yes" };
  const { k, ...request } = r;
  expect(checkReply(request)).toBe("new");
  expect(checkReply(request, r)).toBe("duplicate");
  expect(checkReply({ ...request, answer: "no" }, r)).toBe("conflict");
  expect(checkReply({ ...request, answer: "x".repeat(81) })).toBe("invalid");
});
test("capability denial cannot become grant", () => {
  const denied = {
    k: "capability_result" as const,
    capabilityId: "c1" as const,
    responseId: "c-one",
    status: "denied" as const,
  };
  const { k, ...request } = denied;
  expect(checkCapability(request)).toBe("new");
  expect(checkCapability(request, denied)).toBe("duplicate");
  expect(checkCapability({ ...request, status: "granted", content: "secret" }, denied)).toBe("conflict");
  expect(checkCapability({ ...request, content: "not allowed" })).toBe("invalid");
});

test("typed replies reject record injection and coercible IDs", () => {
  expect(checkReply({ questionId: "q1", replyId: ["r-one"], answer: "Label" })).toBe("invalid");
  expect(checkCapability({ capabilityId: "c1", responseId: "c-one", status: "denied", k: "other-record" })).toBe(
    "invalid",
  );
  expect(checkCapability({ capabilityId: "c1", responseId: ["c-one"], status: "denied" })).toBe("invalid");
});
