# Feature-preserving code reduction

## User decision

After the full audit, user approved implementing the full feature-preserving cleanup rather than another small plan. Keep all current product features and developer workflows. No archive, diagnostic, provider, UI feature, goal, Herdr, image resize or acceptance cuts. Dead implementation and simpler shared mechanics are in scope. Do not reduce meaningful assertions just to lower the count.

Base: d80d7058a2f5481f067586fd7042fe2746cff4ae. Parent had only audit documents and the value-7 lesson uncommitted; source/tests/config were unchanged. Audit: wisdom/audits/code-reduction/2026-10-02/.

## Workers and ownership

- **core** — task_dc1457d6. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_dc1457d6. Branch: bruv/cleanup-core-dead-paths-and-duplicate-st-dc1457d6.
- **execution** — task_51494356. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_51494356. Branch: bruv/cleanup-task-execution-and-ui-duplicatio-51494356.
- **remote** — task_d625f667. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_d625f667. Branch: bruv/cleanup-remote-dead-implementation-and-s-d625f667.
- **live** — task_a3641c68. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_a3641c68. Branch: bruv/cleanup-obsolete-live-internals-without--a3641c68.
- **tooling** — task_89acff4c. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_89acff4c. Branch: bruv/reduce-tooling-harness-and-gate-duplicat-89acff4c.
- **web** — task_349462fa. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_349462fa. Branch: bruv/cleanup-maintained-web-patch-and-launch--349462fa.
- **test-infra** — task_2be69da7. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_2be69da7. Branch: bruv/deduplicate-test-plumbing-without-droppi-2be69da7.

Core owns src/agent (including shared extension.ts), session/history/questions/wisdom source. Execution owns tasks/typescript/ui. Remote owns src/remote. Live owns src/live/native plus its setup probe. Tooling owns scripts/.github/root config, excluding Live's setup probe. Web owns src/t3/integrations plus tests/t3; script gate edits must go through parent/tooling. Test infrastructure owns *-tui.test.ts, history subprocess tests and minimal shared test mechanics. Other domain tests stay with their source owner.

Each worker commits code/tests and a uniquely named implementation note in its own worktree. Parent inspects diffs, integrates commits, resolves boundary changes and runs the combined gate. Actual returned prepared worktree paths above supersede the launch-time placeholder path. Exact launch records are in artifacts/code-reduction-implementation/.

## Checks and care

Use focused tests in each worktree. Keep dependencies and upstream source owned by that worktree; no mutating shared node_modules/cache through symlinks. No paid/provider/device or release mutations. Web must use the actual pinned current source and regenerate the canonical patch; old cache revisions are not proof.

After integration: formatting, lint, typecheck, current compiled CLI, complete root tests and maintained-web gates through scripts/ci.sh linux where environment permits. Report actual failures/skips. Preserve real TUI/compiled acceptance and old pending launch identities. Do not blindly remove the unused FFI lifetime root or web cancellation semaphore. Fix the known Live assertion target typo without deleting its privacy/teardown checks.

Values already cover this work. Existing value 7 was clarified during the audit about obsolete implementations kept alive by their own tests. No new value change at launch.

Status: seven worktrees are implementing. No implementation integrated yet.

Integration branch: bruv/feature-preserving-code-reduction in /home/tnfssc/Code/bruv. Audit/constraint commit: 0ea9e61. Baseline format, lint and typecheck passed before code integration; lint already reports 741 warnings and 1,098 informational diagnostics, not a clean zero-warning baseline. Audit JSON was formatted to repository style. Worker code changes remain in separate worktrees until reviewed.

## First integration

Test infrastructure worker finished. Reviewed the 42-line TUI helper, quoting tests and representative terminal/history conversions. Integrated da5308b + 04ef117 as 149c992 + fec6262. Net code/tests -29 lines (-89 plumbing plus 60 new regression lines). Peer focused TUI/helper selection: 21 pass; history/isolation selection: 16 pass; exact commands in its note. Compiled acceptance used a copied baseline binary, not proof of the final merged runtime. Parent combined gate remains required.

Cross-owner follow-up to examine after web and execution integrate: web draft removes launch-ID sidecar writes but retains a validating no-op acknowledge() for the existing JobService call sites. Remove only the resulting dead launch-ledger ACK listener/method when both owners are complete, not the real execute delivery-ack protocol. Preserve old pending mapping reads. This is not an instruction to change worker files while they are in progress.

Execution worker completed all execution-01–08 and integrated 9ca37f6. Parent checked shared launch metadata/argv construction, terminal settlement ordering and bridge failed-reply cleanup. Peer results: 205 focused tests / 1,605 assertions, 26 baseline render comparisons, compiled JSONC fixture 3 assertions, typecheck/format/lint passed. Code/tests net -144 (production -242, tests +98). JSONC now rejects unterminated block comments and comma-only arrays that the old scanner accidentally repaired; valid JSONC stays supported. No feature cuts. Full merged CLI/TUI validation still pending.

