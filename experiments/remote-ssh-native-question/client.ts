import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const [command, port, token, dir] = Bun.argv.slice(2);
const url = "http://127.0.0.1:" + port;
const file = dir + "/transcript.json";
async function request(path: string, method = "GET", body?: object, key = token) {
  const response = await fetch(url + path, { method, headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(1500) });
  return { status: response.status, data: response.ok ? await response.json() : await response.text() };
}
async function status() { const r = await request("/status"); assert.equal(r.status, 200); return r.data; }
async function until(predicate: (s: any) => boolean) {
  for (let i = 0; i < 120; i++) { const s = await status(); if (predicate(s)) return s; await Bun.sleep(70); }
  throw Error("timed out waiting for native question state");
}
async function saved() { return JSON.parse(await readFile(file, "utf8")); }
async function persist(s: any, q: any) { await writeFile(file, JSON.stringify({ pending: q, latest: s })); }
const ends = (s: any) => s.events.filter((e: any) => e.type === "agent_end").length;
if (command === "status") { await status(); }
else if (command === "start") { assert.equal((await request("/start", "POST")).status, 200); }
else if (command === "pending") {
  const s = await until((x) => x.questions?.[0]?.blocked && ends(x) === 1);
  const q = s.questions[0];
  assert.equal(q.status, "pending"); assert.equal(q.version, 2); assert.equal(q.blocked.checkpoint, "Await explicit fixture answer");
  assert.ok(q.owner.sessionId && q.owner.branchId); assert.equal(s.turns, 2);
  await persist(s, q);
} else if (command === "reconnect") {
  const old = await saved(), s = await status();
  assert.deepEqual(s.questions[0], old.pending); assert.equal(s.turns, 2); assert.equal(ends(s), 1);
  await persist(s, old.pending);
} else if (command === "answer") {
  const { pending: q } = await saved();
  assert.equal((await request("/status", "GET", undefined, "wrong-token")).status, 401);
  assert.equal((await request("/answer", "POST", { id: "wrong", choice: "A" })).status, 409);
  assert.equal((await request("/answer", "POST", { id: q.id, choice: "B" })).status, 409);
  assert.equal((await request("/answer", "POST", { id: q.id, choice: "A" })).status, 200);
} else if (command === "done") {
  const old = await saved();
  const s = await until((x) => x.questions?.[0]?.delivery === "delivered" && x.turns === 4 && ends(x) === 2);
  const q = s.questions[0];
  assert.equal(q.status, "answered"); assert.equal(q.answer, "A"); assert.equal(q.answeredFrom, "cli");
  assert.equal(q.replyVersion, old.pending.version); assert.match(q.replyId, /^reply_/); assert.deepEqual(q.owner, old.pending.owner);
  assert.ok(s.journal.some((e: any) => e.type === "custom_message" && e.customType === "question-answer"));
  assert.equal(s.contexts[2].hasReplyId, true); assert.equal(s.error, "");
  await persist(s, old.pending);
} else if (command === "duplicate") {
  const old = await saved();
  // Controller permits exact idempotent repeats; the native RPC must not start a second turn.
  assert.equal((await request("/answer", "POST", { id: old.pending.id, choice: "A" })).status, 200);
  await Bun.sleep(250);
  const s = await status();
  assert.equal(s.turns, 4); assert.equal(ends(s), 2); assert.equal(s.questions[0].replyId, old.latest.questions[0].replyId);
  await persist(s, old.pending);
} else if (command === "offline") {
  // No fetch: read ONLY the client's cached copy after both server containers stop.
  const { pending, latest: s } = await saved();
  assert.equal(pending.status, "pending"); assert.equal(s.questions[0].status, "answered");
  assert.equal(s.turns, 4); assert.equal(ends(s), 2);
  assert.ok(s.events.some((e: any) => e.type === "message_end"));
  assert.ok(s.events.some((e: any) => e.type === "tool_execution_end" && !e.isError));
  assert.ok(JSON.stringify(s.events).includes("SAVED ANSWER OBSERVED"), "offline final assistant text missing");
  console.log(JSON.stringify({ question: pending.id, replyId: s.questions[0].replyId, turns: s.turns, events: s.events.length }));
} else throw Error("unknown command: " + command);
