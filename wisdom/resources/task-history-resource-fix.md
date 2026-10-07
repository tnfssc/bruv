# Fix task history growth and reopen

New task after the harness was finished. The old harness checkout stays unchanged.

Integration checkout: /home/tnfssc/.bruv/worktrees/bruv-task-history-resource-fix. Branch: fix/task-history-resource-growth.
Base: e02e754b. It includes the harness commits, not yet pushed.

Worker task_73c863fc owns task binding and its direct tests. Checkout: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_73c863fc. Branch: bruv/fix-native-task-checkpoint-growth-73c863fc.
Worker task_b1e2df5b owns disk history indexing, metadata APIs, and history search limits. Checkout: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_b1e2df5b. Branch: bruv/fix-oversized-session-reopen-b1e2df5b.
Parent owns integration, the derived NativeHistory writer hot path if needed, workload acceptance, and delivery.

## Why

[Harness evidence](task-history-resource-harness.md) showed two distinct failures. Existing giant history fails during indexing. New task updates append whole growing cursor snapshots. Restore also materializes the whole branch. A bounded old-message body cache does not fix these callers.

Keep original history and identities. Do not truncate the failed journal or merely raise resource budgets. Test fresh sessions and the actual stopped session copy. Workloads must preserve delivery, replay deduplication, branch selection, and causal task IDs.

## Checks planned

Small resource profile, long offline profile, guarded captured-session replay, focused history/connector tests, full CI where it matters. Do not call a metadata-only replay full model continuation. The source snapshot contains private history; never commit or upload it.

Runtime setup may fail on this machine because mise cannot bootstrap the unrelated pnpm asset. Pinned Bun 1.4.2 and Node 24.21.0 binaries exist under ~/.local/share/mise/installs. Parent installed locked dependencies and prepared assets in both worker checkouts through those binaries.

Values are unchanged so far. Existing bounded-resource, original-history safety, and whole-path checks already apply. Update this note while integrating pieces, before the final commit or PR.

## Integration checkpoint

Task binding worker also edits derived NativeHistory and added a child-tail reader; parent will not race those files. Its proposed restore path needs EntryMetadata.taskProjection = { rootKey, jobId }, where rootKey is JSON.stringify([namespace, sourceSessionId, sessionId]). The history worker did not yet have that field when parent inspected. Parent will join this contract after both commits arrive.

Parent added tests/task-checkpoint-index-contract.test.ts. It creates 400 old checkpoints in an isolated process, checks task keys survive reopen, and checks restore materializes only two latest task cursors rather than the branch. It is red on the base code because metadata has no taskProjection key yet. This is integration work, not a shipped red test.

Both workers remain running. No production changes are merged into the integration checkout yet. Original stopped-session snapshot stays in the completed harness checkout. Do not mutate that checkout or original history.

## Harness correction, not a relaxed cap

The task worker measured stress at 64.02 MiB total fixture disk, 290.5 MiB RSS, and only 902 root rows after 62.7 s. Compact checkpoints removed the amplification. The old workload also generated 100,000 real child messages and their required SDK copies; those valid originals exceed the 64 MiB whole-fixture cap linearly. Treating required transcripts as a checkpoint leak would demand data loss.

Parent kept every budget unchanged. The stress workload now grows each child for 128 rounds, then replays that same saved history through the remaining 2,000 update rounds. It still delivers 100,000 task updates, but only 6,400 new child messages. This directly exercises repeated projection/checkpoint writes without burying the oracle in legitimate new transcript bytes. The actual 11.9 GB captured journal remains the primary old-session reopen check. New --child-updates makes this workload distinction explicit in command, fixture, and report; default remains growth on every update for standalone workload callers.

The corrected stable-history stress still catches old code: a bounded negative control against e02e754b stopped at 64.08 MiB fixture bytes, 15,052 root rows, 343.3 MiB RSS, after 22.8 s. Evidence: artifacts/negative-control-7Mcqbo/report.json. The fixed task worker completed the same update count under the unchanged caps: write 162.1 MiB RSS / 11.05 MiB disk / 1,652 rows; resume 123.7 MiB / 11.17 MiB / 1,702 rows. Report: artifacts/resource-harness/stress-H7OiuW/report.json. Write took 86.2 s on the loaded local host. Parent is replacing FakeJobs deep-cloned roster snapshots with the same shallow public summaries used by TaskManager; this cuts harness-only cloning, not production work or assertions.

