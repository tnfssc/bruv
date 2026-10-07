# Fix task history growth and real startup

User asked to fix the OOM after the measurement harness was built. The failed thread had an 11,884,666,735-byte journal. Its process reached about 13.6 GiB RSS and was killed. See [incident](readability-thread-oom-2026-10-07.md) and [harness](task-history-resource-harness.md).

Integration checkout: /home/tnfssc/.bruv/worktrees/bruv-task-history-resource-fix. Branch: fix/task-history-resource-growth. Base: e02e754b, including the harness. PR base is origin/develop. Final Linux gate passed. Delivery is next; no production install has been done. The old completed harness checkout and original history stay unchanged.

## What was wrong

Task updates repeatedly saved the whole growing child-ID cursor. Reopen indexed discarded payloads. Restore and several startup readers then loaded the whole branch again. A bounded message cache did not bound these callers. SDK model-context preparation also parsed plain custom records that cannot produce model messages. Testing one reader missed the next one.

## What changed

- Compact task checkpoints use append-only child byte offsets. No-op projected state is not saved again. Legacy IDs migrate through a reference to their original checkpoint, not another copied array. Child readers skip malformed complete rows and advance offsets; incomplete tails retry. Truncation behind a cursor fails.
- Native child writers keep identity/hash indexes, reuse writers and suppress durable replay. They do not retain message bodies.
- Disk indexing validates bytes while selecting only resident metadata. Task metadata shares root/job keys and the common custom type. Root-key JSON is made once per root, not twice per old row. Originals remain on disk.
- Active-branch metadata walks do not copy the whole branch or allocate a branch-sized ID set. The resident row count bounds cycles; broken links fail. Task restore loads only the latest cursor per job.
- Installed startup readers select cache, task rows, identity, mode, goals and remote state before reading originals. Latest malformed authority still blocks; it never revives an older setting. Cache restore keeps each model's greatest valid timestamp since the newest shake.
- SDK startup, routing, context, previews, estimators and compaction use indexed model/settings selections. The host adaptations are hash guarded. Plain task checkpoints are never model-context bodies. Edits, shake, compaction boundaries and inactive branches remain covered. See [model-context fix](task-history-model-context.md).
- Compaction's shake carry-forward reads only the latest original marker. It preserves IDs and rejects malformed latest state.

## Harness and budgets

Portable ci/stress profiles keep their original RSS, disk, entry-count and time caps. Stress still makes 100,000 task updates. It grows child originals for 128 rounds, then replays the saved history through the remaining rounds. Keeping 100,000 required original + native child messages exceeded the old whole-fixture disk cap even after amplification was removed; deleting those would be data loss. The explicit child-updates option separates legitimate new transcripts from repeated checkpoints.

The corrected workload still fails base e02e754b: 64.08 MiB fixture bytes, 15,052 root rows, 343.3 MiB RSS, 22.8 s. Local report: artifacts/negative-control-7Mcqbo/report.json. Fixed stress in the first full gate used 145.1 MiB / 10.96 MiB / 1,652 rows for write and 107.3 MiB / 11.07 MiB / 1,702 rows for fresh-process resume. Final gate reruns both profiles.

Captured replay uses a private CoW copy, never a writable original. Existing bytes and rows are input, not new growth. The 512 MiB RSS, 64 MiB new-write and 90 s limits stay enforced. It restores old owner-keyed task bindings, creates the actual native runtime in a private home, runs installed startup handlers, prepares model context and tears down. Provider stream calls throw. After binding restore, a body-read assertion forbids old task checkpoint originals during startup. Stages are recorded separately. It does not send a prompt, verify real provider access or revive original live jobs.

## Evidence

- Source captured acceptance: all 634,329 rows; complete native startup + model context; 478.5 MiB peak RSS; 31.48 s. Local private report: artifacts/resource-harness/captured-uFAV0c/report.json.
- Compiled version of the same replay: complete native startup + model context; 404.6 MiB peak RSS; 34.19 s. Local private report: artifacts/compiled-native-acceptance-btbmZh/report.json. The compiled helper is an input program outside the measured fixture; all runtime-created files stay inside it.
- Earlier binding-only acceptance at 505.5 MiB did not prove full startup. Source and compiled probes without the final body-read/stage oracle tripped during startup. A GC probe did not solve that budget failure; no production GC workaround or cap increase was added. Reports remain under artifacts for honest comparison.
- Read-only review task_60e93484 found missing startup readers and malformed child-tail recovery. Both were fixed. Follow-up task_f2d07069 found no must-fix issues in joined startup/model-context, shake or key indexing. Its limit was no full-scale original replay; parent ran the guarded acceptance above.
- Worker startup checks: 223 tests. Context worker checks: 159 tests, build, typecheck and pristine-cache installation. Parent isolated huge-history/SDK/child-tail checks: 19 pass; SDK exactly 0.3.276.

The first full Linux gate exposed this host's fish startup injecting mise trust errors into shell-test output. Those job-bridge tests pass with SHELL=/bin/bash. Two CI-runner tests needed the new resource commands and log-dir paths. A loaded compile probe timeout passed isolated. The joined gate then reached 2,282 passing tests and one stale fast-setting read-count assertion: newest-first validation correctly stops at a malformed authoritative marker. The assertion now expects only that marker, or marker then older setting when its identity is a well-formed different scope. The billing/dispatch validation assertions are unchanged. Final gate task_2dd3127a passed: format, lint, typecheck, both resource profiles, paired build, offline OpenAI transport, 2,283 tests (23 live tests skipped, zero failures), and standalone paired smoke. Logs: /tmp/bruv-fix-green-linux-ci.log and artifacts/ci.

## Runtime setup

New SDK adaptations require pristine SDK files before prepare:assets. Existing old-adapted files fail the hash guards. Parent removed only this checkout's node_modules, installed the frozen lockfile with a fresh private cache, then prepared assets. New adapters are idempotent thereafter. Use pinned Bun 1.4.2 and Node 24.21.0 under ~/.local/share/mise/installs on this host. mise setup fails here because the worktree config is not trusted.

Final gate command uses SHELL=/bin/bash, pinned Bun/Node plus /usr/bin:/bin, BRUV_REQUIRE_CLAUDE_SDK=1 and BRUV_CLAUDE_SDK_PATH=/home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_73c863fc/artifacts/pinned-sdk/package/sdk.mjs. The SDK is a test-only input, not a new product dependency.

Private real journals, snapshots and reports must not be committed or uploaded. Do not run a real original through an unguarded SDK API. Keep reports when a run fails; a completed shell wrapper is not workload success. No production install or server restart has been done.

## Worker provenance

- task_73c863fc: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_73c863fc; branch bruv/fix-native-task-checkpoint-growth-73c863fc; integrated as 1dbc526b.
- task_b1e2df5b: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_b1e2df5b; branch bruv/fix-oversized-session-reopen-b1e2df5b; integrated as a40d06fa.
- task_53c2b0a8: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_53c2b0a8; branch bruv/bound-real-session-startup-history-reade-53c2b0a8; de7407b5 integrated as ee53052b.
- task_3f7976d4: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_3f7976d4; branch bruv/bound-model-context-restore-of-checkpoin-3f7976d4; 0fed4f72 integrated as bd756bda.

Values: strengthened the existing bounded-resource value with write-growth plus real reopen/startup tests. The lesson applies to saved or growing work, not every small stateless helper. No new value was added.

## Next

Commit code + notes + values, inspect clean status, push fix/task-history-resource-growth, open/link PR against develop. Do not claim deployment or live provider continuation. Keep this note frozen after delivery; release facts belong with the next release task.
