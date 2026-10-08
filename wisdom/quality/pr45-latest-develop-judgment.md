# PR45 current-develop merge — independent source judgment

## Verdict

**ACCEPT — quality and static correctness of the requested merge resolutions.** No unresolved blocking finding in this bounded scope. This is an actual-code ownership/readability judgment, not a test-count proxy, broad new audit, runtime acceptance, or publication authorization.

Exact target: **48b4a44a49ca2f6d817451e47cd40b757deb2642**, tree **8a44e8eb1e0c0e755334e4805ddb4d4f7e5235e2**. Parents: **e6b4981930cd7e6799355c79dc05e272aec0ae75** (reviewed PR) and **c15fd2b064997daed81258461334cb8f9bde0626** (pinned develop). Common ancestor: **22ad5f50acfc7b6ceed6483358022a0161a77d99**. Review checkout HEAD equals the target.

Actual reviewing model: **openai-codex/gpt-6.1-sol**, verified from this session's model_change record, event **bf0019ef**, **2026-10-08T17:43:01.802Z**, native session **01a11c9c-8257-70c8-a899-0791ce195547**. Retained verbatim in the evidence directory.

Current source is **0.16.19 / Pi 1.1.0**. The earlier 0.16.18 paired-build proof is historical, not proof of this target.

## Scope and method

Read values, the develop-conflict note, original-intent follow-up, focused history/Fast/workload acceptance receipts, structural readability guidance, Pi 1.1 upgrade/recovery integration, recurring drift/recovery design, orchestration-as-tool and compiled-fixture deadline rationale. Read both parents' relevant deltas from the common ancestor, the conflict-resolution first-parent changes and named clean-merge deltas, and the remerge conflict/resolution hunks. Followed actual merged owners and callers rather than treating removed inline implementations as lost functionality.

The remerge diff has exactly the seven reported true conflicts and eight additional paths (seven code/test adaptations plus the merge note). Reviewed all nonautomatic adaptations. Also examined the named risky clean-merge source/assertion deltas and their composed production boundaries. Unchanged surrounding subsystems were not re-audited in full.

## Seven true conflicts: quality AND correctness

1. **Navigation terminal/workloads.** The upstream delta adds only setProgramStatus to its former inline terminal. The merged NavigationTerminal owns that no-op at navigation-terminal.ts:47. Workloads and the offline SDK probe both import and instantiate it (workloads:30,340; probe:22,181). Workloads, navigation history and SDK-probe files otherwise remain PR-exact. The old inline terminal/history factory is not restored. A reader has one terminal protocol owner and a separate SDK lifetime owner; the Pi 1.1 Terminal contract reaches both callers, not an unused duplicate.
2. **Profiler.** Only the two version comments change relative to PR. PendingRenderRequests remains the owner of coalescing and synchronous input association: duringInput restores nested input state in finally; consume clears the batch before rendering can enqueue a new one. No old parallel request/input bookkeeping was reinstated. Frame-entry delays remain distinct from synchronous frame duration. The source still exposes one scheduling-accounting journey.
3. **Instruction modes.** Retained the PR helper/case organization, prepared-frame exact equality, custom-before/after framing, explicit-custom nonreplacement and disk-reopen byte equality. Identity expectations now use retained delegation mechanics instead of removed leader prose, including the PR-only prepared-frame assertion. Relative to PR there are wording/format changes, not dropped cases. Restoring upstream's old inline fixture suite would add a second fixture program; the resolution correctly avoids it.
4. **SDK mode tests.** The process wrapper and helper are PR-exact. All five upstream identity substitutions are in main-agent-mode-sdk.probe.ts, the actual case owner. The wrapper still requires exit zero and the completion sentinel. Model/thinking stability, automatic follow-up, marker collision, history restore and startup override assertions stay in the probe. Upstream behavior is ported without defeating process identity/import isolation or reintroducing a spare suite.
5. **Fast test conflict.** Both error assertions now name pinned Pi 1.1.0. The PR-added host refusal and subsequent empty-entry assertion remain, as do the rest of the repaired consent/request tests. Resolving on upstream alone would lose that host coverage; this merge does not.
6. **SDK wrapping reference.** Kept createOriginalSdkReference as the retained fixture owner; only its accurate version comment and patch path change. It copies utils into its own directory, reverse-applies the single utility hunk there, and binds reference Text/Markdown to that reversed utility. The independent reference is not replaced with the patched implementation itself. Unicode/ANSI equality and grapheme-work assertions remain. The tracked 1.1.0 patch has the required unique utility section.
7. **Updater fixtures.** Kept PR's typed paired-artifact and private compiler organization. Only the two compiler-owning cases receive the upstream 30_000 budgets (update.test.ts:662,715). Compiler exits, compiled identity, paired payload bytes, running-runner immutability, executable output and staging cleanup assertions remain. This is the explicitly reviewed upstream timeout correction, not a global budget increase or a product assertion relaxation.

