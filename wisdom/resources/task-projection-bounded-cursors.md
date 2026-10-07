# Task projection: append cursors, not accumulated history

Use this note with [disk-backed history](../history/disk-backed-history.md) and the [guarded resource harness](task-history-resource-harness.md).

## Observed owner bug and fix

Task binding wrote an entire growing child-entry ID vector into each root custom checkpoint, reread the complete child JSONL on each observation, and restored all root messages through getBranch(). NativeHistory.child() also opened and retained the complete derived child transcript on each frame.

The binding now stores a byte offset through the last complete delivered child record. Its direct reader tails from that offset in 64 KiB chunks, preserves UTF-8 boundaries, and retries in-flight final lines. It does not change, delete, or truncate original journals. Truncation behind an offset fails rather than inventing replay history.

Launch, background and terminal boundaries checkpoint immediately. Replayable progress checkpoints every 64 observations; close drains and saves dirty final cursors. flush still drains delivery, not every progress checkpoint. New root checkpoints contain no accumulated child ID arrays. An orderly close/reopen restores exact offsets and usage totals.

Legacy checkpoints still resume. Their latest ID vector is read once, used to skip already delivered originals while scanning the child journal, and then discarded. If that original child journal is unavailable, a small legacyCursorId points back to the unchanged old root record; new checkpoints never copy its vector. When the child returns, migration finishes against those original IDs.

NativeHistory owns one queued writer per causal child binding, cached as a promise so concurrent callers cannot create two writers. Reopen streams child records into identity/message-hash indexes; append uses those indexes and the last message UUID instead of rescanning retained message arrays. It preserves the existing native JSONL and .meta.json formats. Metadata still grows with history; this is body-free indexing, not a promise of flat total process RSS or an unlimited disk quota.

appendWithResult validates replay in that same writer queue. The runtime's task-child callback returns false for an already durable source message, so binding rebuilds usage after a stale progress checkpoint without re-emitting those child frames. Wire delivery still has an emit/checkpoint crash window for task progress/notifications; no exactly-once transport claim is made.

## Required history-owner integration

Binding uses existing selectDiskBackedEntries on the active branch twice: first to select the latest metadata per job/root, then to materialize only those checkpoints. History indexing must provide:

```ts
EntryMetadata.taskProjection?: { rootKey: string; jobId: string }
rootKey = JSON.stringify([root.namespace, root.sourceSessionId, root.sessionId])

```

Extract this key for old and new bruv-native-task-projection originals while scanning. Do not cache full custom data or childEntries vectors. Without keyed metadata, the fallback streams individual custom entries via metadata branch skeletons, avoiding unrelated root messages, but scans all old checkpoints and is not the captured-incident acceptance path. Native/in-memory SDK managers retain their explicit full-array fallback.

## Evidence and limits (2026-10-07)

Bun 1.4.2 / Node 24.21.0 pinned installed binaries were used; mise's pnpm bootstrap problem was not repaired as part of this task. The pinned Claude SDK 0.3.276 archive was downloaded and checksum verified for real filesystem/causal-history tests. Focused SDK, binding, incremental-reader and harness suites: 34 pass, zero skipped/failures. TypeScript passes; focused Biome formatting/check has only existing warning/info diagnostics.

CI profile after the fix: write 105.0 MiB RSS, 1.20 MiB fixture, 26 root rows, 825 ms; fresh resume 106.9 MiB, 1.22 MiB, 34 root rows, 573 ms. Retained report: artifacts/resource-harness/ci-BP0ZrR/report.json.

The first fixed-code stress run stopped at the unchanged whole-fixture disk cap: 351.2 MiB RSS, 64.12 MiB fixture, 902 root rows, 41.5 s (stress-ftadxV). Root history was only 2.31 MB; the remaining growth is the two required linear original/derived child transcripts. Even an exploratory removal of repeated native paths (not shipped) hit 64.08 MiB at 61 s with 1202 root rows. That experiment was reverted: no SDK format was changed to hide a failing budget.

At 100,000 stress messages, the existing exact Pi and native JSONL rows alone exceed the 64 MiB whole-fixture cap even with fixed-size sparse root cursors. Final unchanged-format stress (stress-FrYG2a/report.json) likewise stopped disk-only at 64.02 MiB, 290.5 MiB RSS, 902 root rows, 62.7 s. Parent integration must explicitly settle this harness workload/accounting mismatch without raising caps, then rerun mandatory stress. This worker does not report stress green, does not relax caps or reduce payload/workload, and did not open/copy the private 11.9 GB captured fixture. Parent owns guarded replay after history indexing integration.

Values stay unchanged: the existing measured-resource and safe-recovery values already require these checks and honest limits. No new cross-cutting rule is needed.
