# Archived candidate patch: assigned-range reduction audit

## Scope and completion

Read `wisdom/experiments/t3/production-v2/archive/.agents/patches/t3-v2-production-candidate.patch` **lines 1–4400 inclusive, all 4400 lines**, in 55 bounded, numbered chunks (at most 3800 bytes of numbered text per chunk). The opening chunk was reread separately after its initial combined output preview. No assigned lines depend on truncated output. Read wisdom/values.md first; wisdom/prose is not an audit target or savings source. **This is not a review of the whole 12,861-line patch.** The last section, LocalJobNotification.test.ts, continues beyond this assignment; its unread assertions are not evaluated or counted.

All citations to “patch” below mean physical lines in this archived patch, not the resulting upstream source-line numbers. Ledger entries partition the assignment by diff section. Static searches, bounded source reads, and path-existence checks only; no tests, builds, paid/live/provider calls, production edits, or commits.

## E2P1-F1 — Optional cut: retire the historical candidate artifact, not the live feature

**Evidence.** The assigned payload includes auth (patch:1–299), explicit embedded CLI launch (300–359), delegation policy/service and tests (483–1689), MCP registration/credentials (1690–2326, 2798–3048), replay/cancellation changes (2327–2797), Pi shell projection/usage/transport (3084–4061), and delivery/notification code (4076–4400). These are historical candidate hunks, not independently loaded modules in this repository.

Current owners are explicit:
- package.json:13–17,25 selects scripts/build.ts and integrations/t3/build/build.ts; scripts/build.ts:6,29–38 uses the canonical build and packed web output.
- integrations/t3/build/build.ts:6,49–53 selects upstream/source.json and upstream/bruv.patch. scripts/packed-web.ts:39–44 hashes/verifies the same pair. integrations/t3/build/verify-source.ts:20–29 checks HEAD plus that patch and rejects untracked source.
- tsconfig.json:11 includes src, scripts, integrations/t3, and tests, not experiments.
- src/t3/web/launcher.ts:178–185 dynamically loads the extracted runtime and dist/bin.mjs, not the archived patch.
- Migration is a real historical consumer, but integrations/t3/gates/migration-acceptance.ts:11–24,71–88 gets the shipped canonical patch from commit 92f1f2bc543ef148a5d254c20c95e6ba8b9aa4be and hash-constrains even an explicitly supplied production patch. It does not select this candidate artifact by default.

Repository-wide non-prose searches for the candidate filename, its source/export manifest names, and production-v2/archive found only archived exporter/builder references and archived export metadata. Broader patch-loading searches found canonical build/cache verification and other old experiments, not a current candidate loader.

**Counterevidence.** Standalone archived scripts explicitly reference the candidate: wisdom/experiments/t3/production-v2/archive/scripts/build-candidate.ts:5–17 and export-candidate.ts:6–11. Do not call the code universally unused. After relocation their root calculation resolves the candidate to production-v2/.agents/patches (missing), and imports resolve to missing archive/web-source.ts and production-v2/src/t3/web/archive.ts. They are historical recipes requiring path repair, not evidence of a currently working build dependency. Explicit external scripts/environment overrides or manual patch application remain possible and were not observed.

**Shipped comparison.** integrations/t3/upstream/bruv.patch retains renamed BruvWebAuth (108–179), lineage-based BruvDelegationPolicy (584–708), BruvTaskService (1431–2042), least-privilege MCP issuance (2127–2176), ancestor-authority cancellation (2459–2478), local-shell-only ownership (2992–2998), and native completion read instructions (3366–3390). This is an evolved overlay, not proof that every historical hunk has an identical shipped implementation.

**Recommendation/confidence.** High confidence that the archived artifact is not a default current executable/build input; medium confidence in unconditional retirement because historical reproduction is an optional capability. Parent should join the other reviewers before proposing whole-file deletion. Do not delete just these 4400 lines: that would corrupt a patch. Keep canonical overlay/build/tests as owners, rather than maintain a second candidate source.

**Behavior lost.** Convenient reconstruction/export/hash provenance of this non-adopted historical candidate, including its old tests. No observed default production behavior lost. If historical reproduction is required, keep the artifact frozen rather than “simplifying” its code.

**Gross/net savings.** Assignment-only attribution: **3830 nonblank, non-comment code-bearing patch payload lines gross and net** if retired with no replacement: 2819 added, 304 removed-side, 707 context-side lines. This is physical archived code representation, **not 3830 unique executable source LOC**. Headers, hunk metadata, blanks, and comment-only lines are excluded; unread tail and cross-references are excluded. Current executable LOC savings: **0**. Whole-artifact totals belong to the parent; do not add this attribution to a separate whole-file estimate.

**Checks needed before deletion.** Join full coverage; decide whether historical reconstruction remains supported; coordinate archived builder/exporter references rather than leave dangling entry points; rerun current patch-input and migration-baseline static checks. No live/provider test is justified merely by retiring an unreferenced archive. Preserve Git history and canonical migration baseline.

## E2P1-F2 — Conditional, low-value local simplification; do not rewrite frozen history

Patch:3505–3518 returns the same spread/token fields twice, differing only in usageStatus. If this candidate were revived as maintained source, a single return with usageStatus selected by terminalStatus === "completed" && allTokenFieldsKnown preserves the behavior. **Confidence: high locally.** The normalizer is not dead within the candidate: patch:3682–3685 calls it; patch:3103–3144 tests additive totals, failed/absent usage and missing cost.

Gross removal: 14 code lines; replacement: 6 with a one-line status expression; net: **8 archived source lines**, **0 current executable lines**. This overlaps F1 and must not be added. Behavior lost: none expected; checks needed: focused pure usage-normalization tests if revived, preserving complete/partial/unavailable and unknown-cost semantics. Current bruv.patch has no normalizePiTurnTokenUsage/ownUsages hunk matching this historic implementation; no shipped equivalence or shipped reduction is claimed. Recommendation: do not spend maintenance effort re-exporting a historical snapshot for eight lines.

## E2P1-K1 — Keep behavior and boundaries; not reduction candidates

The assigned code is connected internally: MCP imports/provides the task service (1698,1706); handlers call all five APIs (2812–2840); tools register them (3041–3045). Scope/depth/ownership checks (1369–1386,1451–1489,1549–1571) and no-ACK observation (1613–1623) are not interchangeable with generic MCP access or consuming reads. Tests include sibling-safe subtree cancellation and launch races (773–1125), stable local wakes and cross-thread rejection (1127–1253), and persisted cancellation before interruption (2428–2517,2673–2741,4120–4149).

Keep exact-origin/loopback enforcement (130–168,247–285), durable replay identity (2574–2609), completion ownership (2660–2665), ancestor-first cancellation (1662–1676), shell-vs-agent separation and stable item IDs (3588–3671), and explicit bounded transport failure/exact-child reaping (3859–3869,3876–3901,3913–3986). No removal of these behaviors or their maintained tests is proposed. Separate notify transport and model-tool exclusion (4005–4018) is an ownership/security boundary, not pointless duplicated registration. Savings: **0**.

No wisdom/value changes: read-only audit and no new production lesson requiring edits.
