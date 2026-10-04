# Socket error after an answer — 2026-10-04

User showed a Provider error after the setup thread's last reply. They then
said the thread had not completed. Do not assume a shutdown-only warning.

Thread: 690fcb73-bb00-4908-8622-181a9ee5c813. First run is failed. A second
run was already active when inspected; this investigation did not start it.
At 17:07:53.484Z the connector emitted result error_during_execution with
"The socket connection was closed unexpectedly"; idle followed at .486Z.
The final answer had arrived just before it. This is a structured failure,
not just a stray UI card.

Native session:
~/.bruv/agent/native-sessions/2026-10-04T15-33-18-618Z_01a1078c-509a-76bc-9393-c96bd51d41ad.jsonl.
Provider log:
~/.t3/userdata/logs/provider/events.690fcb73-bb00-4908-8622-181a9ee5c813.log.
Read JSON fields selectively. Do not copy opaque reasoning or auth blobs.

Native assistant errors occurred at 16:05:14 (Codex request error), 16:27:46
(WebSocket 1011 keepalive timeout), 16:44:14 and 17:00:31 (socket closed).
The last saved provider error predates the last answer by about seven minutes.
Check whether a recovered retry left stale error state in the connector.
That is a lead, not yet a proven cause. Do not conflate this with the
[cleanup timeout](provider-end-cleanup-timeout.md) fix.

Research worker task_a2f3010c is tracing retry/error ownership. It shares the
current workspace, makes no edits, and must not mutate active sessions or
call paid APIs. Parent workspace: /home/tnfssc/.t3/worktrees/bruv/t3code-c110da8b.
Next: read its result, verify the real event sequence, then decide the fix.
No product code changed yet. Values unchanged: existing honest lifecycle and
real-path proof guidance applies.

## Diagnosis and fix underway

Research confirmed stale retry failure. Native error entry 37494400 was omitted
by context_edit at 17:00:31.759Z. A successful toolUse followed at 17:00:58.273Z;
final entry 168c19e9 ended with stop and no error at 17:07:53.409Z. Frontend
retains the old failure across Pi auto_retry_end.success. Isolated replay
reproduces the bad result. This is not the cleanup timeout bug. The original
socket disconnect cause remains unknown.

Implementation task_91efa2ce owns a focused fix and regressions in:
/home/tnfssc/.bruv/worktrees/t3code-c110da8b-5442693331ce-task_91efa2ce
Branch: bruv/fix-recovered-retry-error-classification-91efa2ce.
Base: 416dfc0998b0d05ee89907960a444112d7884da8.
Keep recoverable provider error separate from terminal errors. Only clear it
on Pi retry success. Abort/interruption must survive that signal. Next: review
its commit, integrate, run focused checks. No release or installation requested.

## Integrated

Worker commit ebf6aa5ed76c8bc4cb64f429e914ceccf1cf96fd was reviewed and
cherry-picked as d39dfe35. See [retry fix](recovered-provider-retry.md) for
code boundaries and offline regression proof. Runtime forwards all Pi session
events to the frontend, including auto_retry_end. Parent reran the three
focused suites: 11 pass, 0 fail, 41 assertions. Parent bun run check passes.

Worker accidentally used process.execPath (installed Bruv) as a Bun test runner.
That made four model requests despite the no-provider-call instruction; recorded
estimate $0.091182, not billing proof. Parent told the user. Offline validation
was rerun with the explicit Bun executable in both checkouts. No active-session
mutation. Never use process.execPath to infer Bun in a compiled Bruv process.

No install, PR, release, full-suite or live-provider acceptance. Existing failed
turn records remain failed. Running providers still use their loaded code. The
underlying disconnect cause remains unknown; this fix corrects recovered-error
classification only. Product implementation is done locally. Ship separately
if requested. Values unchanged: existing ownership and real-path proof rules
cover the fix; the runner detail stays with this feature.
