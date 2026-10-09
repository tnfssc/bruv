# Fast lost before Bruv launch

## Current decision: official releases only

On 2026-10-09 the user rejected T3 patching. Do not build, install, or deploy the local host patch. Only consider an official update. This overrides all earlier patched-build and restart plans below. The local patch is retained as research, not approved release work.

Rechecked official releases at 20:24 UTC: newest nightly v0.0.46-nightly.20261009.2886 and newest preview v0.0.46-preview.20261009.2891 both still omit the instance catalog at all four compiler calls. Their compiler still defaults to the bundled Claude catalog. Latest stable is v0.0.45 (2026-10-02). No available official update was found to fix this loss. No update or restart was performed. Saved question q_99ac63f5-2a1f-425a-92fe-767b2beed4ea is resolved with the user’s official-only answer.

Next: use an official release once its source fixes this path. No scheduled watcher was requested or started. Values unchanged: the existing rule to preserve the user’s choices covers this boundary.

Work in progress on t3/fix-subagent-model-speed. User sees Astra High Fast spawn Sol High, not Fast. Do not dismiss the missing Fast label as cosmetic.

## Live evidence

Checked 2026-10-09. T3 parent 537a4c8d-8add-479f-940e-2578f3c8be46 and this thread 0c3e3778-75d2-4f2f-b765-091e746ef6c2 both save effort=high and fastMode=true. The latest terminal child (bruv-53ffc9b6-6aa7-8eae-ab46-d3f422229fb9) saves Sol with no options. That alone does not prove the request tier.

The running host is /home/tnfssc/.t3/runtime/versions/0.0.46-nightly.20261005.2702/t3. Both parent connector processes (61555 and 900512 at inspection) receive only --settings {"showThinkingSummaries":true}. No fastMode reaches Bruv. Their local children (618851 and 1013941) have BRUV_SUBAGENT_NATIVE_FAST=0. This thread's Pi session and its new child's session have no bruv-native-fast-mode entries. This is actual launch evidence, not a badge guess. No credentials were read or printed.

The source already accepts explicit settings.fastMode and local children inherit effective Fast. See [host trace](parent-fast-host-trace.md). Fix the host catalog compilation, not consent recovery from guesses in Bruv.

## Work and ownership

An initial worker task_90728410 was stopped once the loss was confirmed upstream. Its worktree remains /home/tnfssc/.bruv/worktrees/t3-1d0882e1-5442693331ce-task_90728410, branch bruv/fix-native-subagent-fast-inheritance-90728410. Do not assume it contains a fix.

Research worker task_7e39d240 checks upstream source and current fixes. Parent is preparing pinned host source at /home/tnfssc/.bruv/upstream-preparation/t3-fast-mode-fix, branch fix/custom-model-fast-inheritance, from cfa4f765ec05950a032b6c1cf9cdfff0c2391545. No installed host or connector changed. Do not edit the dirty research T3 checkouts.

Next: fix and test the actual host launch compiler; decide how to apply it without interrupting other live threads. Check child display separately after real Fast inheritance works. Values unchanged so far: existing real-path proof, safe ownership, and truthful UI guidance cover this.

## Host repair checkpoint

The pinned host source is now in a separate Git worktree: /home/tnfssc/.bruv/worktrees/t3-custom-model-fast-fix, branch fix/custom-model-fast-inheritance. Its baseline repo is /home/tnfssc/.bruv/upstream-preparation/t3-fast-mode-fix (pinned-baseline). All code edits are in the host worktree, not the installed runtime.

ClaudeAdapterV2 compiled launch, query identity, and prompt effort against the bundled Claude-only catalog. It now uses scopeClaudeModelCatalog with the provider instance's customModels at all four compiler calls. The existing compiler owns descriptor checks; no forced Fast default or inferred billing consent was added.

Six focused tests passed: custom Fast true/false on fresh/resumed launches and built-in/custom background-query identity checks. Broader adapter/catalog suites (task_4b9e747a) and server typecheck (task_01dee024) are running. Research task_7e39d240 checks upstream availability and deployment. Setup first used the wrong package manager (Bun), which failed frozen-lockfile validation and altered package.json. Restored that setup-only manifest change, then installed with pinned pnpm 11.10.0 successfully. No install failure was treated as test evidence.

## Checks and deployment boundary

All 157 host adapter/compiler/catalog tests pass. Server typecheck passes. The first broad test runs failed before tests because Vite cached paths into a removed /tmp directory. Moved only this worktree's node_modules/.vite into .tmp/fast-tests/vite-cache-before-retry, then reran with an owned TMPDIR and --no-cache --no-fsModuleCache. No assertion was removed.

Bruv's existing isolated Fast connector/inheritance suite passes from this source under env -i and owned HOME/config/tmp (.tmp/fast-inheritance-check). It checks mocked requests, not paid provider billing. Installed Bruv is 0.16.22 and its help exposes the explicit --settings Fast consent binding.

Research found main 454b94a13aea918f27bb060d8d054d4cfb791bc2 and nightly 0.0.46-nightly.20261009.2886 still omit the catalog. A plain update will not fix this. Review task_31f92699 is running. Saved question q_99ac63f5-2a1f-425a-92fe-767b2beed4ea asks whether to install/restart a patched T3 or stage it first. Do not restart the live host until that is answered. Use the supported versioned installer and a full runtime archive; do not overwrite its active executable or edit live userdata.

The child projection separately drops model options when a child changes model (ClaudeAdapterV2.ts around line 4298). Do not invent child Fast status from a label. This patch fixes real launch/inheritance; visible child-option reporting needs checking after deployment and may need its own truthful metadata change.

## Review

Read-only reviewer task_31f92699 approved the patch with no blocking findings. It checked instance isolation, true/false/omitted Fast, all four compiler calls, and background query protection. The 157-test broad pass completed while review was running; the reviewer did not rerun it. Runtime installation and child UI reporting remain unverified. Values reviewed and unchanged: this is an instance of the existing real-path proof and truthful-state guidance, not a new value.

## Saved state

Host fix committed locally as 8ea0e3a29a54888113a4e2d30bd3e4e8719a5046 in /home/tnfssc/.bruv/worktrees/t3-custom-model-fast-fix. It is not pushed or installed. No patched runtime has been built yet. Review is complete; saved restart question is still pending.

The first signed commit failed because the machine's /tmp tmpfs is full (16 GiB). Home has about 301 GiB free. Retried with TMPDIR pointing at the host worktree's .tmp/git; signed commit succeeded. Do not remove other people's /tmp files. Use owned on-disk TMPDIR for remaining build and test work.

Next after the user's choice: build a distinct version from this pinned source and commit, package the full runtime, smoke-test it with isolated userdata and no automatic continuation. The build script is apps/server/scripts/cli.ts build-exe; it requires Node 25.7+ and targets Node 26.8.2. The current shell has Node 24.21.0. Use an owned build runtime if needed. scripts/build-cli-archive.ts needs the executable, client assets, resource monitor, and native external dependencies. Use the supported updater with T3CODE_RELEASE_BASE_URL for an exact patched version. Do not hot-overwrite the active 2702 runtime.