## Risky clean merges and extra adaptation

**Dependencies, patches and release.** package.json, bun.lock, both renamed 1.1.0 patches, notices and the 0.16.19 release note are upstream-exact. All four direct Pi pins are 1.1.0 (ai, coding-agent, server, tui); package patch keys/paths and lock entries agree. The notice generator changes only the pinned version and source URL relative to PR, retaining its existing bounded collection/rendering ownership. Read patch anchors and fixture provenance; no old patch is silently substituted. Static equality/alignment is not proof Bun applies the patch correctly or that built launchers work.

**Strict host preparation and recovery.** adaptation, recovery and asset entrypoint are upstream-exact. Actual code still admits only 1.1.0, requires exact original/result digests and single anchors, reads all siblings before adaptation, and validates before target writes. The writer uses adjacent exclusive copies and rename rather than writing inherited installed inodes. Recovery owns its one stage; it checks package and nested target-directory realpaths before normal preparation or acquisition, catches only typed source drift, acquires a fresh frozen ignored-script install with private cache/copy backend, strictly validates that source, and uses the same writer. The asset entrypoint awaits that owner before copying assets. No historical polluted hash is accepted. Acquisition does not own target repair; neither path becomes an asset-guard bypass. Per-file atomic replacement is deliberately not a cross-file transaction; later I/O failure can leave earlier replacements completed, as upstream already documents.

The extra prepare-assets test edit copies the newly imported recovery module into its acquired fixture, without changing assertions. The pinned gzip contains nine original texts whose SHA-256 set matches the nine declared original hashes; compressed digest is **d1e9c01c7472398fa5e66b885939bedda06b7865fa98eadd75431957046fbcb9**. I decompressed/read/hash-checked data only; I did not execute an adaptation or recovery.

**Fast against the new SDK.** The source differs from the accepted Fast blob only in three current-version comments/diagnostics. Actual persistence remains caller admission -> persistSelection (531–543) -> persistSetting (192–211). Host, command and inherited startup still share this single durable constructor/append route; stale post-confirmation checks, failed-off suppression, rollback result handling and one-shot inheritance remain. Reading the installed 1.1.0 SDK confirms ModelRuntime.prepareRequest -> prepared.provider.streamSimple, provider-ID OAuth lookup, and forwarding of onPayload through buildBaseOptions. Canonical OpenAI remains the Responses provider for API/OAuth. OpenAI and Codex serializers await the payload hook before HTTP request/body dispatch or WebSocket processing. Bruv's captured authorization and post-hook model/tier checks remain outside Pi's exception-swallowing extension emitter. No new consent, endpoint or dispatch shortcut appears. This checks seam composition statically, not live account/provider behavior.

**Prompt simplification.** Both orchestrator Markdown owners are upstream-exact. Tests now positively identify surviving worktree/delegation mechanics and negatively check the removed leader framing. Preview root/child identity additions preserve caller environment and normal/fast role exclusions. The custom prompt ownership assertions still exclude injected orchestrator mechanics. The additional PR-only preview/CLI updates are necessary contract migrations, not removal of identity coverage.

**Pi fixture contracts.** Inspected named terminal/performance/startup and compat lifecycle deltas. Program-status no-ops live in terminal fixtures; partial InteractiveMode fixtures supply report/handleEvent seams. Settled fixtures supply explicit aborted:false, including all four PR-added frontend events. Lifecycle multiplicity, accounting/result, retry failure and rendering assertions remain unchanged. Version/path expectations match 1.1.0. These local adapters do not replace production logic with stubs.

