import { strict as assert } from "node:assert";
const [port, token] = process.argv.slice(2);
const base = "http://127.0.0.1:" + port;
async function request(path: string, method = "GET", body?: unknown, key = token) {
  const r = await fetch(base + path, {
    method,
    headers: { authorization: "Bearer " + key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function until(check: (s: any) => boolean) {
  let last: any;
  for (let i = 0; i < 200; i++) {
    try {
      last = await request("/status");
      if (check(last.data)) return last.data;
    } catch {}
    await Bun.sleep(100);
  }
  throw Error(
    "timed out: " +
      JSON.stringify({
        questions: last?.data?.questions,
        journal: last?.data?.journal,
        turns: last?.data?.turns,
        contexts: last?.data?.contexts,
        error: last?.data?.error,
        events: last?.data?.events?.slice(-8),
      }),
  );
}
assert.equal((await request("/status", "GET", undefined, "wrong-token")).status, 401);
await until((s) => !!s);
assert.equal((await request("/start", "POST")).status, 200);
const pending = await until(
  (s) => s.questions?.[0]?.blocked && s.events.filter((e: any) => e.type === "agent_end").length === 1,
);
const q = pending.questions[0];
assert.equal(q.status, "pending");
assert.equal(q.blocked.checkpoint, "Await explicit fixture answer");
assert.equal(pending.turns, 2);
assert.ok(q.owner.sessionId && q.owner.branchId);
assert.equal(q.version, 2);
// No client polls for 350ms. The question must remain on disk independently of the client.
await Bun.sleep(350);
const offline = await request("/status");
assert.deepEqual(offline.data.questions[0], q);
assert.equal(offline.data.turns, 2);
assert.equal((await request("/answer", "POST", { id: q.id, choice: "B" })).status, 409);
assert.equal((await request("/answer", "POST", { id: "unknown", choice: "A" })).status, 409);
assert.equal((await request("/answer", "POST", { id: q.id, choice: "A" }, "wrong-token")).status, 401);
assert.equal((await request("/answer", "POST", { id: q.id, choice: "A" })).status, 200);
const outcome = await until(
  (s) =>
    (s.questions?.[0]?.delivery === "delivered" && s.turns === 4 &&
      s.events.filter((e: any) => e.type === "agent_end").length === 2) ||
    s.events.some((e: any) => e.ui?.message === "Question not found for owner branch"),
);
if (outcome.questions[0].status === "pending") {
  assert.equal(outcome.turns, 2);
  assert.equal(outcome.events.filter((e: any) => e.type === "agent_end").length, 1);
  assert.equal(outcome.questions[0].id, q.id);
  assert.equal(outcome.questions[0].version, q.version);
  const anchor = q.owner.branchId,
    branch = outcome.journal;
  assert.ok(branch.some((e: any) => e.id === anchor));
  const children = branch.filter((e: any) => e.parentId === anchor);
  assert.equal(children[0].customType, "die-diagnostic");
  assert.equal(children[1].role, "toolResult");
  console.log(
    JSON.stringify({
      result:
        "BLOCKED: RPC command returned success but warning Question not found for owner branch; durable question remains pending",
      pending: { id: q.id, owner: q.owner, version: q.version },
      modelTurns: outcome.turns,
      journal: branch,
      error: outcome.error,
    }),
  );
  if (process.env.REQUIRE_NATIVE_ANSWER === "1") throw Error("native question answer remains blocked");
  process.exit(0);
}
const done = outcome;
const saved = done.questions[0];
assert.equal(saved.status, "answered");
assert.equal(saved.answer, "A");
assert.equal(saved.answeredFrom, "cli");
assert.equal(saved.replyVersion, q.version);
assert.match(saved.replyId, /^reply_/);
assert.deepEqual(saved.owner, q.owner);
assert.equal(done.turns, 4);
assert.ok(done.journal.some((e: any) => e.type === "custom_message" && e.customType === "question-answer"));
assert.equal(done.contexts[2].hasReplyId, true);
assert.equal((await request("/answer", "POST", { id: q.id, choice: "A" })).status, 200);
await Bun.sleep(250);
const repeat = (await request("/status")).data;
assert.equal(repeat.turns, 4);
assert.equal(repeat.questions[0].replyId, saved.replyId);
assert.equal(repeat.events.filter((e: any) => e.type === "agent_end").length, 2);
assert.equal(repeat.error, "");
console.log(
  JSON.stringify({
    result: "PASS",
    pending: { id: q.id, owner: q.owner, version: q.version },
    saved: {
      version: saved.version,
      replyId: saved.replyId,
      replyVersion: saved.replyVersion,
      delivery: saved.delivery,
    },
    modelTurns: repeat.turns,
    agentEnds: 2,
    events: repeat.events.length,
    offlineMs: 350,
  }),
);
