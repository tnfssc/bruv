# Code reduction audit — experiments2-patch2

## Scope and method

Read wisdom/values.md first. Reviewed **every assigned physical line 4401–8800 inclusive (4,400 lines)** of `wisdom/experiments/t3/production-v2/archive/.agents/patches/t3-v2-production-candidate.patch`, in 57 numbered chunks of at most 3,800 characters, with no truncated assigned-line output. The first and last represented files are partial. **This is not a whole-patch review.** Cross-references below were read only to establish consumers/ownership.

No production edits, commits, builds, paid/live/provider tests, or provider execution. Checks were static filesystem/search inspection and read-only HTTPS retrieval of selected files from the pinned upstream revision. The current pinned checkout is absent locally; its commit object was also unavailable in the inspected old cache. No runtime equivalence is claimed.

## Findings

### P2-01 — Retire the archived candidate after joined review (high confidence: not a current build input)

**Evidence:** This shard contains historical tests, usage aggregation, orchestration changes and process ownership code (range inventory below). Root package scripts use scripts/build.ts and integrations/t3/build/build.ts. scripts/build.ts:6,32–33,46 selects that builder and src/cli.ts. integrations/t3/build/build.ts:49–53,70–79,97–108 explicitly selects integrations/t3/upstream/bruv.patch, checks the pinned revision and verifies/applies that patch. tsconfig.json:11 excludes experiments. Current pin is 66a91077f9abf6e171aad0ceab2519d7272f3ff3; the archived manifest pins a9b49a7df0a4261dcc438d4493cc3154a1d9819e. Hidden-file-aware code searches found candidate-name consumers only in the archived build/export scripts and export receipt, not current tests, CI, integrations, loaders or executable roots.

**Counterevidence:** archive/scripts/build-candidate.ts:8–18 explicitly references/verifies/hashes this candidate; export-candidate.ts:8–11,35–46 publishes it. These are real historical consumers, not evidence of globally unreferenced text. However both resolve root to wisdom/experiments/t3/production-v2, not archive; the resulting candidate path does not exist. Both import a missing ../web-source module; build-candidate.ts:5 also imports a missing relative archive helper. The other archived smoke scripts consume old cached checkouts/executables, not this patch. Historical snapshots can still be reconstructed manually; deleting the patch deliberately removes that convenient in-tree historical input.

**Current comparison:** Current native gate selects NativeBruvIntegration.production.test.ts (integrations/t3/gates/native-acceptance.ts:14–19), and CI selects current native/continuation/local-job tests (scripts/ci-web-validation.sh:5–6,19–22). Do not remove those with the archive. NativeUsageAccounting has no current overlay diff (tests/t3/bruv-branding.test.ts:12–14 enforces this). Read-only upstream retrieval returned 404 for NativeUsageAccounting.ts at the current pin; ProjectionStore.ts returned 200 and has no nativeThreadUsageReport/readNativeUsageReport references. Thus do **not** describe its omission as an upstream adoption: the historical native aggregation is absent, while CI still names its old test at line 22. That stale-looking CI entry needs separate verification, not savings credited here.

**Action/behavior lost:** Optional archive/reproduction feature cut, not a runtime feature cut: remove this historical candidate only after other reviewers finish the patch and the parent decides whether Git history suffices. Do not delete just these hunks: that would leave an invalid/incomplete historical patch. No current executable behavior identified as dependent on these bytes; historical provenance/clean-apply reproduction is lost.

**Savings:** Conservative gross/net **2,908 reviewed added nonblank, non-comment code lines** as archived maintenance text, zero replacement. Another 275 removed-code and 772 context-code occurrences were examined but are not credited; no headers, comments, prose or unread lines counted. **Current executable LOC savings: 0.** Whole-patch savings remain for the joined audit. Do not add P2-02 to this alternative.

**Checks before removal:** Recheck current roots/references, preserve provenance in version control, confirm archival reproduction is not a supported workflow, join all patch coverage, and retain current cancellation/authentication/replay/process-teardown checks. Current/native gates must keep their machine-readable evidence contract (native-acceptance.ts:122–145).

### P2-02 — One tested owner for trusted lineage derivation (high confidence duplication; medium confidence net estimate)

**Assigned evidence:** ProviderSessionManager.ts patch lines **8545–8590** performs a role/depth ancestry walk with cycle, relationship, app-owned, marked-profile, terminal and disposed checks. A parallel creation-side walk is at **6213–6262**, under the delegated mutation permit **5673–5676,6446–6454**. Cross-reference historical DieDelegationPolicy.ts patch **629–663** already defines the same role/depth traversal; references to deriveDieDelegationPolicy in the archive patch are its tests and declaration, not the manager's production caller. The tests therefore exercise a duplicate implementation rather than this manager loop.

**Shipped comparison:** The duplication survives branding: integrations/t3/upstream/bruv.patch **617–651** has deriveBruvDelegationPolicy, while **5666–5704** repeats its traversal in the manager. Search finds helper references in its policy tests/declaration, not a production invocation. The creation-side locked fence also survives at **5212–5257**. This is a current ownership simplification opportunity, not just archival tidying.

