import { expect, test } from "bun:test";
import { allowedAnswer, allowedScopedAnswer } from "./policy";
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

test('integrated answer requires exact observed native owner and version, including rejected stale revision',()=>{
 const q={id:'q',status:'pending',owner:{sessionId:'s',branchId:'b'},version:2};
 const input={id:'q',choice:'A',identity:'owner',epoch:1,owner:q.owner,version:2};
 expect(allowedScopedAnswer(input,q,false,'owner',1)).toBe(true);
 for(const bad of [{...input,identity:'restart'},{...input,epoch:2},{...input,version:1},{...input,owner:{sessionId:'s',branchId:'other'}},{...input,extra:true}])expect(allowedScopedAnswer(bad,q,false,'owner',1)).toBe(false);
 expect(allowedScopedAnswer(input,{...q,version:3},false,'owner',1)).toBe(false);
 expect(allowedScopedAnswer(input,q,true,'owner',1)).toBe(false);
});
