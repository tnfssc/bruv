# PR45 pinned develop merge

Fresh worktree: /home/tnfssc/.bruv/worktrees/t3-1dc1185b-5442693331ce-task_0d1f8feb
Branch: bruv/pr45-develop-conflicts-20261008
First parent: e6b4981930cd7e6799355c79dc05e272aec0ae75
Second parent: c15fd2b064997daed81258461334cb8f9bde0626
Actual worker model: openai-codex/gpt-6.1-sol, verified from this native session's model_change record (2026-10-08T17:33:14.896Z).

Read [values](../values.md), [original intent](pr45-original-intent-followup.md), the exact history/Fast/workload acceptance receipts, and upstream Pi upgrade, recovery integration, recurring drift and orchestration-as-tool wisdom. This is a normal merge, not a new readability sweep. Parent owns independent changed-scope quality/correctness judgment, final paired build/compiled use, and push to existing PR45. No publication or release here.

## Seven true textual conflicts

- scripts/terminal-perf/navigation-workloads.ts: keep PR's extracted terminal/history/probe owners; put upstream's required no-op setProgramStatus in scripts/terminal-perf/navigation-terminal.ts. Do not reintroduce its old inline terminal or history factory. Both navigation workload and offline SDK probe use the extracted terminal.
- scripts/terminal-perf/profiler.ts: retain PendingRenderRequests and its synchronous input/coalescing semantics; update the two current Pi-version comments to 1.1.0.
- tests/instruction-mode.test.ts: retain PR's helpers, prepared-frame and history cases; assert retained delegation mechanics rather than removed leader prose. No duplicate old fixture suite.
- tests/main-agent-mode-sdk.test.ts: retain isolated process wrapper and move all five upstream assertion updates to tests/main-agent-mode-sdk.probe.ts, its actual case owner.
- tests/native-fast-mode.test.ts: use 1.1.0 compatibility diagnostics while retaining host refusal and no-append assertions added by PR.
- tests/sdk-text-wrap-performance.test.ts: retain the owned, retained original-SDK reference fixture; use the 1.1.0 patch path and accurate reference-version comment, not upstream's older shared-lifetime fixture.
- tests/update.test.ts: retain PR's typed paired-artifact and private compiler fixtures; apply upstream's 30_000 budgets only to the two corresponding compiler-owning cases. All compiler/output/paired-replacement assertions stay.

## Risky clean merges, separately from conflicts

Reviewed composition, not just absence of markers:

- Release/dependencies: package.json, bun.lock, patches/@earendil-works%2Fpi-coding-agent@1.1.0.patch, patches/@earendil-works%2Fpi-tui@1.1.0.patch, scripts/generate-third-party-notices.ts, THIRD_PARTY_NOTICES.md, support/release-v0.16.19.md. Current source version is 0.16.19; all four Pi pins are 1.1.0. Package, lockfile and both patches equal the pinned upstream blobs.
- Host/assets: scripts/pi-host-adaptation.ts, scripts/pi-host-recovery.ts, scripts/prepare-assets.ts, tests/pi-host.test.ts, tests/pi-host-recovery.test.ts, tests/fixtures/pi-host/1.1.0-originals.json.gz, tests/fixtures/pi-host/README.md, and upstream wisdom/dependencies/evidence/pi-host-1.1-recovery/{checks.txt,fixture-source.json,focused-unbuilt.txt,real-command.json}. Guards, writer, acquisition and fixture/provenance bytes remain upstream-exact. Strict version/hash/anchor/result checks, validate-before-write, local realpath ownership, copy/rename detachment and fresh frozen private-cache recovery remain intact. Necessary additional adaptation: tests/prepare-assets.test.ts copies the new recovery module imported by its copied entrypoint; no assertion changed.
- Fast: src/agent/native-fast-mode.ts cleanly received upstream's version comment/error text. Also update its remaining current seam comment to 1.1.0. persistSelection -> persistSetting still owns host/command/inheritance publication. Inspected installed Pi prepareRequest/streamSimple and provider seams; no guard or consent logic edit.
- Prompts: src/prompts/main-orchestrator.md and src/prompts/orchestrator.md remain upstream-exact simplified framing. Cleanly merged tests/prompts.test.ts, tests/prompt-preview.test.ts, tests/subagent-extension.test.ts, tests/live-main-integration.test.ts, tests/claude-compat-prompt-ownership.test.ts preserve removed-framing checks and delegation mechanics. Necessary additional adaptations: PR-added identity cases in tests/prompt-preview.test.ts and tests/prompt-preview-cli.test.ts still positively expected removed leader prose; bind them to retained mechanics and retain/add leader-absence checks.
- Pi fixture contracts: scripts/terminal-perf/send-workloads.ts, scripts/terminal-perf/tool-event-workloads.ts, scripts/terminal-perf/tool-workloads.ts, scripts/terminal-perf/workloads.ts, scripts/terminal-perf/README.md, tests/fixtures/saved-transcript-startup.ts, tests/saved-transcript-startup.test.ts, tests/rolling-activity.test.ts, tests/scroll-layout-render.test.ts, tests/terminal-perf-action-profiler.test.ts, tests/terminal-perf-profiler.test.ts, tests/claude-compat-command-lifecycle.test.ts, tests/claude-compat-retry.test.ts, tests/release-workflows.test.ts retain upstream 1.1.0 contract changes. Necessary additional adaptation: four PR-added settled events in tests/claude-compat-frontend.test.ts now supply aborted: false; all lifecycle/accounting assertions stay.