Core integrated b95ad0e + 953aaf8. Parent reviewed captured-context builder removal, unused snapshot/header retention, normal-handler preservation and no-op wisdom wiring. Peer checks: 176 core, 25 compaction/instruction SDK, 65 question/history/goals/mode regressions, and 21 final compaction recheck passed; typecheck/format/lint passed. Code/tests net -94 (source -183, tests +89). The worktree had no compiled CLI for two separate questions tests; rerun tests/questions-bridge.test.ts and tests/questions-sdk.test.ts after merged build. No supported features/persisted formats changed.

Independent read-only core/execution/test-infra review: task_ef48e83d, pinned 8bf8cf6a7dd682b49f1a11c1a75704434195a61f. Worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_ef48e83d, branch bruv/review-integrated-core-and-execution-cle-ef48e83d. Report goes to artifacts/code-reduction-implementation/review-core-execution.md. No code edits delegated to this reviewer.

Parent preview review (not yet integrated): Live now has a small setup-probe adapter that captures the registered execute schema and always denies execution, instead of maintaining the obsolete six-tool schema. Reviewed the common queued-turn body; callers retain separate admission, dedupe and error behavior. Wait for final Live commit/check results before integration. Deferred native sine-test consolidation keeps that manual regression rather than saving a few lines at the cost of another build abstraction.

Live integrated 456e68d. Code/tests net -790 (production/native/scripts -415; obsolete tests -375). Peer offline suite: 364 passed / 3 paid skipped, plus focused 62 and 57-pass follow-ups. Native C sanitizer/waveform, Linux compile/self-test/protocol/backpressure, compiled OpenAI loopback checks passed. No paid/device proof; macOS Swift compile unavailable here. All voice features kept. One integration care point: setup-probe schema capture currently imports full execute runtime and newly requires generated assets. Parent will remove that avoidable prerequisite by giving the actual execute schema a small pure shared owner, not reintroducing a copied schema.

Parent cross-owner fix: execute schema/description now live in small asset-free src/typescript/definition.ts, used by the actual registration and Live setup probe. Removed the fake registration harness instead of imposing a new generated-assets prerequisite on setup diagnostics. Schemas are freshly materialized per caller. Added exact probe/registered-schema equality to the existing tool-schema test. Bundled setup-probe successfully with a resolver rejecting runtime-assets/Pi host/Photon/execution imports; no provider connection. Focused tool-schema/Live/execute tests passed (see schema-tests.log).

Independent static review task_ef48e83d completed: no actionable regression in pinned core/execution/test-infrastructure changes. Report: artifacts/code-reduction-implementation/review-core-execution.md. It explicitly does not replace rebuilt UI/runtime acceptance. Parent schema ownership fix committed as 5d2e1cf; 20 focused tests / 100 assertions and full root typecheck passed. The asset-free setup bundling probe also passed. Net schema integration is +5 code/test lines; this removes an avoidable setup prerequisite rather than chasing line count at the cost of a workflow.

Tooling integrated c45cf3a. Parent reviewed shared isolated Docker/SSH environment, key pinning, no-pull network-none launch and exact-owned cleanup; renderer extraction retains caller-owned provenance/assertions. Code/tests net -403 (scripts -700, tests +297). Peer 118 focused tests / 889 assertions, typecheck/format, pristine/idempotent asset prep, Python compile passed. Real child/root placement, compiled RPC and capability PTY accepted against copied baseline binary; both renderer samples pixel-identical/decoded. Question PTY /remote status guard failed and unchanged baseline reproduced it; keep this visible. Full merged current-binary remote acceptance still needed. Frozen full-video recapture lacks original assets/receipt and was not claimed.

Tooling release-inventory dedup is deferred, not implemented: it needs preservation of final packaged/Mac/log gates, and those were not proven in this worktree. No workflow or release gate was removed. All study/video/acceptance tools remain. Dependency isolation lesson: Bun installs may hardlink its cache; tooling used --backend=copyfile before private-seam rewrites/pristine checks. A separate node_modules path alone is not physical write isolation.

Remote worker task_d625f667 made no tool progress for about 16 minutes while its model response kept streaming. Parent stopped that one worker to finish the prepared patch rather than lose more time. Exit 143/killed confirmed; this was parent task management, not a user cancellation. All 19 changed/new files remain in its original durable worktree/branch. Parent now owns finishing checks, review, handoff and commit there. No source was discarded. Fresh remote/root focused checks launched in that worktree with opt-in E2E gates disabled.

All seven implementation areas are now integrated. Web commits 3c52267/1b7752e became 20d9482/efa710f. Parent inspected the Effect-native policy walk; trusted lineage, terminal/disposed checks and scoped loader behavior remain. Peer: 164 patched-server tests plus root selections and shared detector/typechecks/source verification passed. Same nine delivery scenarios retained in the merged suite. Additional MCP cancellation-status test failure was reproduced on the original patched runtime, not weakened.

