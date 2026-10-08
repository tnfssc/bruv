# Compatibility / T3: ongoing structural readability

**Not complete.** 83 initial assigned files; 9 extra related/new files. Combined status counts: {"accepted-unchanged":19,"pending":34,"accepted-integrated":33,"primary-running":3,"judging":2,"pending-candidate":1}. Detailed per-file primary worktrees/branches/commits, every judge round, exact accepted hashes, proof and limits are in `compatibility-t3.json`. Counts are inventory, not readability proof. Parent owns one PR #45 and whole-repository gate. No area push/PR.

## Pickup

- Checkout: `/home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_dc14408d`; branch `bruv/whole-repo-structural-readability-compat-dc14408d`; initial commit `59413c532e6422983f611915e509e8421aa2f363`.
- At most 3 primary/rework code workers and 3 independent read-only judges. Coordinator only joins accepted coherent worker patches; no source authored here, no worker pickup notes imported.
- Continue all pending initial rows plus extras. Later changes invalidate accepted blobs; compare final tip hashes and rejudge combined/overlapping code. Retain all worker branches/worktrees and rejected attempts.
- Active/queued rows:
  - `scripts/claude-native-acceptance/history-run.mjs`: primary-running; primary task_10c1cb54; judges none active.
  - `wisdom/claude-compat/proof/native-ui-fixture/replay.mjs`: judging; primary task_1514b0b6; judges task_77d08693.
  - `tests/claude-native-acceptance-capture.test.mjs`: judging; primary task_d8e47cb7; judges task_0a84de3d.
  - `tests/claude-native-acceptance-replay-finalization.test.mjs`: primary-running; primary task_5b8a48c9; judges none active.
  - `tests/claude-native-acceptance-tap.test.mjs`: primary-running; primary task_83a97a2b; judges none active.
  - `tests/claude-native-replay.test.mjs`: pending-candidate; primary pending; judges none active.

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
- Driver round1 REJECT `task_2d4634f7` lost generated subagent final-provider evidence; fresh rework `task_23c0fcde` and round2 `task_0d4690cf` ACCEPT all4 blobs, integrated `67ca6129`. Shared integration.flushCapture remains before private deletion,optional owned observation. Actual generated setup-failure regression rejects old finalizer. Current whole-replay primary candidate has its own fresh judge; related acceptance is not whole-file primary.
- New/related source under `wisdom/claude-compat/proof/native-ui-fixture/replay.mjs` is real source and has an extra primary obligation, not documentation exemption. All extras recorded.
- Older shell-judge installer observation was already fixed by parent common code; current both-entrypoint inherited-override regression passed (`task_73304664`,2 tests12 assertions). No local cross-area source edit.

## Common integration and proof

Parent accepted checkpoint `0072ad15` merged cleanly at `99405881`; accepted area hashes all unchanged. Imported other-area code/notes remain parent-owned. Post-merge repository `tsc --noEmit` passed; 17-file compatibility/T3 regression passed164 tests766 assertions with7 SDK skips. More recent per-patch checks in ledger; do not sum overlapping tests as unique coverage. Combined CLI/arguments and task-binding/projection received separate actual-code judges; whole-test primaries remain distinct.

Projection candidate old binding fixture failed `tasks!.list()`; preserved in its judge limits. Actual final area binding/projection/event combination later passed24 tests104 assertions and typecheck. Persisted-leaf checks cannot prove no in-memory branch; source order supplies that fact. MCP slow-handler completion is not stale HTTP delivery ACK. SDK/device/provider/SSH/native-browser gaps remain honest. Parent owns full Linux/compiled gate.

## Environment and final audit

Pinned Bun1.4.2: `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin`, PATH inside quoted /bin/bash. Automatic fish setup fails but workers run. Dependencies reused read-only from `/home/tnfssc/.t3/worktrees/bruv/t3-6b8c09c6/node_modules`; area generates its own runtime-assets. Temporary dependency link must be removed for final clean-tree audit if untracked. Latest boundary had130GiB free; check future boundaries, don't delete retained worker worktrees. Final audit must reconcile exact baseline83 + extras, unique fresh primary per file, all rounds/accepted final blobs, real combined checks and note text safety.


## Latest checkpoint

- All52 accepted final blobs matched area working tree at current boundary. 34 initial rows remain unstarted; not an area completion claim.
- Interrupted history-model judge and tap/history-run primaries retained with no verdict/candidate; replacements tracked. No stopped attempt counted as acceptance.
- One paired build (`task_a4378da6`, source batch67ca6129) succeeded. Explicit compiled connector suite (`task_12ac2f75`) passes3 cases154 assertions using paired artifacts; real normal child dispatch + local fixture provider. Earlier unconfigured3 skips retained. Compiled/web/launcher/composition batch12 pass3 skips54 assertions. No external-provider/browser/full-gate claim.
- Tap has one byte-forward/framing owner; independently reproduced split UTF8 evidence corruption repaired without changing forwarded bytes. EOF partial lines still not synthesized into records. Whole new test primary remains active.