**Action:** Make one Effect-native, cancellation-preserving lineage-policy helper the manager's implementation and test that exact helper. An initial projection or loader can preserve independent native-child retention identity. Consider sharing creation-side predicates later, but do not move its reads outside the existing mutation/thread locks or replace its durable cancellation fence with a cached credential policy.

**Counterevidence/security boundaries:** These walks are not interchangeable merely because they look alike. Creation-side validation accepts the prompt marker prefix; credential derivation parses a valid profile and computes depth. Invalid/terminal lineage must still return no delegation capabilities, but native-child idle identity remains independently true (8549–8550,8601–8616). Credential reuse requires exact capabilities/profile/depth (8640–8648). The denial tests at **7455–7608** specifically prevent fallback to generic credentials. Preserve fail-closed logging/error behavior, root policy, cycle rejection, credential rotation and cancellation timing. Avoid hiding Effect cancellation behind an uncontrolled Promise adapter.

**Behavior lost:** None intended if only credential derivation is unified. Do not silently tighten creation-side marker semantics as part of this cleanup.

**Savings:** Gross **44 reviewed added code lines** in the manager derivation body (8546–8589); estimated net **20–30** after preserving identity loading, Effect-native call/adaptation and root/error semantics. No savings from cross-reference helper/tests or creation-side lines credited. Current shipped loop has 38 code-bearing lines (5667–5703 plus the closing generator line); its separate net should be measured from an actual refactor, not counted as 44. Alternatives overlap with archive retirement.

**Checks:** Pure policy cases against the exact production helper; terminal/disposed/forged denial and rotation tests; child-retention behavior when policy is denied; deterministic spawn-vs-cancel race and replay checks. No live provider needed for the policy extraction itself.

## Reviewed inventory / retained boundaries

| Patch lines | Represented code | Verdict beyond archive retirement |
|---|---|---|
| 4401–4599 | LocalJobNotification.test.ts | Historical replay/Stop/attention tests; preserve equivalent active assertions. |
| 4600–5308 | NativeDieIntegration.production.test.ts | Archived real-process loopback integration; keep current native acceptance gate. |
| 5309–5483 | NativeUsageAccounting.test.ts | Historical accounting and liveness tests, not unused in the candidate. |
| 5484–5613 | NativeUsageAccounting.ts | Historically consumed by snapshot assembly; absent from current overlay/base. |
| 5614–6469 | Orchestrator.ts | Preserve mutation permit, ancestry fence, ownership validation and durable receipts. |
| 6470–6506 | ProjectionStore.test.ts | Historical snapshot cost assertions. |
| 6507–6596 | ProjectionStore.ts | Historical accounting consumer; all-table snapshot scan is not necessary to delegation ownership. |
| 6597–6614 | ProviderAdapter.ts | Preserve exact-owned-process emergency teardown contract. |
| 6615–6743 | ProviderContinuationRequests.ts | Preserve bounded admission, shared byte budget and interruption-safe reservations. |
| 6744–7003 | ProviderContinuationService.test.ts | Preserve backpressure, sibling fairness, replay and available-tool assertions. |
| 7004–7180 | ProviderContinuationService.ts | Preserve scoped workers, retry slot ownership and byte release; no proven dead retry map. |
| 7181–8228 | ProviderSessionManager.test.ts | Preserve credential denial and owned-PID lifecycle assertions. |
| 8229–8800 | ProviderSessionManager.ts | Duplicate lineage derivation candidate; retain fail-closed credentials, independent child retention identity and explicit overflow failure. |

NativeUsageAccounting is not historically dead: ProjectionStore imports it at 6515, calls it at 6559–6565 and enriches both snapshot paths at 6573–6575 and 6592–6593; the tests at 6498–6503 assert cost visibility. Its full-table queries at 6535–6541 would be an explicit optional accounting cut or query-scope redesign, not an unused-function deletion. No additional savings claimed.

Continuation queue/byte reservations and the two scoped retry workers (6713–6740,7093–7180) replace unbounded/fiber-per-failure behavior; retain them when supporting that candidate. A tempting retry-map leak claim was rejected: cross-reference .cache/die-t3code-v2-production/apps/server/src/orchestration-v2/ProviderContinuationService.ts:85–113,135 shows terminal and successful dispatch clear attempts. The cache is historical evidence only, not the current pin.

Likewise do not infer every archived safeguard is already shipped: pinned upstream ProviderContinuationRequests.ts:69 still uses Queue.unbounded; ProviderSessionManager.ts:1230 also uses an unbounded subscriber queue. These historical/current differences were observed statically, not tested, and are not reduction recommendations. Removing historical bytes is not permission to weaken any active cancellation/recovery/authentication boundary.

## Completion

Coverage ledger records 13 contiguous subranges covering exactly the assignment; no other patch ranges credited. Only this report and its coverage JSON were written. Wisdom/values remain unchanged because this is a read-only audit.
