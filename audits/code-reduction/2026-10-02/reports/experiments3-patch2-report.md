# experiments3-patch2 — read-only reduction audit

## Scope and result

Read every numbered patch line **2701–5284 (2,584 lines)** in bounded, non-truncated chunks, plus targeted callers and build/invocation roots. Only that assigned range is claimed; supplemental excerpts are not exhaustive coverage of other files. Read all of wisdom/values.md. No source edits, builds, live tests, or script execution. Values remain unchanged: this is a maintenance audit, not a wisdom cleanup.

**No unconditional active-runtime deletion established in this range.** One coordinated historical-asset retirement and one duplicated-policy consolidation opportunity follow. Counts distinguish stored diff text from executable source; formatting expansion is not maintenance reduction.

All patch references below mean **experiments/t3/production-v2/archive/.agents/patches/task-d8a00b29-backend-refinement.patch** (physical patch line numbers), not the target checkout's line numbers.

## Build and invocation evidence

- package.json scripts build/check/test/build:web select scripts/build.ts, scripts/prepare-assets.ts, root tests and integrations/t3/build/build.ts. scripts/build.ts:6 imports the canonical builder. tsconfig.json:11 includes src, scripts, integrations/t3 and tests, not experiments.
- integrations/t3/build/build.ts:49–80 selects BRUV_T3_SOURCE or a revision-keyed Bruv cache, integrations/t3/upstream/bruv.patch, pinned HEAD, clean/reverse application checks and source verification. integrations/t3/upstream/source.json:2–4 pins 66a91077f9abf6e171aad0ceab2519d7272f3ff3. .github/workflows/ci.yml:127 and release.yml:131,135,251–253 use these canonical inputs. scripts/ci.sh:37–63 runs normal root checks/build/tests/smoke.
- experiments/t3/production-v2/README.md:3 explicitly identifies the backend-refinement and model-selection patches as preserved incremental history, **neither an active input**; :5–10 says archived probes retain old paths, need intentional porting, are not release gates, and the archive is not automatically executed.
- Counterevidence to an import-only “dead” claim: archive/scripts/build-candidate.ts:8–18 has a standalone candidate-cache/patch/pin path and T3_V2_BUILD_CANDIDATE=1 opt-in, verification and hashing; :32–41 typechecks/builds/rechecks its reviewed candidate. It names t3-v2-production-candidate.patch, not this incremental patch. The relocated imports/root arithmetic still describe the old location; do not run it merely because it has an entry point.
- archive/.agents/patches/t3-v2-production-README.md:3–8 records the older a9b49a7 pin and old canonical export, :17–21 documents a direct build command and reusable candidate helpers. That is historical invocation/provenance, not today's release route. A targeted reference search found this incremental filename only in the production-v2 archive README within experiments/wisdom/integrations/scripts/tests/.github and root config searched; this is corroboration, not proof against manual git apply or external users.
- integrations/t3/README.md:6–12,26–30 establishes one current input/build and historical experiments; :39–44 expressly keeps least-privilege task policy and durable cancellation/replay. The current patch still contains analogous native task/policy code: this archive's non-use does **not** imply those features are removable from production.

## E3P2-F1 — retire the historical incremental replay asset, only by explicit choice

**Location:** patch:2701–5284, all seven covered sections. **Verdict:** runtime-disconnected historical asset; remove only with retirement of this backend-refinement replay/provenance path and coordination with the reviewer owning lines 1–2700. Do not delete only the assigned tail or individual hunks from the preserved patch.

**Evidence:** build/invocation separation above; archive README explicitly excludes this incremental input. Keeping this file does not impose a current compiler/build/runtime branch. **Counterevidence:** byte-for-byte historical preservation is intentional; the patch records native wire contracts, authorization and task behavior useful for reconstructing an old checkout. Standalone candidate scripts and manual patch application are legitimate historical consumers even without imports.

**Gross/net estimate:** attributable to this review, **2,584/2,584 stored patch lines**, approximately **104,400 bytes**, if whole-file retirement adds no replacement. If a short retirement manifest is wanted, subtract its lines from net. The file is 5,284 lines, but the other 2,700 lines are another reviewer's contribution, not additional savings claimed here. Active executable LOC/build savings: **0**. Do not add F2's hypothetical source saving to this text-saving total.

**Behavior lost:** reconstructing/applying this exact incremental historical backend revision and inspecting its original tests/contracts; no current shipped behavior expected to change from the traced roots. This need not retire every production-v2 artifact, but it does retire this lab replay input. Keep rollback snapshots, candidate manifests and user recovery data outside this recommendation.

**Checks before removal (not run):** confirm no maintained/manual reconstruction instruction needs this filename; coordinate whole-patch ownership; preserve a Git revision/hash reference if replay remains valuable; repeat source/config/documentation reference checks, confirm canonical pin/patch/launcher unchanged, then use ordinary offline root checks. Do not execute or “repair” archived candidate scripts as a removal check. Runtime acceptance is unnecessary unless canonical inputs also change.

