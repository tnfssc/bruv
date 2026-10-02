# Archived candidate patch — reviewer 3

## Scope and proof

Read wisdom/values.md first. Examined **every assigned physical line 8801–12861 inclusive (4,061 lines)** of `experiments/t3/production-v2/archive/.agents/patches/t3-v2-production-candidate.patch`, in continuous bounded numbered chunks ending at 12861. These include code, patch context, removed lines, comments and diff metadata; only code is counted below. This is **not a whole-patch review**. Coverage ledger partitions the assigned range by embedded file boundary (the first segment is only the tail of ProviderSessionManager.ts).

Read-only inspection only; no builds, provider/live/paid tests, production edits, or commits. Wrote only these two audit outputs. No wisdom/prose reduction proposed.

## E2P3-1 — Retire the archived candidate as an optional historical feature cut

**Evidence.** Assigned patch lines 9886–9920 contain DieWebPi.ts; 10468–10659 BunPtyAdapter.ts; 11102–11251 SubscriberStream.ts; 12781–12840 hostProcess.ts. They represent historical integration code, not modules imported from this patch at runtime. Current package.json:14–19,28 points normal builds/tests/web builds to scripts/build.ts and integrations/t3/build/build.ts. scripts/build.ts:5–6,32–38,45–46 imports the shipped web builder and compiles src/cli.ts. integrations/t3/build/build.ts:49–79,97–108 selects **integrations/t3/upstream/bruv.patch** for source preparation, verification and packaging. tsconfig.json includes src/scripts/integrations/tests, not experiments. Searches of src, tests, scripts, integrations and .github found no production-v2 or historical patch consumer (an unrelated dependency-updates candidate.patch is not this patch).

**Counterevidence / actual standalone consumers.** archive/scripts/build-candidate.ts:5–18 references the historical patch, candidate checkout and source pin; export-candidate.ts:6–14 writes that patch and export metadata. Therefore it is not honest to call the patch universally unreferenced. These are archived standalone workflows; their relative web-source imports and the build script's relative src/t3/web/archive import now resolve to absent files. They are already not self-contained runnable workflows in their archived location. Do not rely solely on their broken imports: formally retire or relocate the workflows when retiring the historical artifact. Scripts were inspected, not executed.

**Shipped comparison.** The current overlay has equivalent, not dead, code: BruvWebPi.ts at bruv.patch:5969–5999 (identity authority); PiDriver.ts:6008,6026–6029; native terminal selection at 6823; terminal subscriber consumers at 7209,7230,7244; hostProcess.ts:8233–8272. Entire added source bodies of BunPtyAdapter.ts (186 lines), SubscriberStream.ts (144), SubscriberStream.test.ts (167), and hostProcess.ts additions (34) compare identically after Die/Bruv name normalization; the 29-line provider helper also matches under that rename. BunPtyAdapter.test.ts and contracts are not identical. This supports **one maintained shipped overlay**, not wholesale deletion of shipped capabilities.

**Confidence:** high that this historical patch is not a current default build/executable input; conditional medium-high retirement recommendation because standalone reproduction is an explicit feature loss.

**Behavior lost:** reconstructing/exporting/building that non-adopted candidate from the archived patch; historical regression evidence tied to that revision. No demonstrated current product loss if only the historical artifact/workflow is retired. Retain Git history for provenance. Removing just this reviewer's tail would corrupt the patch: parent must join all range reviews before a whole-artifact decision.

**Savings:** within the assigned slice only, **2,069 nonblank added code-bearing patch payload lines gross/net**, if the whole historical artifact is retired with no replacement. This conservative scope excludes blank/comment-only lines, headers, removed lines and unchanged context; it is **archive text reduction, not executable LOC reduction**. No savings assigned to unread script bodies or other patch ranges. Current executable savings: **0**. Do not add this archive count to equivalent shipped-source cuts as if both were independent behavior removals.

**Checks before a cut:** parent joins remaining patch coverage; confirm intentional loss of candidate reproduction; retire its standalone build/export references and associated pins together; repeat tracked-file consumer search and static normal-build input checks. Keep the shipped patch and its tests. No live/build check was run here.

## E2P3-2 — Inline the SEA identity wrapper, retain interpreter isolation

