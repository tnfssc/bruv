# Remote line pass

Worktree: /home/tnfssc/.bruv/worktrees/t3-6c093fbb-5442693331ce-task_b773b826
Branch: bruv/prompt-lines-remote-b773b826

Read values, the clutter guide, and system.md first. This checkout has no wisdom.md.

## Coverage

475 model-facing emitted-line variants. Each got its own fast read-only worker. 34 rewritten; 441 kept. Shared strings and conditional branches count as separate variants, not separate edits.

484 lines launched and answered in all. Nine extra rows were later excluded as human-only command/status text or interpolation source. 131 rate-limited workers needed retries: 615 jobs total. No worker edited files. No review waits remain.

.tmp/prompt-line-review/remote/manifest.json and per-line JSON files keep originals, context, send paths, job IDs, proposals, decisions, and final text. coverage.json gives counts. Two malformed JSON answers are kept as source expressions, not claimed as parsed JSON.

## Paths and choices

Traced remote helpers and SSH jobs through client/owner RPC, repository/capability state, execute results, cached summaries, and completion notices. remoteExtension sends renderHuman prose through pi.sendMessage. Saved replies also use pi.sendMessage. Internal root facets, menus, UI status, command descriptions, SQL, docs, and dynamic data are outside the model-facing pass. Published errors from human commands still enter message history.

Kept short factual errors. Cut formal phrasing from notices. Saved replies now state delivery facts: new parent turn, no replay, no native-child resume. Human-owned authority, exact command names, read-only scope, cached status, cancel uncertainty, and same-ID retries stay intact. Nine source syntax trees retain their structure, identifiers, numbers, and regex.

## Tests and gaps

139 focused tests pass across eight files. The final /questions answer wording also passed all nine observation tests. Updated wording assertions; added a hidden follow-up/idempotent saved-reply test. git diff --check passes.

The broad remote suite is not claimed green. /tmp was full (ENOSPC). A worktree TMPDIR rerun then hit old wording assertions and five-second filesystem timeouts. Fixed the assertions; final focused runs used --timeout 30000. Logs stay with the line evidence. No behavior checks were weakened.
