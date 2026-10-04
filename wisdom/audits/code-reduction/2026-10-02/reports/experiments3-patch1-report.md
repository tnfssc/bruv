# experiments3-patch1 audit

## Scope and result

Read **all 2,700 assigned numbered lines (1–2700)** of `wisdom/experiments/t3/production-v2/archive/.agents/patches/task-d8a00b29-backend-refinement.patch`, including both removed and added diff text. No claim over lines 2701–5284. The final assigned section ends mid-hunk; conclusions about that section are limited accordingly. Read `wisdom/values.md` and the relevant build/export roots. Static inspection only; no source edits, builds, or live tests.

**No behavior-preserving executable-code reduction established in this range.** One product-safe historical-artifact retirement candidate exists. Formatting churn is not counted as maintenance reduction. Patch text is not executable LOC.

## E3P1-01 — Retire the inactive incremental refinement snapshot, if historical replay is no longer required

**Location:** `wisdom/experiments/t3/production-v2/archive/.agents/patches/task-d8a00b29-backend-refinement.patch:1–2700` (owned portion only).

**Verdict:** safe for current product inputs; conditional on retiring this historical snapshot, not an unconditional dead-code deletion. Delete the artifact as a whole only in coordination with the reviewer of its remaining range. Do not delete just this prefix: that would corrupt the retained patch.

**Evidence:**

- `wisdom/experiments/t3/production-v2/README.md:3` explicitly identifies the backend-refinement incremental patch as preserved history, **not an active input**. Lines 5–10 say archived paths were preserved, require intentional porting before reuse, and are not current gates.
- Current invocation: `package.json:13–15,25` selects root build/check/test and `integrations/t3/build/build.ts`. `scripts/build.ts:6,32–41,45–46` uses the maintained web builder, then compiles `src/cli.ts`. `tsconfig.json:11` includes maintained integration/scripts/tests/src, not experiments.
- `integrations/t3/build/build.ts:52–79,102–108` selects `integrations/t3/upstream/source.json` and `integrations/t3/upstream/bruv.patch`. Current revision is `66a91077f9abf6e171aad0ceab2519d7272f3ff3` (`source.json:3`). `integrations/t3/build/verify-source.ts:20–29` requires HEAD plus the canonical patch and rejects extra source. `scripts/packed-web.ts:39–52` hashes the canonical integration tree, not this archive.
- Historical invocation is different: `archive/scripts/build-candidate.ts:8–18,32–46,54–66` uses `.cache/die-t3code-v2-production`, the **candidate** patch and historical manifest, explicit `T3_V2_BUILD_CANDIDATE=1`, old Die outputs, and legacy deploy. `archive/.agents/patches/t3-v2-production-source.json:3` pins `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`. `archive/scripts/export-candidate.ts:9–11,35–48` exports/verifies that candidate; `export-worktree.ts:5,9,55–56` exports old `web/t3.patch`. None selects this incremental refinement patch. Hidden-file reference searches over source, scripts, tests, integrations, workflows and experiments found no named runtime consumer. This supplements explicit entry-point tracing; absence of imports alone is not the argument.

**Counterevidence / loss:** `wisdom/experiments/t3/production-v2/README.md:3` promises byte-for-byte historical retention. `archive/.agents/patches/t3-v2-production-README.md:8–21` records historical adoption, validation and snapshot tooling. Removing this file loses the exact incremental diff/blob identities and the ability to replay or investigate that refinement directly. Matching current logic is not byte-for-byte historical replacement; cancellation has evolved. Out-of-repository/manual patch use was not disproved. No need to retire the entire lab or its candidate builder to retire this one snapshot, but keeping the historical replay contract means keeping it.

**Estimate:** gross **2,700 archive-text lines** attributable to this reviewer; net **2,700 owned archive-text lines** if the whole artifact is retired with no replacement (before shared documentation bookkeeping). **0 live executable lines**, no build/runtime speedup demonstrated. If snapshot retention remains required: gross/net **0**. Remaining patch lines are outside this claim; do not double-count whole-file deletion across reviewers.

**Checks before removal:** agree explicitly to retire this snapshot; rerun hidden/path and dynamic-directory consumer searches; coordinate the remaining-range verdict; adjust the archive inventory without rewriting historical evidence; confirm the diff changes no canonical pin/patch/bootstrap, source guard, gate, candidate manifest or rollback snapshot. If replay remains required, retain the bytes instead. No broad build/live gate is needed merely to remove an explicitly excluded historical artifact; source-boundary changes would require their maintained focused checks.

## Retain behavior; do not turn archive retirement into product deletion

Below, **P** means `wisdom/experiments/t3/production-v2/archive/.agents/patches/task-d8a00b29-backend-refinement.patch`; line numbers are physical patch lines, not reconstructed upstream source lines.

| Assigned range | Reviewed behavior / verdict |
|---|---|
| P:1–50 | Separate delegation capability and trusted profile/depth scope. Keep live equivalents; not mere type clutter. |
| P:51–334 | Token revocation, separate browser/device grants, expiration, turn liveness and restricted-credential regression tests. No assertion deletion justified by formatting churn. |
| P:335–617 | Restrict-to-capabilities issuance (343–346,439–452), token hashing/pruning, synchronized state, touch and revocation. Removing the restriction would reintroduce baseline generic orchestration authority. |
| P:618–1437 | Durable replay identity test (626–652), generic-capability denial (708–714), nested-work acknowledgment and cancellation/disposal failure checks. Similar setup does not make these behaviors duplicate. |
| P:1438–2295 | Thread-based command/thread/message IDs (1614–1649); runtime/interaction non-escalation (1594–1613); user-authored cross-project read authority (1765–1811); async launch must not consume completion (2070–2079); partial-read acknowledgment boundary (2219–2239). Keep these recovery/privacy boundaries. Remaining wrapping changes are not a reduction finding. |
| P:2296–2343 | Native launch/observe/cancel/list handlers delegate to DieTaskService. Thin routing is real tool wiring, not dead code. |
| P:2344–2434 | Exact published schema tests, including required launch identity/profile and bounded listing fields. Keep contract evidence. |
| P:2435–2538 | Native tools and toolkit registration: asynchronous delivery, non-consuming observe/list, subtree-only cancellation, bounded paging, readonly/destructive/idempotent metadata. Folding into generic delegation would change the authority and observation contract. |
| P:2539–2700 | ProviderSessionManager imports for trusted policy/binary plus settings/project access handling. Preserve browser/device override and failure-withholding boundaries visible in removed/context text (2640–2688). Added body continues outside this assignment; no whole-function simplification claim. |

Current counterparts remain maintained: `integrations/t3/upstream/bruv.patch:2066–2176` retains Bruv capability/policy and least-privilege issuance; `2399–2434` retains durable thread identity; `2748–2785` retains native asynchronous/non-consuming/subtree tool contracts; `5739–5761` requires exact scope/policy equality before credential reuse. Its `2459–2517` cancellation now persists durable authority before interruption, unlike the historical failure/disposal sequence. Do not revert or delete these current boundaries as supposedly redundant copies of an archived patch.

## Accounting and limitations

Recommended unconditional live-code gross/net deletion: **0/0**. Conditional snapshot retirement: as above, archival bytes only. No claim that standalone scripts are dead because they lack imports; their explicit historical invocation was read. No canonical-patch replay, build, provider/browser execution or historical reproduction was performed. No wisdom/values change: this is an evidence audit, not a new lesson or prose-cleanup task.