**History and workload repair preservation.** Verified exact prior-acceptance blobs: disk-entry-store **093d4cf9fe2991c7200561242cad697b6c14db5d**, session-manager **32eb9878654e0d6f85156fb20ff7dfc50871aa2d**, workload **732e4afe56df9fa482cd6e6b9a2d93bcf04e016b**, production child writer **b8586b46db163595b0c8e2ce083a0fb07603e483**, usage helper **ee8b6bf4856a30b3fec73921890c60340e3ba5b1**. Traced the new SDK's message/custom/compaction callers into the owned _appendEntry: native callers construct against the leaf, then call the override; the store prepares one metadata row inside byte/publication rollback, registers that same row after commit, and the manager publishes it. buildContextEntries and buildSessionProjection both reach modelContextMetadata; no competing context selector is restored. Existing post-commit allocation/close limitations are not upgraded into all-exception atomicity claims. Workload and runtime both call writeNativeChildFrame; its stream exclusion, causal child binding, cost and append/replay result remain the shared policy. Returning that promise preserves the binding's suppression decision. This retains substantive reading-burden removal, not merely file/hash sameness.

## Exact resolution blobs

Working bytes matched every scoped target blob. The full **78-file** manifest records target, both parent blobs and working-match results; no mismatch. This inventory is scope verification, not a claim of full-file quality review of every inventory entry.

| Resolution/adaptation source | Target Git blob |
| --- | --- |
| scripts/terminal-perf/navigation-terminal.ts | 5b16594adf3b3228e2e7594017a3dcf4769fb989 |
| scripts/terminal-perf/navigation-workloads.ts | 6a3240454997193b22f04167d3b7df5ef06b341c |
| scripts/terminal-perf/profiler.ts | 3098ee59ac85e03a20a5cf6157593fa272aaa308 |
| src/agent/native-fast-mode.ts | 2af20c1388516b0ad4a02a98660c69fd83d382fe |
| tests/claude-compat-frontend.test.ts | 6df885fe428a678e87838653d57cac4433a2eb56 |
| tests/instruction-mode.test.ts | bf46b0ea563fd96cbedae9f1edbd1f92ad78a542 |
| tests/main-agent-mode-sdk.probe.ts | 831063af9d4900d20cb702c7f80dfcea2dc20837 |
| tests/main-agent-mode-sdk.test.ts | d67cd10422a127f5163aa70c8d2bbb06fae1f4f5 |
| tests/native-fast-mode.test.ts | 4a2ccc2d594305c35d1bc0d28ca294a3168116f4 |
| tests/prepare-assets.test.ts | 824788542d599d8af11240fb52ee01930deb588d |
| tests/prompt-preview-cli.test.ts | e36dce6e9416f3054acba8216d39ad7cf2d98485 |
| tests/prompt-preview.test.ts | 3976fd9c6f3f951d5145505146425aeb13866a4d |
| tests/sdk-text-wrap-performance.test.ts | 8a9974b28173b4681a3e33aecc25c18c968ea659 |
| tests/update.test.ts | 7b423775769f90c5a728a9757dc5a966a2bb277f |

## Retained evidence, safety and limits

Evidence: **/var/tmp/pr45-merge-quality-Udl07b**. Includes raw remerge/first-parent/upstream/PR diffs, second-parent inventory, scoped parent/working blob manifest, focused adaptation diffs, fixture hashes, actual model record, installed-SDK read-only source digests and static scope checks. The session journal retains exact tool attempts/output. Initial evidence-redirection commands used unsupported POSIX grouping in fish and exited 127; Git evidence was then captured read-only via Bun.spawn. This was not a setup/install/prepare/recovery retry.

Read-only git diff --check for first-parent-to-target and working-to-HEAD returned zero; unresolved-index and initial working-status output were empty. Only this report was added to the fresh review checkout. No source edits, commit, push, merge, release, tests, workload, install, prepare or recovery execution; no sudo, shell cleanup/traps, inherited HOME/config/SDK mutation, credentials/auth/provider/SSH/device actions, old-parent/user-data recovery or copied fake generated assets. Installed package version/source reads are static seam evidence, not validation of any automatic setup.

I did not independently reproduce the merge note's safety runs. Its current-version receipts remain separate evidence; earlier 0.16.18 proof is not reused as current acceptance. **Parent owns runtime validation and publication:** paired 0.16.19 build and compiled launchers/host tests, updater compiler cases, actual-tip CI, rendered acceptance, resource/100k context scenarios and any separately authorized production recovery/provider use. ACCEPT here is exact-source quality/static correctness only. Values/guidance stay unchanged: this merge applies existing actual-code judgment, single ownership and honest-proof principles; no new general lesson requires a source edit.
