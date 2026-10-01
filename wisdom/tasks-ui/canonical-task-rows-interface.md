# Canonical typed background task rows

## Authority and workspace

Implements final approvals in the full ui-discussion-checkpoint.md (authoritative discussion worktree task_6b26afdc) and parent agreed-compact-actions.md. Later approvals supersede the draft and early checked launch rows. Base 7627cdc on origin/develop bada7e5.

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_77080c99-a86675007a5e-task_a9b2e181
Branch: die/canonical-background-task-rows-and-typed-a9b2e181.

## Integration interface

src/ui/task-rows.ts exports TaskRow, taskRowKey, taskRowFromLaunch, taskRowFromRemote, taskRowsFromDetails, taskRowsFromSessionEntries, upsertTaskRow, formatTaskRow, taskRowColor, taskSummaryRowsFromDetails.

TaskRow fields: id; source(local/native/ssh); title?; status(running/succeeded/failed/cancelled/unknown/needs-input); terminal; exitCode?; timedOut?; sourceCallId?. Identity is source+actual ID, never title/source/prose. A typed native launch input can supply its explicit title when the native response omits that field. Unknown SSH done does not mean success. Confirmed cancellation wins over ordinary process exit143; actual timeout remains failure. Terminal facts survive stale running/unknown snapshots while late launch metadata can fill title/call ownership.

src/typescript/extension.ts captures every actual background:true shell/subagent response, including real batch results, into result.details.taskRows. Existing backgroundJobs and expanded details stay. The die:task-row-launch bus delivers row plus sessionId immediately; agent extension persists custom entry die-task-row before outer execute can fail. Local manager lifecycle events update those entries through the existing typed subscription. No agent prose parsing, guessed child count, scheduler/delivery change or backend coordinator.

src/remote/root-runtime.ts dispatchRootFacet(snapshot) now includes facet.taskRows projected from current-branch die-task-row entries. Root presenter can replace sourceCallId's launch action with these canonical rows, upsert by taskRowKey, and suppress subsequent notices. This also preserves ownership for an execute that throws and therefore has no normal result details. Parent/root received scratch coordination files; do not commit those files.

src/ui/sdk-task-rows.ts adapts actual Pi ToolExecutionComponent/CustomMessageComponent transcript projections. Each typed launch owns its rows; an orphan owns its first typed notice. Later completion snapshots update that original owner and hide duplicate collapsed notices. Reopen derives from persisted typed tool/custom details plus branch entries, with no backend state mutation. Previously active rows become unknown until refreshed. Native image children, handoff progress, ordinary assistant prose, useful outer execute failures, and all expanded rendering remain. Adapter restores only its own wrappers and does not hold removed components alive.

completionPreview uses shared format helpers. Default rows are static ↗ title, ✓ title, ✗ title — exit N/failed/timed out, ⊘ title — cancelled, or ? title — status unknown/needs your input. Only actual exit and timeout fields drive reasons. Quiet/review/N more checks are hidden from human transcript only. Capped outcome counts use actual typed outcomes, distinguishing timeout from cancellation. Expanded checkpoint/output evidence, footer and all unrelated UI are unchanged.

## Proof

Pinned Bun 1.4.2, SHELL=/bin/sh, TMPDIR=/home/tnfssc/.die/tmp-pi-removal; cached node_modules link is read-only. No dependency modification, provider/real-host/network work, build publication or release.

- 103 passed, 0 failed, 501 assertions across tests/task-rows.test.ts, tests/execution-previews.test.ts, tests/subagent-extension.test.ts, tests/root-runtime.test.ts, tests/conversation-density.test.ts.
- Three task-related action-label-wiring tests passed (10 assertions); one pre-existing foreground action expectation was filtered because its … executing wording conflicts with this rebased draft and belongs to foreground worker.
- New checks use real Pi components and real local shell manager events. Durable launch-before-outer-error regression mocks only isolated execution while invoking actual typed job helper/manager; terminal ID, exit1 and sourceCallId are persisted. SDK image check exercises actual native kitty image children.
- bun run check and git diff --check passed. Parent owns final combined gate and native compiled PTY proof. These component tests are not a screenshot/interactive acceptance claim.

Feature wisdom updated here. values.md stays unchanged: existing honest UI, one-owner, durable work and bounded proof values already cover this work.
