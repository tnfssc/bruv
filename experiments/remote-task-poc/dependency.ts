export type Reply = { k: "reply"; questionId: "q1"; replyId: string; answer: string };
export type CapabilityResult = {
  k: "capability_result";
  capabilityId: "c1";
  responseId: string;
  status: "granted" | "denied";
  content?: string;
};
export function checkReply(input: any, old?: Reply): "new" | "duplicate" | "invalid" | "conflict" {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !["questionId", "replyId", "answer"].includes(k)) ||
    typeof input.replyId !== "string" ||
    input.questionId !== "q1" ||
    !/^r-[a-z0-9-]{1,32}$/.test(input.replyId) ||
    typeof input.answer !== "string" ||
    !/^[a-zA-Z0-9 -]{1,80}$/.test(input.answer)
  )
    return "invalid";
  if (!old) return "new";
  return old.replyId === input.replyId && old.answer === input.answer ? "duplicate" : "conflict";
}
export function checkCapability(input: any, old?: CapabilityResult): "new" | "duplicate" | "invalid" | "conflict" {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !["capabilityId", "responseId", "status", "content"].includes(k)) ||
    typeof input.responseId !== "string" ||
    input.capabilityId !== "c1" ||
    !/^c-[a-z0-9-]{1,32}$/.test(input.responseId) ||
    (input.status !== "granted" && input.status !== "denied") ||
    (input.status === "granted"
      ? typeof input.content !== "string" || !/^[a-zA-Z0-9 \n-]{1,256}$/.test(input.content)
      : input.content !== undefined)
  )
    return "invalid";
  if (!old) return "new";
  return old.responseId === input.responseId && old.status === input.status && old.content === input.content
    ? "duplicate"
    : "conflict";
}
