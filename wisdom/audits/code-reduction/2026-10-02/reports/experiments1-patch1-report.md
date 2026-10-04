# Archived lifecycle patch — reviewer 1

## Scope and method

Read wisdom/values.md first. Examined **every assigned physical line, wisdom/experiments/t3/production-v2/archive/.agents/rollback/t3-v2-lifecycle/web--t3.patch:1–4400**, including diff metadata, context, removed lines and added code. Initial lines 1–90 followed by 52 contiguous numbered chunks covering 91–4400; each successful patch-reading output was bounded below 4 KB and untruncated. Four failed attempts to reuse execute globals were retried by recomputing chunks; no gaps remain. **Not a review of the whole 13,028-line patch.** Line 4400 is inside PiAdapter.test.ts, so this reviewer does not claim that entire test file was reviewed.

Cross-references were read/searched only to establish ownership and consumers. No builds, tests, provider calls or production edits. Documentation/prose is not a savings candidate.

## Finding E1-P1-ARCHIVE — retire the historical patch snapshot, not its live behaviors

**Recommendation:** after the parent joins all patch ranges and confirms rollback-retention policy, remove the obsolete tracked rollback patch as a whole, relying on a recorded Git revision for historical recovery. Do not delete just lines 1–4400: that would damage the patch. Do not transplant historical implementations into the shipped overlay.

**Evidence:** the assigned file is a tracked historical diff, not an executable module. Its adjacent web--t3-source.json pins revision 719a76ca1dbf5490f1aa33ffb9966301e02be9a9; the current integrations/t3/upstream/source.json pins 66a91077f9abf6e171aad0ceab2519d7272f3ff3. Current code has a different single owner:

- package.json scripts build/build:web/check/test select scripts/build.ts, integrations/t3/build/build.ts, tsc, and ./tests; tsconfig.json includes src, scripts, integrations/t3 and tests, not this archive.
- scripts/build.ts:1–6,32–46 prepares the web payload and compiles src/cli.ts. integrations/t3/build/build.ts:49–79 selects **integrations/t3/upstream/bruv.patch**, checks the pinned HEAD and applies/verifies that patch explicitly. verify-source.ts:20–29 requires exact HEAD + supplied canonical patch and rejects untracked source.
- scripts/packed-web.ts:40–51 hashes the canonical patch/pin and integrations/t3 tree, not experiments; src/t3/web/embedded.ts:1–6 loads the compiled web archive; launcher.ts:178 dynamically imports that embedded loader. There is no directory-wide rollback-patch loader in these paths.
- scripts/ci-web-validation.sh:5–23 selects the current pinned source and actual source test paths. It still explicitly tests EnvironmentAuth, AgentDeviceTarget and EventNdjsonLogger, but does not load this archived diff. Current Pi integration coverage selects orchestration-v2/Adapters/PiAdapterV2.test.ts.
- Standalone archive tools were checked too: archive/scripts/export-candidate.ts:8–13 uses .agents/patches/t3-v2-production-candidate.patch; export-worktree.ts:5–12 and55–56 exports web/t3.patch; build-candidate.ts:10–18 reads the candidate patch. preview-v2/setup.sh:10 chooses its own upstream.patch. None selects web--t3.patch. integrations/t3/gates/migration-acceptance.ts:13–24 defaults to the canonical shipped patch, although its explicit environment override can select another patch.
- Tracked git grep and a filesystem rg search including hidden/ignored files under scripts, src, integrations, experiments and .github found no code reference to web--t3.patch, t3-v2-lifecycle, .agents/rollback or production-v2/archive. Searches excluded patch bodies, documentation, generated artifacts, dependencies and caches. This is negative consumer evidence, not a claim that nobody could manually apply it.

**Reviewed code and counterevidence (all positions below are in the assigned patch):**

