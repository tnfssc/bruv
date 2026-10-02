# Feature-preserving cleanup — complete

Implemented on branch **bruv/feature-preserving-code-reduction**. No feature or archive cuts. No version bump, push or release.

Baseline: d80d7058a2f5481f067586fd7042fe2746cff4ae. Tested code commit: 7fbab062ae6700c96bc20304b8bb3babe4ed3405. Later commits contain only these records.

## Actual reduction

**1,963 fewer tracked code/config/test lines across 143 files**: 3,295 added, 5,258 removed. Wisdom and audit documents are excluded. The canonical web patch is counted once as its maintained representation; generated upstream source is not counted again. [Raw totals](implementation-counts.json).

| Area | Net change |
|---|---:|
| Runtime and native source | −1,282 |
| Scripts and workflow wiring | −700 |
| Maintained web integration | −260 |
| Tests | +279 |
| Total | **−1,963** |

An earlier progress count omitted four rows from truncated command output and reported 1,978. These final numbers use the complete file-backed Git numstat output and agree with Git's shortstat.

## What changed

- Removed the unused captured-context compaction builder. Useful assertions now call the shipped handler. Removed inert wisdom job notifications, redundant state/wrappers and fixture-only question shapes. Real compaction, fast mode, goals, questions and wisdom guidance stay.
- Shared task launch construction, settlement, timer and UI rendering mechanics. Preserved inherit/worktree ownership, cancellation, quiet/full views and all existing UI features. Used Bun's JSONC parser instead of two hand-written passes; invalid unterminated comments and comma-only arrays are now rejected, not silently repaired.
- Removed unused volatile remote capabilities; tests now exercise the durable implementation. Shared fixed-entrypoint SSH transport, equivalent durable writes and bounded result downloading. Kept grants, confinement, root placement, legacy human workflows, source approvals, replay and safe integration.
- Removed obsolete Live companion internals, orphan transcript grouping and write-only state. Kept all providers, commands, speaker/mic checks, waveform, onboarding and audio behavior. Shared queued backend-turn mechanics. Fixed a privacy/teardown assertion that inspected the wrong test fixture.
- Shared the actual execute declaration with setup diagnostics through a small pure module. Probes no longer need to import the runtime or generated assets just to get the schema; they still deny execution.
- Removed deterministic launch-ID sidecar writes and their inert ACK listener. Existing pending mappings, including old prefixes, remain readable. The actual execute ACK protocol remains.
- Made the tested web delegation policy the real Effect-native production owner. Removed proven dead helpers, shared small fixture pieces and moved all nine delivery scenarios into one existing suite. Both CI and release still select that suite.
- Shared isolated Docker/SSH, loopback RPC, intercepted study and exact video-renderer mechanics. Kept every study/capture/acceptance entrypoint and scenario. Shared small terminal-test helpers and isolated history process runners; fixed shell-quote drift rather than dropping cases.

## Validation

**Full Linux gate passed**: scripts/ci.sh linux, including locked install, formatting, lint, root and producer typechecks, complete compiled build, offline default OpenAI loopback, maintained web suites, complete root suite and standalone smoke. Lint has existing warnings; zero exit is not a zero-warning claim.

- Root: **1,718 passed, 20 intentional opt-in skips, 0 failed**, 32,896 assertions across 238 files.
- Web: **645 passed**: backend 292, model behavior 158, contracts 24, client projection 8, cache 126, terminal recovery 37.
- Actual rebuilt CLI SSH child placement passed: snapshot/provenance, destination role/profile, nested child/worktree, ordinary questions, restart identity, result return and drift review.
- Actual rebuilt CLI SSH root placement passed: thin local client, persistent server root, detach/reopen, questions/jobs pickers, server child/worktree, snapshots, safe close return, explicit inclusion/drift, no cumulative replay, real lost-reply reconciliation and running shell-job cancellation.
- Native Linux/core waveform/sanitizer, protocol/backpressure and compiled OpenAI loopback checks passed in the Live worktree. Exact commands and scoped worker test counts are in the implementation wisdom notes. Do not add overlapping focused suites to the complete-gate total.
- Two independent reviews found no actionable feature-preservation regression: [core/execution/test infrastructure](implementation-reviews/review-core-execution.md), [Live/remote/web/tooling](implementation-reviews/review-remaining.md). These were static/source reviews, not additional runtime acceptance.

Tested binary SHA-256: c817fbf5d840fe8000cd55cc135d5fdddc80844bbe94a994729c329d47d3ba52. Build source: pinned upstream 66a91077f9abf6e171aad0ceab2519d7272f3ff3 plus the regenerated canonical patch.

Main logs: artifacts/code-reduction-implementation/combined-ci.log and artifacts/ci/. Current-binary SSH receipts: /home/tnfssc/.bruv/code-reduction-acceptance-Gvw78p/{child-final,root-final}; final logs in artifacts/code-reduction-implementation/. No private keys or real credentials are in those receipts. No fixture containers remained after completion.

## Failures handled honestly

The first full run hit ENOSPC during standalone web extraction: /tmp was 98% full. The identical gate passed with private disk-backed TMPDIR; no code or assertion changed. Original log is combined-ci-first.log. The first SSH launches lacked Docker on the restricted validation PATH and failed before containers started; corrected-path runs passed.

A remote implementation worker stopped making tool progress while receiving a model response. Parent stopped that worker, preserved its durable worktree, reviewed the patch, ran fresh checks (251 pass / 3 opt-in skips), committed and integrated it. No unfinished source was discarded.

## Still needs care

- macOS Swift/helper compilation, real audio/acoustics and paid provider acceptance were not run. Existing features and checks remain.
- Root acceptance does not prove owner-process crash recovery or aborting an actively streaming root turn; those differ from lost replies and cancelling a shell job.
- A legacy question-PTY marker guard failure and an extra MCP cancelled-versus-interrupted assertion were reproduced on original code. They were not weakened or claimed fixed.
- The unused web cancellation semaphore is retained pending a separate ownership/correctness investigation. Its comments promise a boundary; deleting it would not prove that boundary exists.
- Release-inventory deduplication, negligible native sine-test consolidation and SSH fixture-file staging consolidation were deferred rather than changing gate/workflow semantics for small savings. No generalized SDK/TUI fixture framework or test-coverage cuts were added.
- Full frozen-video recapture lacked the original captures/receipt. Both extracted renderer samples were pixel-identical and decoded; that is not a full product-demo claim.

## Temporary storage follow-up

User also asked to clean /tmp. Removed inactive temporary pnpm/dependency caches after active-use checks, not source or evidence. Reclaimed about **6 GB**: 98% to 59% used, 6.4 GB free. No mount-size/system cleanup-policy changes. Keep large caches/worktrees on disk and keep per-run cleanup; do not bulk-delete /tmp. See [temporary-storage wisdom](../../../wisdom/quality/temporary-storage.md).

## Handoff

[Implementation ownership, commits, worktrees and remaining care](../../../wisdom/quality/code-reduction-implementation.md). All implementation and review jobs are finished. Durable worktrees/branches remain available. Existing value 7 was clarified during the audit about tests preserving obsolete implementations; implementation and storage work fit the existing ownership, proof and resource values, so no extra values were added.
