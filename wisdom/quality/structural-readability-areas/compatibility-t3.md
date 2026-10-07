# Compatibility / T3: ongoing structural readability

**Not complete.** 83 initial assigned files; current status counts: {"accepted-unchanged":15,"pending":37,"judging":3,"rework-running":1,"accepted-integrated":26,"primary-running":1}. 6 extra related/new files tracked separately. Detailed per-file primary worktrees/branches/commits, every judge round, exact accepted hashes, proof and limits are in `compatibility-t3.json`. Counts are inventory, not readability proof. Parent owns one PR #45 and whole-repository gate. No area push/PR.

## Pickup

- Checkout: `/home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_dc14408d`; branch `bruv/whole-repo-structural-readability-compat-dc14408d`; initial commit `59413c532e6422983f611915e509e8421aa2f363`.
- At most 3 primary/rework code workers and 3 independent read-only judges. Coordinator only joins accepted coherent worker patches; no source authored here, no worker pickup notes imported.
- Continue all pending initial rows plus extras. Later changes invalidate accepted blobs; compare final tip hashes and rejudge combined/overlapping code. Retain all worker branches/worktrees and rejected attempts.
- Primary/rework/judge running or queued rows:
  - `scripts/claude-native-acceptance/app-delegation-model.mjs`: judging; primary task_00f0a474.
  - `scripts/claude-native-acceptance/driver.mjs`: rework-running; primary task_ffc92537; rework task_23c0fcde.
  - `scripts/claude-native-acceptance/history-model.mjs`: judging; primary task_0af35abe.
  - `scripts/claude-native-acceptance/subagent-model.mjs`: judging; primary task_5996dfa6.
  - `scripts/claude-native-acceptance/tap.mjs`: primary-running; primary task_ce9e9c06.
  - `tests/claude-native-acceptance-runner.test.mjs`: primary-running; primary task_23190128.
  - `wisdom/claude-compat/proof/native-ui-fixture/replay.mjs`: pending-candidate; primary not launched.
  - `tests/claude-native-acceptance-capture.test.mjs`: pending-candidate; primary not launched.

## Accepted structural work (exact proof in ledger)

- Runtime history mirroring now owns ordered append/UUID parenting/sticky failure; shared message body conversion preserves thinking policy and JSON replay property order.
- T3 MCP complete POST exchange and single owned handshake remove split response/reconnect lifetime; adapter ambiguity replay remains distinct from transport 404 retry. Local durable notifications retain disk authority, bounded retry, matching ACK, supersession and cancellation while removing redundant cache.
- CLI has one teardown wait then exit choice; explicit baseline-reproduced duplicate diagnostic fix preserves independent operation/cleanup failures. Arguments no longer carry unread verbose/strictMcp switches, while both protocol flags and validation remain.
- Commands separate input authority from effects and own extension-notification completion. Frontend replaces run accounting independently of persistent delivery. Human-controls bind subscription/dialog/version state to captured command authority; replacement rejects stale answers, interrupt retains ownership.
- History selects graph before translation and keeps source UUID beside each converted message. Storage binding visibly distinguishes bound reopen, native import and fresh canonical creation.
- Transport framing is bounded and separate from dispatch/drain lifetime. Task binding owns registration/Agent delivery guards, while projection has explicit checkpoint outcomes and pure wire shapes.
- Whole-file test refactors remove misleading fixture authorities/lifetimes, hidden start operations, parallel arrays and timing-as-readiness where observed. They retain behavioral assertions; important test limits stay explicit.
- Main acceptance model separates evidence-only correlation and readable generated authority programs; independently reproduced async sequence attribution fixed. Runner proof publication can no longer skip model/gate/scoped cleanup; baseline leak independently reproduced, unrelated PID preserved. Offline tests are not native/provider acceptance.

## Rejections and open integration needs

- Arguments initial no-change REJECT `task_c9ec06dd` resolved by fresh worker `task_565d6984` and fresh judge `task_e06dc5c8`; original attempt retained.
- Driver capture ownership candidate REJECT `task_2d4634f7`: shared replay migration skipped subagent `flushCapture` and lost final-provider evidence before private deletion. Entire candidate unintegrated; fresh rework `task_23c0fcde` must preserve owned observation and test actual generated caller finalization. Partial blob acceptance is not integration permission.
- New/related source under `wisdom/claude-compat/proof/native-ui-fixture/replay.mjs` is real source and has an extra primary obligation, not documentation exemption. All extras recorded.
- Older shell-judge installer observation was already fixed by parent common code; current both-entrypoint inherited-override regression passed (`task_73304664`,2 tests12 assertions). No local cross-area source edit.

## Common integration and proof

Parent accepted checkpoint `0072ad15` merged cleanly at `99405881`; accepted area hashes all unchanged. Imported other-area code/notes remain parent-owned. Post-merge repository `tsc --noEmit` passed; 17-file compatibility/T3 regression passed164 tests766 assertions with7 SDK skips. More recent per-patch checks in ledger; do not sum overlapping tests as unique coverage. Combined CLI/arguments and task-binding/projection received separate actual-code judges; whole-test primaries remain distinct.

Projection candidate old binding fixture failed `tasks!.list()`; preserved in its judge limits. Actual final area binding/projection/event combination later passed24 tests104 assertions and typecheck. Persisted-leaf checks cannot prove no in-memory branch; source order supplies that fact. MCP slow-handler completion is not stale HTTP delivery ACK. SDK/device/provider/SSH/native-browser gaps remain honest. Parent owns full Linux/compiled gate.

## Environment and final audit

Pinned Bun1.4.2: `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin`, PATH inside quoted /bin/bash. Automatic fish setup fails but workers run. Dependencies reused read-only from `/home/tnfssc/.t3/worktrees/bruv/t3-6b8c09c6/node_modules`; area generates its own runtime-assets. Temporary dependency link must be removed for final clean-tree audit if untracked. Latest boundary had130GiB free; check future boundaries, don't delete retained worker worktrees. Final audit must reconcile exact baseline83 + extras, unique fresh primary per file, all rounds/accepted final blobs, real combined checks and note text safety.