## E3P2-F2 — one owner for lineage-policy derivation in any revived implementation

**Location:** patch:2805–2852 (ProviderSessionManager inline derivation); :4459–4491 (DieDelegationPolicy.ts exported Promise derivation); :4570–4573,4612–4650 (tests of that helper). **Verdict:** duplicated security algorithm, conditional consolidation, not archive text surgery.

**Evidence:** both implementations walk persisted parent/subagent edges, detect cycles/non-subagent relationships, parse the marked edge prompt, keep the nearest profile and accumulate depth. The manager imports only profileFromMarkedPrompt (:2547, supplemental caller read). All occurrences of deriveDieDelegationPolicy in this patch are its declaration and policy tests; credential preparation instead runs its inline copy. Thus the tests exercise a parallel implementation, not the credential owner's algorithm.

**Reduction:** in an intentionally revived checkout, make one Effect-native lineage resolver used by credential preparation and those tests; retain the manager's trusted process/provider gate, catch/log/withhold outcome and caller-owned loading. Remove the parallel Promise implementation, not authorization checks. Avoid a detached Effect.runPromise bridge that changes interruption or service lifetime.

**Gross/net estimate:** roughly **32 duplicated source lines gross; 15–25 source lines net** after a typed shared call/adapter and test fixture adaptation. This is a planning estimate, not a regenerated-patch count; current archive reduction is **0** while byte-for-byte preservation remains required. Runtime behavior lost should be **none**; eliminating the isolated helper without moving its tests would lose meaningful policy assertions and is not recommended.

**Counterevidence/boundaries:** Promise and Effect loading/error/cancellation contracts differ. Sharing must preserve them. Current integrations/t3/upstream/bruv.patch:618–651 and :5666–5711 has analogous duplication **and additional app_owned/terminal/disposed-edge checks**; this is comparison evidence, not an additional finding or owned savings claim. Never port the historical weaker predicate over those current checks. Current :5712 onward also explicitly addresses fail-closed reopening; old :2853–2862's orchestration fallback is not a template for simplification.

**Checks (not run):** targeted policy and credential-manager tests against the actual shared resolver: trusted/untrusted provider, root, marked/unmarked/missing edge, non-subagent relationship, cycle, nested nearest profile/depth, loader failure, interruption and credential reuse/rotation. If applied to current production by its owner, also preserve app_owned, terminal/disposed denial and fail-closed reopening. Export via the canonical Git exporter, not hand-edited diff/hashes.

## Exhaustive section dispositions

| Patch lines | Content read | Disposition |
|---|---|---|
| 2701–3763 | Settings, credentials, subscribers, session release/idle/open/attach/activity | Keep behavior if lab retained. Only lineage duplication above is a substantive consolidation candidate. Formatting churn elsewhere is not a finding. |
| 3764–3897 | MCP contract tests | Keep required field/profile/exact result-key assertions; lose only with feature/lab retirement. |
| 3898–4412 | Existing orchestration contracts plus native task schemas | Keep stable clientRequestId, numeric/output/page limits and result identifiers. Tiny observe/cancel shape equivalence is not worth a new abstraction. Reserved timeout is explicitly rejected, not permission to silently ignore it. |
| 4413–4558 | Policy/profile selection | Keep trusted config path, ENOENT-only inheritance and malformed-config/model/thinking rejection. Consolidate lineage only as F2. |
| 4559–4650 | Profile/policy tests | Keep config and forged-lineage assertions; relocate lineage tests to actual owner for F2. |
| 4651–5013 | Native task service | Used by historical tools, not dead. Keep capability/ownership, async launch, replay conflict, bounded output/page, result transfer and subtree cancellation. |
| 5014–5284 | Task service fixtures/assertions | Keep async result shape, replay conflict, nondelegating profiles, depth, unsupported deadline, forged scope and descendant-first cancellation evidence. Mock-based assertions do not by themselves prove real persistence/recovery. |

Historical tool callers read: patch:2296–2337 and :2438–2539 wire launch/observe/cancel/list into service and toolkit. In particular, observe/list are intentionally non-ACK reads, not redundant completion delivery. Do not merge them with consumption/acknowledgment. Credential reservations/revocation (:2755–2950), draining end versus destructive close (:2990–3026), generation/runtime idle guards (:3111–3245), time-boxed release persistence (:3131–3162), attached-thread ownership and startup cleanup (:3301–3429), and pending-child-aware results (:4811–4852) are recovery/security boundaries, not speculative defenses to delete. The explicit request keys and scoped postorder cancellation (:4889–4906,4964–5009) similarly remain.

No tests were run and no runtime equivalence is claimed beyond static evidence. No prose/formatting reductions are counted.
