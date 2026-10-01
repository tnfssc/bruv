# Placed-root compact transcript (2026-10-01)

Authority: full human checkpoint in task_6b26afdc, with later single-line approvals superseding early two-line/error and checked-launch proposals. Parent consolidated rules are in agreed-compact-actions.md in the integration tree. Base here is rebased draft 7627cdc on origin/develop bada7e5, not the old cc7f181 design.

## Durable root worker receipt

- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_77080c99-a86675007a5e-task_0720c30e
- Branch: die/placed-root-normal-transcript-alignment-0720c30e
- Focused code: src/remote/root-presenter.ts. Tests: tests/remote-root-presenter.test.ts.
- Normal foreground actions have one animated spinner-only row until a parsed label exists; partial labels grow without exposing code. Preparation and execution keep the same row. Tool results replace it with ✓/✗/⊘ and compact real error/output-save warning. Successful source/output remain collapsed.
- Normal background tasks use shared src/ui/task-rows.ts adapters and formatting, never model prose. Actual root_ready.facets.jobs and root_facets.jobs supply job authority; typed message details supply launch call identity and completion. One canonical row per task, with multiple-task launches and orphan tasks retained. Quiet/review notices are hidden only from the human transcript. Structured adverse omitted counts remain.
- Expanded branch remains unchanged. display:false and hidden thinking remain hidden normally; footer, /ps, /questions, source return, model/session authority and editor controls are unchanged. Animation requests rendering only for a pending action and is cleared on teardown.

## Integration seam

Background worker task_a9b2e181 owns shared task-rows.ts and lifecycle metadata. This root commit imports its current API; cherry-pick that worker before root. A matching uncommitted copy is present here solely to run root checks; it must not be committed as root-owned source.

Root also consumes typed facet.taskRows through the same established TaskRow adapter. Background worker confirmed dispatchRootFacet(snapshot) now exposes taskRowsFromSessionEntries(ctx.sessionManager.getBranch()), retaining sourceCallId before execute returns or fails. Parent must integrate that root-runtime producer together with the shared module; jobs.list alone has no call mapping. Root tests validate persisted die-task-row metadata shape with the shared helper. No guessed correlation by label/source was added.

## Checks

Cached Bun 1.4.2, read-only node_modules link to /home/tnfssc/Code/die/node_modules. Tests run with SHELL=/bin/sh and TMPDIR=/home/tnfssc/.die/tmp-pi-removal.

- bun test tests/remote-root-presenter.test.ts tests/root-runtime.test.ts tests/remote-root-client.test.ts: 29 pass, 0 fail, 158 assertions (20 root-presenter tests).
- Cases cover actual SDK message/tool event sequence, upstream parseStreamingJson incomplete labels and code-first stream, real dispatchRootFacet(snapshot) pagination, completion/reopen/cache replay, unknown/needs-input/cancelled/timeout, batch/orphan identity, compact warnings and display:false in snapshots/streaming/expanded.
- Exact expanded rendering compared to 7627cdc for success/thinking/custom notices, failure/orphan, cancellation/timeout at widths 32 and 120: all six comparisons byte-for-byte equal. Temporary comparison sources removed.
- Prepared local assets only after confirming every cached SDK patch already has before===adaptPiHostFile(before); shared dependency files were not written. tsc --noEmit passed.
- Biome format of the two focused code/test files and git diff --check passed.

These are injected event/component proofs, not native acceptance. Parent owns integrated native terminal proof. No provider, real host, push, PR, release, upload or dependency install/mutation was performed. Shell startup emitted mise untrusted-config warnings; absolute Bun checks still completed successfully.

Values unchanged: honest UI, one authority, bounded proof and durable handoff already cover this work. No new broad lesson warrants a values rewrite.
