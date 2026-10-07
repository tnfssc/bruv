# Real task-projection workload child

The supervisor/CLI owns process isolation, resource limits, reports and cleanup.
This child only creates offline fixtures, measures them, and leaves them intact.

Small example (two separate processes):

```sh
d=$(mktemp -d)
bun scripts/resource-harness/workload.ts --dir "$d" --tasks 2 --updates 4 --child-entries 3 --phase write
bun scripts/resource-harness/workload.ts --dir "$d" --tasks 2 --updates 4 --child-entries 3 --phase resume
```

Use an isolated directory. Write refuses an existing `fixture.json`. Resume requires
matching counts and opens the paths/identities saved there. No original journal is
truncated, compacted, rewritten or deleted. The caller decides when to remove fixtures.

## Parameters and JSONL protocol

- `--tasks`: positive number of synthetic running worker jobs.
- `--updates`: nonnegative update rounds, one event per task per round.
- `--child-entries`: nonnegative new Pi messages **per task per round**. Each child
  also starts with one user seed, so it ends with `1 + updates * child-entries` messages.
- `--phase write|resume`: resume must be a new process for a cold-reopen measurement.

Stdout contains only `sample` rows and a single final `complete` row:
`{type,phase,step,rssBytes,heapUsedBytes,journalBytes,journalEntries,elapsedMs}`.
Errors go to stderr with a nonzero exit and no completion row.

`journalBytes` and `journalEntries` describe the **root Pi checkpoint journal**, not
aggregate fixture disk usage. Entries include the JSONL session header. Measurement
uses the disk-backed metadata index and stat; it does not materialize history.
Step 0 is the pre-open baseline (journal metrics 0: no journal attached yet), step 1
is the created/reopened root, step 2 is flushed binding attachment. Write rounds
use step `2 + round`. At most 20 round samples are emitted, not one per event.
Completion is after binding closes and before manager disposal. Elapsed time starts
at main entry (SDK imports precede it); heap is `process.memoryUsage().heapUsed`.
No forced GC, peak-memory claim, or cross-machine RSS/time threshold.

## Fidelity and limits

Real code paths:

- Production `installDiskBackedSessionManager` with persistent root and child Pi
  journals; the seed user publishes each journal via the real SDK append lifecycle.
- Real `bindNativeTasks`: clone/serialize each cursor into
  `bruv-native-task-projection`, tail complete child records from a bounded byte-offset
  cursor, translate new messages, and restore only latest keyed checkpoints through
  `visitDiskBackedBranch` (metadata skeleton fallback: `getDiskBackedBranch`).
- Text-only user/assistant translation (including assistant usage), and the real
  `NativeHistory.child().append()` write path used by `runtime.ts` for derived
  sidechains. The workload does not cache writers beyond production's behavior.
- Cold root reopen and binding attachment with the same fixture task roster. This
  appends one fresh checkpoint per task without duplicating child transcript rows.

Only job events/process evidence are fake. No processes are actually launched as
workers; fake PIDs do not refer to work. The fake roster is supplied again on resume
**to exercise cursor restore**, not to claim production recreates jobs on restart.
Wire frames are discarded rather than retained in an artificial transport backlog.
No API calls, models, auth files, user histories, SDK AgentSession/model continuations,
completion delivery, compaction, tool results, images, or UI rendering are exercised.
Interrupted fixture initialization is not a recoverable session workflow.

## Growth oracle (bounded byte-offset cursors)

With T tasks and U update rounds, the root contains a header, launch user and C
checkpoints: `2 + C` rows, with `T <= C <= T * (U + 1)` in the focused workload.
Launch/background/terminal boundaries save immediately, progress saves every 64
observations, and close drains dirty cursors. Each new checkpoint stores the last
complete child byte offset and usage totals, not an accumulated child-ID vector.
Child reads use 64 KiB chunks; keyed root restore materializes only latest matching
checkpoints, not all root messages or superseded checkpoint bodies.

Resume adds T root checkpoint rows; original root bytes remain an exact prefix,
and original child Pi/native sidechain bytes remain unchanged. Tests verify final
child offsets, absence of new childEntries arrays, preserved original content and
no duplicate derived transcript rows. Root checkpoint payloads no longer grow
quadratically with the child transcript. Original/derived child journals and
body-free indexes still grow with history; this is not retention or a promise of
flat total RSS/disk usage.

Focused checks: `bun test tests/resource-harness-workload.test.ts`.
Task evidence/limits: [wisdom note](../../wisdom/resources/resource-harness-workload.md).

## Stable-history stress

--child-updates N grows the child transcript only during the first N update rounds. The default is --updates. Later updates still traverse the real binding, checkpoint, and child-tail code. Standard stress uses 50 tasks, 2,000 update rounds, one child entry per growing round, and 128 growing rounds. Original and derived transcripts remain intact.

The fake manager now returns shallow public summaries like TaskManager; it no longer deep-clones all launch fields on every roster read. This avoids measuring a fake-only allocation cost.