**Evidence:** assigned patch:12804 defines `isHostProcessExecutable({isSea}) => isSea`; 12810–12813 passes a freshly computed SEA boolean straight through it. Tests at 12765–12768 only prove true maps to true / false to false. Shipped overlay repeats this at bruv.patch:8240,8246–8249; its only visible overlay callers are that default and the two tests (8195,8202–8203).

**Simpler ownership:** keep runtime detection in HostProcessIsExecutable's default: `defaultValue: () => process.getBuiltinModule("node:sea")?.isSea() ?? false`. Drop the one-line identity export. Preserve HostProcessIsBun, optional builtin access, and **all** with/withoutBunSelfExecEnvironment behavior (assigned 12797–12802,12818–12835). They separate interpreter children from normal compiled application children; they are not redundant safety code.

**Counterevidence:** wrapper is a public export and its tests are consumers. The actual current pinned upstream checkout was unavailable locally: git show of revision 66a91077… in the cached candidate repository could not resolve the requested paths. A search of the overlay is not proof that no base-upstream consumer exists. Complete that check before deleting the export; replace the tautological test with a runtime-default seam test rather than count test deletion as savings.

**Confidence:** medium; tiny actionable simplification, not a declaration of unused subsystem. **Behavior lost:** none intended; export surface changes. **Savings:** gross 5 production lines replaced by 1, **net 4** in the reviewed historical source shape (same shape is shipped); test rewrite savings uncounted. Separate from E2P3-1 archive savings. **Checks:** complete patched-checkout symbol search, focused host-process tests under Node and Bun; no need for paid/provider work.

## E2P3-3 — Duplicate enablement derivation already resolved in shipped integration

Assigned 9947–9951 computes effectiveConfig with applyDieWebPiSettings, then separately repeats dieWebBinary/enablement derivation; 9960 consumes effectiveEnabled. Helper at 9906–9907 already owns that decision. Current overlay:6026–6029 and **6049** uses `enabled: effectiveConfig.enabled`, avoiding a second owner. This is a historical cleanup opportunity only, **no new shipped change recommended**. Confidence high; no behavior lost if the historical expression is replaced, subject to existing settings tests. Historical gross 2 lines (extra binding/import adjustment), net approximately 1–2 depending on import formatting; **current incremental savings 0**, excluded from totals.

## Reviewed safeguards / no additional cut justified

- 8958–8983,9043–9098,9594–9601: release tombstones, owned-process emergency stop, credential revocation only after ownership ends, and reopen exclusion. Keep these boundaries; formatting churn is not redundant ownership.
- 9387–9392 and 10727–10887: bounded provider subscriber/terminal producer work. 10949–11101 exercises real upstream queue saturation, bytes and listener lifecycles. 11113–11250 plus 11347–11374 implements explicit terminal overflow, detach and draining; 11987–12031,12045–12081,12214–12238 provides recovery/resubscription. Do not replace with unbounded callback streams or silent drops.
- 9728,9795,11323,12391–12399: cancellation stays valid after a delegated task's own run settles; a run-only interrupt is not equivalent.
- 9910–9919,10062–10067,10196–10198: trust identity, exact binary version-floor exception, and auth-mode branching remain security/product boundaries. This slice does not establish the complete no-auth guard, so it does not justify removing authentication checks elsewhere.
- 11406–11439: direct delegated-child reload routing; 11529–11673,11962–11975,12125–12176: persistent shell lifecycle projection/cards. Not dead because omitted from sidebar/collapsed summaries.
- 11460–11510,12306–12339,12708–12713: cost UI/accounting contracts are connected in the historical patch. Explicit optional feature cut would lose own/subtree API-equivalent spend and missing/partial-cost semantics; **not proposed as unused**.
- 11682–11769,11800–11952: bounded handoff and syntax caches have real callers/tests. Absence of those paths from the current overlay diff does **not** prove absence from upstream; no current-source savings asserted.
- 12556–12629,12849–12858: native task wire/results, idempotency, pagination, notifications and presentation are integration-facing behavior, not unused solely because names are historical.

Total quantified current-source opportunity: **net 4 production lines, conditional** (E2P3-2). Archive reduction is a separate conditional **2,069 reviewed code-bearing addition lines**. Values/wisdom unchanged because this was a scoped read-only audit.
