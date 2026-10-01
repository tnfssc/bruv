/** Receipt checks shared by focused tests and the actual binary runner. Fail closed. */
import assert from "node:assert/strict";
export function completedCommands(state: any, kind: string): any[] {
  assert(state && typeof state.commands === "object", "missing typed command ledger");
  return Object.entries(state.commands)
    .filter(([, v]: any) => v.command?.kind === kind && v.receipt?.state === "completed")
    .map(([id, v]: any) => ({ id, ...v }));
}
export function questionsFromReceipt(state: any): any[] {
  const last = completedCommands(state, "questions.list").at(-1);
  assert(last, "no completed normal questions facet");
  const result = last.receipt.result;
  const rows = Array.isArray(result) ? result : result?.questions;
  assert(Array.isArray(rows), "invalid normal questions facet");
  return rows;
}
export function assertQuestion(q: any, text: string) {
  assert(q, "missing saved human question");
  assert.equal(q.text, text);
  assert.equal(q.status, "pending");
  assert(q.id && q.owner?.sessionId && q.owner?.branchId, "missing question identity");
  assert(Number.isInteger(q.version), "missing question version");
}
export function assertSameRoot(before: any, after: any) {
  for (const key of ["sessionId", "ownerId", "epoch", "repoPath"])
    assert.equal(after.intent?.[key], before.intent?.[key], "root reattach changed " + key);
  assert.equal(after.requestId, before.requestId, "root create identity changed");
  assert.equal(after.record?.sessionFile, before.record?.sessionFile, "server journal changed");
  assert.equal(after.intent.role, "root");
  assert.equal(after.intent.depth, 0);
  assert.equal(after.source?.snapshot, before.source?.snapshot, "reattach recaptured source");
}
export function assertSnapshot(state: any, head: string, selected: string[]) {
  const s = state.source;
  assert(s, "default source snapshot absent");
  assert.equal(s.head, head);
  assert.notEqual(s.snapshot, head);
  assert.deepEqual(s.selectedUntracked, selected);
  assert(s.omittedUntracked.includes("never-upload.txt"));
  assert.equal(s.omittedUntracked.includes("authorized.txt"), !selected.includes("authorized.txt"));
  assert.equal(s.source?.kind, "current-tracked");
  assert.equal(s.source?.history, "orphan-baseline");
  assert.equal(s.source?.matchesCurrent, true);
  assert.equal(state.intent.role, "root");
  assert.equal(state.intent.depth, 0);
}
export function assertOnePrompt(state: any, text: string) {
  const matches = Object.values(state.commands).filter(
    (v: any) => v.command?.kind === "prompt" && v.command.text === text,
  ) as any[];
  assert.equal(matches.length, 1, "prompt duplicated or missing: " + text);
  assert.equal(matches[0].receipt.state, "completed");
}
export function assertWorkOnce(rows: any[]) {
  assert.equal(rows.length, 4, "missing or duplicated remote work");
  for (const phase of ["root-start", "child-start", "root-answer", "root-second"])
    assert.equal(rows.filter((r) => r.phase === phase).length, 1, "phase replay: " + phase);
  for (const r of rows.filter((r) => r.phase !== "child-start")) {
    assert.equal(r.role, "root");
    assert.equal(r.depth, 0);
  }
  const child = rows.find((r) => r.phase === "child-start");
  assert.equal(child.role, "normal");
  assert.equal(child.depth, 1);
  assert.notEqual(child.cwd, rows.find((r) => r.phase === "root-start").cwd, "child did not use worktree");
}

export function assertReplyRecovered(state: any, request: any, requests: any[], work: any[]) {
  assert.equal(request.op, "command");
  assert.equal(request.command.kind, "prompt");
  assertOnePrompt(state, request.command.text);
  const saved = state.commands[request.commandId];
  assert(saved, "reconcile changed command identity");
  assert.deepEqual(saved.command, request.command);
  assert.equal(saved.receipt.commandId, request.commandId);
  assert.equal(saved.receipt.error, undefined);
  const sends = requests.filter(r => r.op === "command" && r.command?.text === request.command.text);
  assert.equal(sends.length, 1, "lost prompt resent");
  assert.equal(sends[0].commandId, request.commandId);
  assert(requests.some(r => r.op === "command-status" && r.commandId === request.commandId), "no status reconciliation");
  assert.equal(work.length, 1, "missing/duplicated lost-reply execution");
  assert.equal(work[0].role, "root");
  assert.equal(work[0].depth, 0);
  assert.equal(work[0].cwd, state.intent.repoPath);
}
export function assertCancelledJob(state: any, id: string, result: any) {
  const stop = completedCommands(state, "jobs.stop");
  assert.equal(stop.length, 1, "missing/duplicated cancellation");
  assert.equal(stop[0].command.id, id, "cancelled wrong job");
  assert.equal(stop[0].receipt.error, undefined, "cancellation failed");
  assert.equal(result.id, id, "inspected wrong cancelled job");
  assert(["cancelled", "canceled", "stopped", "failed"].includes(result.status), "job not terminal after cancellation");
  // A completed receipt/stop request alone is not evidence that its process exited.
}
