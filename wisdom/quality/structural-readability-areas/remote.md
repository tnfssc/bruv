# Remote structural readability

ONGOING: 8/119 baseline files accepted at exact recorded blobs; 2 extra/new files require separate coverage. No area completion, PR or whole-repo claim.

Retained area: /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_cbb4da74
Branch: bruv/whole-repo-structural-readability-remote-cbb4da74
Initial area commit: 59413c532e6422983f611915e509e8421aa2f363. Durable per-file primary/judge/candidate/path/branch/hash records: remote.json. At most 3 active primary/rework workers and 3 judges; fill slots on results, yield otherwise. All source changes via workers; pickup notes excluded from integration.

## Accepted reading results
- src/remote/artifacts.ts: ACCEPT — File cache verification/download/atomic replacement now separate from incomplete manifest/progress/completion orchestration; all protocol and identity checks retained.
- src/remote/cancellation.ts: ACCEPT — Timed request, complete output-capturing scan and bounded settlement wait now own separate lifetimes; handler shows request/abort/inspection/publication. Checkpoint remains distinct from owner-confirmed child exit.
- src/remote/capabilities.ts: NO CHANGE NEEDED — Single bounded-read operation: filesystem confinement separated from caller permission, descriptor immediately try/finally owned, reply persistence/replay/cancellation separated.
- src/remote/jobs.ts: ACCEPT — Explicit resolved launch request removes mutable parameter/closure ownership reconstruction. Approval gate, allowlisted trusted snapshot, retained unknown dispatch and raced cancellation remain visible.
- src/remote/repository.ts: ACCEPT — History-free snapshot construction now owns patch/copy/tree validation/orphan HEAD; capture retains authorization/provenance/stability/publication. Collection/integration remain coherent.
- src/remote/root-runtime.ts: NO CHANGE NEEDED — Shared session context and serial ordering distinct from per-connection framing; question service owns answer replay, runtime owns continuation; close settlement distinct from owner exit; acknowledged rejection distinct from unknown delivery.
- src/remote/root-store.ts: ACCEPT — Database directly selects queued commands and settles unresolved receipts; append separates durable dialog lifetime from sequence/event/suffix retention. SQL adds reading cost but removes mutable pruning reconstruction.
- src/remote/security.ts: NO CHANGE NEEDED — Pure per-component sensitive path policy is explicit; capture/export and capability callers own refusal and independent grant/traversal checks.

## Integration and pending coverage
Accepted source commits: 4b0fa831 repository, 10db7d76 jobs+approval regression, 0ba0f32a artifacts+tests, 7a209eac cancellation+new test, d60db7e7 root-store+new test. Exact whole patches joined, no related edits dropped.

New tests/remote-cancellation.test.ts has its own primary running. New tests/root-store.test.ts is pending primary; parent should retain remote ownership for this newly added root-* file (not seed inventory). Existing tests/remote-artifacts.test.ts and tests/remote-source-approval.test.ts require fresh focus coverage despite related acceptance. Source-approval candidate re-edits approval tests from integrated jobs base; final blob must replace earlier related acceptance only after judgment. No other cross-area source edits, no deletions.

## Combined proof
- 4b0fa831: 19 pass, 0 fail, 112 assertions (task_66ad8475).
- 10db7d76: 54 pass, 0 fail, 321 assertions (task_963e98d8).
- 10db7d76: check=0 format=0 lint=0; 12 existing warnings/12 infos (task_ac0c70e2).
- 7a209eac: 20 pass, 0 fail, 119 assertions (task_d112ceca).
- d60db7e7: 53 pass, 0 fail, 302 assertions (task_d21d8e50).

Check is configured assets+tsc; format/lint scoped changed files. No per-file binary build. Dependency symlink in area is untracked tooling; remove before final clean-tree audit. Automatic fish setup cannot find Bun; explicit Bun 1.4.2/shared dependencies work. Early judges had package-loading gaps; area combined reruns above are real checks, not inferred. No authenticated SSH/provider/macOS/compiled CLI parity or performance claims.

## Pickup
Read ledger for active task IDs and retained worktrees. Next free primaries should cover root-owner.ts, services.ts, source-approval/artifact tests and both new tests alongside remaining 119-file baseline. Check parent accepted branch only at sensible batches; last inspected parent changes were documentation-only. Parent owns one PR #45 and final whole-repo gates.

Approval batch: a200ff7d accepted by task_72f3d841. Pin source, durable question attachment and provenance/CLI decision acceptance now explicit phases. Full combined test retains prior jobs owner regression. Final approval-test blob 975c3601 replaces earlier related acceptance, own primary next. Worker 45 tests/267 assertions; judge 11 tests/57 assertions plus dependency-loading failures, area rerun due.

Client batch: 4b540816 accepted by task_f7fa308f. Full sync lifetime now visible across locked transport/accept/save and unlocked services; whole-page acceptance owns validation and snapshot/reply reconciliation. Related client tests retained; own primary due. Integrated source-approval suites pass 45/267.

New root-store test now has fresh primary task_1dae7d84 and independent task_7ef7eb4e ACCEPT at b1f3cc8f7b18c1aa5d3a8895324792e7cfec59d8. Explicit observation oracle replaces a duplicate pruning algorithm; baseline and candidate each 7/63. New cancellation test independently accepted, but integration typecheck found TS2769 partial fixture context; fresh rework task_f9d2ba8e is active and static gate remains failed until resolved.

Owner batch: c2fc7873 independently ACCEPT by task_b276db50, including compatibility with current cancellation/artifacts/client contracts. Resource-owning journal makes fsync/sequence/lifetime explicit; child release, persistence drain, journal close and terminal publication unchanged. Related lifecycle tests need primary focus. Judge runtime package loading failed; dependency-ready area rerun required.

Root-owner batch: 770c112f accepted by task_e77399ef. Pending close evidence replaces four local fields; requestClose exposes fencing/settlement/end, actual clean exit remains necessary for publication. Includes cross-area tests/root-owner.test.ts blob 0990a29347df87831dd11c544bdcac94e85ee798, assigned execution-tasks-questions: parent must reconcile its primary and independently judge final combined code. No area-complete claim while this obligation remains.

Test-primary batch: artifact tests task_2b562570 ACCEPT at 1d819e29 (37/37 baseline static assertions retained; 11 tests/60 expectations). Approval tests task_f56506f5 ACCEPT at df9e4dfb (89/89 launch-base and 74/74 initial expressions retained). Both replace earlier related-only acceptance with genuine fresh-primary judgments; separate fixture lifetimes remove reconstruction rather than reduce test coverage.

Cancellation test rework e58f7fee accepted by fresh task_7be6f9c9 at a1a198779b4e9cf1bd48b7459e3e0c3b0adcb901. Observed TS2769 was identity assertion overload, not event emit; toBe<typeof ctx>(ctx) preserves runtime identity and all assertions. Judge reproduced old failure, new focused strict TS and 4/20 pass. Full area check rerun required.

Services batch d9db2f5f accepted by task_662f378f: delivery persistence/replay/authority separated from result collection; need wait no longer hides removal/execution. Related capability-runtime tests bbe2ee62 need own focus coverage; active capability-runtime worker knows candidate overlap. Current ClientCapabilityStore is stateless between calls, confirmed before join.