Parent updated BOTH scripts/ci-web-validation.sh and the duplicated release workflow list to select DelegatedCompletionDelivery.test.ts, so the moved cases remain mandatory in both gates. Removed only inert launch-ledger acknowledge() and JobService listeners/call sites; kept actual execute response ACK protocol, old pending mapping reads, and the real bridged-ACK test. 63 focused routing/bridge/placement/release tests passed, 915 assertions. Test title now describes sidecar-free reopening rather than nonexistent ledger cleanup.

Remote parent-finished commit dab924c became 62e7cb1 after fresh 251-pass/3-opt-in-skip tests, root typecheck and changed-file format/lint. Net remote source -324, tests +166, code/tests -158.

Combined Linux gate launched as task_1733e78b at integrated code commit 7fbab062ae6700c96bc20304b8bb3babe4ed3405. PATH supplies Bun 1.4.2, Node 24.21.0 and npm-pnpm/11.27.1 (upstream selects its own pinned pnpm). BRUV_T3_SOURCE uses the completed web worker's durable .cache/t3-source. Paid/device and opt-in SSH gates are unset; real current-binary SSH fixtures will run separately. Logs: artifacts/code-reduction-implementation/combined-ci.log and artifacts/ci/.

Second independent read-only review: task_1eb71da9, worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_1eb71da9, branch bruv/review-live-remote-web-and-tooling-clean-1eb71da9, pinned same code commit. It reviews Live/remote/web/tooling and parent cross-owner fixes. Report: artifacts/code-reduction-implementation/review-remaining.md.

Measured committed tracked code/config/test diff (not wisdom/audit prose): 139 files, +3,201/-5,179, **1,978 fewer lines**. Runtime/native -1,282; tests +279 net; tooling -700; maintained web integration -275. This counts the tracked patch representation once; it does not count generated upstream source twice. These counts may change if final gates/review require fixes. No feature/archive cuts.

First combined CI command exited 1 solely on standalone web extraction ENOSPC: /tmp tmpfs was 98% full (447 MB available); /home had 115 GB. It built the current binary, passed format/lint/typecheck, all selected web suites, and 1,717 root tests; 20 intentional skips and one storage-error failure. Preserved first log as combined-ci-first.log. No unrelated /tmp files deleted. Rerun task_aed514b6 uses private disk-backed TMPDIR /home/tnfssc/.bruv/code-reduction-tmp-g4HOOc.

First current-binary child/root SSH launches failed before container creation because parent validation PATH omitted installed Docker's directory. Added the actual checked docker-cli/29.1.3/docker path. No fixture/product code failure established. Retry acceptance after final build with corrected PATH; previous receipts in /home/tnfssc/.bruv/code-reduction-acceptance-Gvw78p preserve the failure.

Combined Linux gate retry task_aed514b6 exited 0 with disk-backed temp storage. First ENOSPC did not recur. All root/web gates and standalone smoke completed; code was unchanged between runs. Final independent remaining-scope review task_1eb71da9 found no material feature-preservation regression and verified canonical patch/source equality at the pinned revision.

User then requested /tmp cleanup and asked whether to increase it. Removed inactive temporary pnpm/dependency caches after active-use checks; freed about 6 GB, retained all source/evidence and active/system files, did not change mount size or cleanup policy. See temporary-storage.md. Corrected-PATH current-binary SSH acceptance now runs as task_8ef10466 (child) and task_d7a1f03d (root), receipts under /home/tnfssc/.bruv/code-reduction-acceptance-Gvw78p/{child-final,root-final}; these are the only validation jobs still running.

Final acceptance: both corrected-PATH rebuilt-CLI SSH fixtures exited 0. Child and root receipts are in the paths above; root covers detach/reopen, ordinary pickers, lost-reply reconciliation and running shell cancellation. It does not prove owner-crash recovery or abort of an actively streaming root turn. All validation jobs are finished.

Final complete-file Git counts correct the earlier truncated-output count: 143 code/config/test files, +3,295/-5,258, net **1,963 fewer lines**. Tests grow by 279 lines. Final report and scope limits: wisdom/audits/code-reduction/2026-10-02/implementation.md. No feature/archive cuts, push or release. Existing values cover the lessons; no further value change was needed.

## Approved archive retirement follow-up

User approved removing the frozen 35,011-line T3 archive after feature-preserving cleanup. Current integrations/t3 and other experiments stay. Worker task_68bc9a0c owns removal and focused checks in /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_68bc9a0c, branch bruv/remove-retired-historical-t3-archive-68bc9a0c, baseline 65e3242de4206cd8b123ffbc35c1f233bd7ce536. Parent will review scope and integrate the returned commit. Final handoff will be wisdom/quality/t3-archive-retirement.md.

Archive follow-up complete: integrated worker commit 9dd2017 as 6961bef. Verified all 24 deleted paths lie under wisdom/experiments/t3/production-v2/archive; 35,011 historical code/config lines removed. Worker root typecheck and 10 focused architecture/source/branding/voice-boundary tests passed. No active source changed; no full build repeated. Recovery baseline and checks are in t3-archive-retirement.md. Values unchanged: existing historical-retirement and proof guidance applies.