History store/manager, workload and production child writer are byte-identical to PR head and their exact quality receipts. Traced native append callers into the owned append override/store transaction and context consumers into modelContextMetadata; traced workload/runtime callbacks into writeNativeChildFrame. No competing metadata/context owner or child-write policy was restored. Hash equality supports preservation, not a new independent quality verdict.

## Safety evidence and gaps

Retained evidence: /var/tmp/bruv-pr45-merge-safety-4em5IM (environment.json, command plans, merge-invariants.json and logs). Checks ran with cleared environment and acquired HOME/config/SDK/tmp/private cache. Inspected fixture effects before running; deletion stays in existing acquired-fixture hooks, never shell cleanup/traps or user-data recovery.

- bun install --frozen-lockfile --ignore-scripts --cache-dir <owned cache> --backend copy: pass. Initial installed package was 1.0.3 and assets absent. No setup retry bypass or manual generated-asset workaround.
- bun run prepare:assets: pass through normal strict production entrypoint, no recovery notice. This is fresh-source preparation, not a real contaminated-install recovery claim.
- bun test tests/native-fast-mode.test.ts tests/history-storage.test.ts tests/history-storage-io.test.ts tests/history-truncated-branch.test.ts tests/claude-compat-task-child-journal.test.ts: 59 pass, 0 fail, 372 expectations.
- bun test tests/instruction-mode.test.ts tests/main-agent-mode-sdk.test.ts tests/prompts.test.ts tests/prompt-preview.test.ts tests/terminal-perf-profiler.test.ts tests/terminal-perf-action-profiler.test.ts tests/terminal-perf-navigation.test.ts tests/sdk-text-wrap-performance.test.ts: initially 92 pass, 1 stale prompt assertion failure, 5671 expectations. Unchanged successful files need not be rerun for a count.
- bun test tests/pi-host-recovery.test.ts tests/prepare-assets.test.ts tests/haiku-model-catalog.test.ts: 20 pass, 0 fail, 1115 expectations. Recovery uses labeled pinned synthetic dependency fixtures, not authority over user history/data.
- After the observed clean-merge gaps: bun test tests/prompt-preview.test.ts tests/prompt-preview-cli.test.ts tests/claude-compat-frontend.test.ts: 15 pass, 0 fail, 241 expectations.
- ./node_modules/.bin/tsc --noEmit: initially four missing-aborted fixture errors; final pass after the four explicit false fields.
- Focused formatting found one newly long assertion; formatted that file only. Final 12-file formatting check and staged/working git diff --check pass; no unresolved index entries. No gate, budget (apart from the two reviewed upstream compiler deadlines) or assertion was weakened.

Unverified: final paired build and compiled launchers/host tests, updater compiler cases, full CI, 100k model-context scenario/resource workload, rendered terminal acceptance, actual contaminated-install production recovery, live provider/auth/device/SSH and release behavior. Parent owns final integrated acceptance and publication. No edits to completed trees, push, PR merge, release or user-data recovery.

Values retain upstream's recurring-state lesson unchanged; no additional value is needed. This merge applies existing ownership, actual-code judgment and honest-proof guidance. For refactor/version merges, port small upstream contract changes to the moved owner and inspect newly added PR fixtures even when Git reports a clean merge.