| Patch lines | Assessment |
| --- | --- |
| 1–17 | Historical startup test adds a ProviderRegistry refresh mock. Not an independent runtime feature. |
| 18–316,348–470 | Loopback-only credential-free auth and HTTP/WebSocket/config tests are security boundaries, not gratuitous duplication. The live overlay has the renamed BruvWebAuth.test.ts at bruv.patch:1–107 and equivalent loopback/origin policy at108–179, with EnvironmentAuth and config wiring at180–470. Keep these live controls. |
| 317–347 | Scoped runCli waits for runtime teardown. The archived bin.ts diff is not present as a section of the current overlay; absence alone does not prove that upstream runCli/teardown behavior is dead. No independent cut recommended. |
| 471–710,990–1034 | Bun self-exec markers distinguish interpreter helpers from application subcommands; agent-device launchers remove daemon credentials/config. Compiled-executable probe and environment isolation are useful safeguards. Do not remove them from current source because the old patch is retired. |
| 711–796 | Projection retains execute handoff details across repeated projection. This is user-visible continuation information, not disposable logging. |
| 797–989 | PiDriver test and factory own adapter, text generation and provider snapshots. The shipped overlay changes an existing upstream PiDriver (bruv.patch:6000–6052), applies BruvWebPi settings and suppresses inappropriate Pi updater checks; it does not add the historical 123-line factory. This is evolved ownership, not proof that Pi is unused. |
| 1035–1257 | Logging tests enforce aggregate retention; implementation already removes the unbounded per-thread sink map and reconstructs rotation metadata per batch (1196–1207). Preserve bounded retention and accurate errors; no speculative further state cleanup proposed. |
| 1258–4400 | Partial PiAdapter test diff: fake RPC harness, durable sessions, MCP credentials/cleanup, extension UI acknowledgment/retry, cancellation deadlines and close ordering, late task attribution/deduplication, extension task projections, steering, compaction continuation, transport shutdown/startup races and usage accounting. Distinct protocol cases are not redundant merely because harness setup repeats. This range does not include the adapter implementation or the end of its test file; no unsupported production feature-cut savings assigned. |

**Confidence:** high that the historical patch file is not a default current build/executable/test input; medium that retiring this rollback artifact is acceptable until the owner confirms its retention purpose. Current source checkout was not reconstructed: locally examined caches have other revisions. Current-overlay section comparisons are exact path/text comparisons, not verification of all upstream code.

**Behavior lost:** convenient on-disk restoration of that older patched upstream state, including its historical tests. No observed current runtime behavior should change. Counterevidence is the deliberate rollback location, tracked source pin, and availability of generic manual patch application/explicit migration overrides. Preserve recoverability by recording a reachable Git revision containing both patch and pin before removal; confirm there is no out-of-repository operational restore procedure that expects this path.

**Savings (this range only, non-additive with other reviewers):** 3,696 added nonblank, non-comment code-payload lines reviewed. Conditional gross/net repository payload reduction: **3,696 / 3,696**, with no replacement implementation. Count excludes diff headers, comments, blank lines, removed-side lines, context lines and all unread lines. **Executable production LOC reduction: 0.** These are archive-storage/review-surface savings, not active maintenance or bundle-size savings; the archive has no demonstrated ongoing synchronization requirement. No whole-file savings claimed. If rollback snapshot must remain, accepted savings are 0. Do not add a test-refactor estimate on top of archive removal.

**Checks before acting:** parent completes the remaining patch ranges; owner approves rollback retirement and pins Git recovery; rerun code-reference/dynamic-loader searches after other audit changes; inspect the canonical build input manifest to confirm it is unchanged. No paid/live/provider test is required to validate an archive-only removal. A future production-code cut would require separately tracing the current pinned upstream implementation and running its focused offline checks, not reusing this historical audit as permission.

## Outcome

All assigned lines reviewed; one conditional archive-retirement finding, no independent active-code deletion recommended. No wisdom or values changes: this read-only continuation permits only the report and coverage artifact, and introduces no new principle.