A local PATH problem caused completed measurements to be discarded when Git provenance lookup threw. Reports now record an explicit provenanceError with null revision/dirty if Git is absent. Normal checks use pinned Bun/Node plus system paths. Production growth caps did not change.

Parent found another real startup reader while integrating: nativeStorage checked for import maps with manager.getEntries(). That would still materialize all old task checkpoints before binding. Imported-history resume and checkpoint mapping now select only import-map metadata and load those originals. The captured replay alone does not cover this caller, so parent is adding a regression check for it.

## Joined reopen and restore

Worker commits are integrated as 1dbc526b and a40d06fa. Parent added taskProjection metadata with root/job keys for old and new checkpoints. Keys share one tiny object per root/job in each store; cursor snapshots stay on disk. Restore reads the latest keyed cursor per job on the active branch.

The first combined replay exposed another allocation: selectDiskBackedEntries copied the whole branch and built a visited-ID set twice. The inline metadata run indexed all 634,329 rows but hit 528.7 MiB during restore. Parent added visitDiskBackedBranch, a newest-first metadata walk with no branch copy. The resident entry count bounds cyclic walks; missing parents fail. Task restore uses that visitor and materializes only selected cursors. Captured measurements remain under the original 512 MiB/90 s watchdog. No cap is raised.

Read-only integration review: task_60e93484. It reads this checkout, including uncommitted integration changes. No new code workspace is needed for read-only research. Final evidence and delivery are still pending.

## Review found missing real startup readers

The guarded combined replay passed: 634,329 rows, 505.5 MiB peak RSS, 48.42 s. Private report: artifacts/resource-harness/captured-9yiDr4/report.json. It exercised task-binding restore, not full extension startup. Review task_60e93484 found unconditional getBranch calls in cache-countdown and task-row session_start handlers. These still parse all checkpoint bodies in actual runtime. Parent is fixing those handlers and expanding captured replay before claiming real startup bounded.

Review also found malformed complete child rows now failed the tail reader, unlike SDK loading. Parent restored skip-and-advance semantics for malformed complete rows. Incomplete final rows remain unconsumed and retry later. No original is rewritten. Regression test follows.

## Full runtime follow-up ownership

Worker task_53c2b0a8 owns bounded agent extension startup readers and tests. Checkout: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_53c2b0a8. Branch: bruv/bound-real-session-startup-history-reade-53c2b0a8. Worker task_3f7976d4 owns SDK model-context projection and tests. Checkout: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_3f7976d4. Branch: bruv/bound-model-context-restore-of-checkpoin-3f7976d4. Both start at 019bd94b. Parent owns capture/runtime acceptance and metadata storage.

Parent found buildSessionProjection also parsed every context custom checkpoint and allocated a whole branch of estimator skeletons. That is now a separate worker fix, not a claimed pass. Expanded captured replay runs createClaudeCompatRuntime with the real installed extensions, a private home, local offline model setup, and provider-stream functions that throw. It then prepares context and checks teardown. Old task binding is restored separately first with the original owner key; the isolated native home does not revive original jobs.

The first complete Linux gate reached 2,259 passing tests, 13 failures and one error. Ten job-bridge failures were this host's fish startup printing mise trust errors into shell output. All passed when rerun with SHELL=/bin/bash. Two CI-runner assertions had not been updated for the new resource commands; parent fixes those without weakening checks. A compiled self-update probe timed out under concurrent load and passed isolated. A separate focused run had one huge-history test timeout during concurrent captured replay; it still needs an isolated pass. Resource ci/stress, format, lint, typecheck and paired build passed before those suite failures. Final full gate must rerun after integration.

The expanded actual-startup negative control stopped at 512.6 MiB after 50.76 s before the indexed metric (private captured-jaav41 report). Keyed metadata had too little RSS margin even before extensions. Parent removed the extra per-checkpoint customType slot: task metadata now has a prototype type and one shared owner-key slot. Other custom metadata retains its own type. This addresses resident index size, not cache limits or history deletion. Full expanded replay waits for the two real startup/context fixes.
