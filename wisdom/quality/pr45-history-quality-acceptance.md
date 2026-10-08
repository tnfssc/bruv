# Exact history repair quality rejudgment

**ACCEPT — both bounded reading burdens are genuinely removed at da8daf2c00946c6583a83e349f681b0b546a41ac.** This is an independent actual-code quality judgment of R1/R2, not whole-repository certification, runtime proof, or permission to integrate/publish.

## Identity and scope

Actual reviewing model: **openai-codex/gpt-6.1-sol**, verified in this judge's native session model_change record at 2026-10-08T15:18:43.912Z (session 01a11c18-4182-7617-b4fd-9a83b4279841).

Reviewed committed blobs, also verified against working-file git hash-object output:

| File | Git blob |
| --- | --- |
| src/history/disk-entry-store.ts | 093d4cf9fe2991c7200561242cad697b6c14db5d |
| src/history/session-manager.ts | 32eb9878654e0d6f85156fb20ff7dfc50871aa2d |
| tests/history-model-context.test.ts | f50df618a4d6ee51992b1c3fcafbbecd26d4d4a9 |
| tests/history-truncated-branch.probe.ts | e74fb1a0a4742d1f7952be5ecbf6234fc7196082 |

Read the full original task_ce9abd2c quality-intent-review.md, values.md, structural-readability-guidance.md, original-intent follow-up and repair note. Reviewed the entire repair diff, actual metadata builder/registration/append/publication/cache/rescan code, manager adoption/index publication, bounded branch traversal, shipped context selection and context/projection consumers. Followed native SDK message/compaction/custom/label append ordering and native context/projection rules; inspected the fork import append caller. Read migrated malformed-branch fixtures and compaction scenario/assertions, their native comparison and opacity budget, plus retained storage fault/collision and manager-publication assertion definitions. Symbol searches checked that no removed-selector reference remains in src/tests and distinguished shipped branch-selector consumers.

This is a focused rejudgment, not a fresh full-file or whole-repo audit. I did not reread the complete unchanged retrieval service, parser, or other subsystems. service.ts remains blob 5c0a4181560c83f46f0ad876eac109c415abbb47. Their original acceptance is retained, not extended into an unperformed new review.

## R1: one real context journey

A reader entering buildContextEntries now reaches modelContextMetadata directly; buildSessionProjection reaches the same owner, materializes its selected context and attaches visible sourceEntry provenance. There is no longer another exported scope/index selector with separate compaction positioning and retained-system arithmetic to evaluate. The remaining selectDiskBackedBranchEntries owns a different, shipped job: filtering original active-branch records before loading bodies. It is not a competing context window.

The assertion migration follows those actual products. In the native and adapted scenarios, the first context entry and first projected source entry must be compaction exactly on the unknown/known/repeated branches. This directly checks checkpoint-at-index-zero instead of checking a spare implementation's callback index. The pinned native SDK still supplies an independent message/settings/usage reference; repeated-compaction projection semantics are not replaced with a self-reference.

Gap, self-cycle, multi-node-cycle and forward-link fixtures still check original branch order, each unique node, early stop and unchanged original bytes. They now also check shipped context IDs and projection provenance. Expecting only the message (or an empty context for the custom-only self-cycle) is correct: plain auxiliary custom records are intentionally absent from model context, not silently lost from original-history APIs. Native gap comparison and the 100,000-checkpoint opacity/materialization assertions remain. This is meaningful behavioral migration, not test/count proxy progress.

## R2: one prepared row, clear commit ownership

The reading journey is now append entry → write bytes and prepare one metadata record inside rollback → first-publication link if eligible → register that same record → insert/cache it → return it → publish it into the SDK view and set flushed. registerMetadata mutates the supplied record for interning/task keys; it does not reconstruct it. Rescan explicitly builds once from its compact parser and uses the same registration helper. Store entries, ID lookup and SDK skeleton publication refer to the same metadata object, with SDK byId already aliased to the store's map.

The store still owns byte failure semantics. A write, metadata preparation or first-publication link failure truncates to the saved original byte length before index registration. Failed rollback remains an AggregateError. Publication still uses a no-overwrite hard link, and redundant-spool unlink failure remains tolerated after successful publication. Registration and cache mutation stay outside that rollback region, so rollback does not pretend to undo resident bookkeeping. No memory/parser/retrieval optimization was traded away to make the diff smaller.

I checked the removed manager catch rather than accepting its removal by recommendation alone. On owned managers the override does not invoke native _appendEntry, which otherwise pushes the original, changes byId/leaf and then persists. Native append callers construct the entry using the existing leaf and invoke the override before advancing state. The owned SDK view therefore has not advanced when the store's write/link transaction fails. The old count catch did nothing in those failures and its advanced-leaf explanation was misleading.

**Exception boundary, not an absolute guarantee:** closeSync is outside the inner rollback catch; registration, cache insertion and SDK publication can also fail after bytes commit. Those boundaries already existed. Close/registration failure before entries.push would not trigger the old count recovery. A later array/map/cache allocation failure could previously trigger resync, but resync itself allocates and is not reliable all-exception atomicity. For normal SDK-produced records the inspected post-commit operations perform bookkeeping, not a second I/O publication. I found no ordinary supported failure path requiring the deleted recovery branch, and no newly introduced commit/leaf gap warranting a recovery framework. Do not describe this as every conceivable exception rolling back a completed append.

## Remaining objections and handoff

**No unresolved blocking readability or static-semantic objection to these exact blobs.** Whole-repo quality beyond this bounded scope remains with the parent and other judges. Runtime correctness, resource budgets, fault execution and integration at this tip are unverified here.

No runtime tests, workloads, install/prepare/setup retry or bypass, source edits, push, deletion, sudo, auth/secrets/provider/device or recovery operations were performed. Only this report was written. Parent retains safe validation and integration ownership. Values/guidance remain unchanged: existing actual-code judgment, single ownership and simplest-working-design principles already explain the repair.
