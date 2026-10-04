# Archived patch reduction audit — reviewer patch2

## Scope and completion

Read wisdom/values.md first. Reviewed **every numbered patch line 4401–8800 inclusive (4,400 lines)** from `wisdom/experiments/t3/production-v2/archive/.agents/rollback/t3-v2-lifecycle/web--t3.patch`, using consecutive bounded numbered output chunks (at most 3,850 characters, except the first 3,600-character chunk). All assigned chunks were displayed without output truncation. No claim of reviewing the rest of the 13,028-line patch. The first range is only the tail of PiAdapter.test.ts (its identifying diff header is at patch line 1258); the last range is only the prefix of PiRpcClient.ts. Cross-references were read selectively, not counted as assigned coverage or savings.

Read-only investigation: file reads, searches, Git object/revision inspection and arithmetic. No tests, builds, live/provider calls, production edits or commit. Only this report and the coverage ledger were written. Wisdom/prose was not audited or counted.

## P2-ARCHIVE — retire the obsolete rollback artifact, not the active Pi integration

**Recommendation:** parent may remove this archived patch as a whole after joining all reviewers and confirming that manual rollback retention is no longer wanted. Do not remove just this slice: that would corrupt the patch. Do not delete the corresponding shipped implementations based on this finding.

**Evidence (patch-file line numbers):**
- 4401–5042: model/steering/startup/resume/transport/mode regression test tail.
- 5043–7522: complete historical 2,474-line added PiAdapter.ts; owns sessions, file leases, RPC event conversion, tool/task presentation and cancellation.
- 7523–7983: historical provider tests and discovery implementation.
- 7984–8097: registry tests, child environment sanitization and PiDriver registration.
- 8098–8259: model slug implementation and tests; consumed at 5091, 7256, 7323, 7787, 7940.
- 8260–8800: RPC tests and implementation prefix; real historical callers at 5093–5099, 7045, 7308–7340, 7453–7495, 7905–7921. This is not a collection of uncalled utility APIs.

**Current consumer trace:**
- package.json:12–15,25 route CLI/web builds through scripts and integrations. tsconfig.json:11 includes src, scripts, integrations/t3 and tests, not experiments. Patch text is not a TypeScript compilation root.
- scripts/build.ts:6 imports the shipped web builder. integrations/t3/build/build.ts:49–79 explicitly selects `integrations/t3/upstream/bruv.patch`, pins its upstream checkout, applies that patch, and verifies it. Its packaging path uses that same patch (97–108,134–141). It does not load the rollback artifact.
- integrations/t3/upstream/source.json:2–4 selects upstream revision `66a91077f9abf6e171aad0ceab2519d7272f3ff3`.
- integrations/t3/gates/migration-acceptance.ts:11–13,71–88 anchors even caller-supplied production patches to a historical **shipped integrations patch** and verifies its hash. tests/t3-migration-acceptance.test.ts:11–15,38–47 supplies that shipped Git object through a temporary file, not this rollback path.
- tests/architecture.test.ts:60–78 requires integration roots and checks old web/t3.patch ownership paths are absent. Architecture source scanning is confined to src (line 9).
- Exact repository search for `web--t3`, `t3-v2-lifecycle`, and `production-v2/archive` in non-prose, non-patch files found **no matches** (excluding dependencies, caches, tool state and audit artifacts). Dynamic glob/patch-loading search across src/scripts/tests/integrations/.github identified fixture/cache scans and the migration override above, not an archive scan. No t3.json exists at the root. Archived standalone build/export scripts select old candidate or web/t3.patch paths, not this rollback filename. No current default executable/build/test consumer was found.

**Shipped comparison / simpler owner:** The shipped integrations patch no longer adds the old Layers/PiAdapter.ts, pi/PiModel.ts or pi/PiRpcClient.ts files. Instead it modifies the upstream orchestration-v2 adapter (integrations/t3/upstream/bruv.patch:2949–2966). Its shell bridge is deliberately shell-only: 2996–2998 and 3023–3028 say native T3 children own agent jobs, so agent snapshots must not become duplicate local cards. In contrast, this archived adapter translates multiple agent/workflow/extension formats (5986–6185,6253–6585) and both Die command/agent snapshots (6593–6680), dispatching all of them at 6699,6862–6864. The active overlay retains instruction-mode selection/preflight (current patch 6109–6124,3142–3161) and shell completion/settlement accounting (3023–3108,3122–3128). These are changed owners/protocols, not proof that delegation, modes, or background work can be dropped.

**Counterevidence / boundaries:** This is an explicitly named rollback artifact; a human may still value manual restoration even without machine consumers. Original registry registration at 8079,8095 proves the historical adapter was intended to run. Historical tests exercise real distinct boundaries: exact resume identity (4685–4720), interrupted startup/publication and one-writer lease (4751–4848), ambiguous prompt failure/identity drift (4885–4934), steering settlement races (4534–4613), interruption without lock blockage (4615–4653), and interpreter-environment isolation (8022–8031,8054–8069,8621–8628). These are not disposable safety code in the active system. No recommendation to weaken them. The pinned current upstream object was unavailable in the inspected local caches; therefore the comparison is to the **shipped patch**, not a claimed full review of current upstream implementations.

**Confidence:** high that no current default executable/build/test requires this particular file; medium that deletion is desirable without confirming rollback-retention policy.

**Behavior lost:** automatic/current runtime behavior: none identified. Manual reconstruction/reapplication of this precise historical Pi/Die integration: lost if the entire artifact is deleted and not otherwise retained. Existing Git history is not counted as verified recovery proof.

**Gross/net savings:** reviewed slice contains **4,052 added, nonblank, non-comment source-code records**. This is a conditional archival-maintenance reduction, not 4,052 lines removed from the current application. If the parent deletes the complete artifact with no replacement, gross/net contribution from this slice is 4,052 such records; **current executable LOC/bundle savings: 0**. Excluded from savings: patch metadata, blank/comment lines, 8 removed-source records, 47 context-source records, all unread lines and all prose. Full-artifact savings must be assembled by the parent, not extrapolated here.

**Checks before deletion:** join full patch coverage; confirm manual rollback policy; repeat exact references including any operator scripts outside the repository; verify CLI/web build roots and migration fixtures still reference integrations; use focused static architecture/patch-loader checks if a removal is implemented. Do not run paid/live gates for this archival cut.

## P2-FIELD — unused historical ActiveTurn.assistantText

**Evidence:** archived patch:5143 declares `assistantText: string`; 5704 initializes it to `""`. An exact search over the complete assigned PiAdapter.ts addition (5049–7522) found only those two references. ActiveTurn is private (5133); assistant text is streamed directly as content.delta (6723–6750), not accumulated in this field.

**Recommendation:** if this historical source is revived/retained for development, omit the field and initialization. No current production edit recommended; the active overlay uses a different upstream adapter.

**Counterevidence:** unknown future edits or downstream consumers of a manually applied historical patch could start using it; none exist within this historical implementation. Tests before line 4401 were not reviewed, so no whole-test-suite claim is made.

**Confidence:** high for this exact historical private field, not an assertion about current upstream fields. **Behavior lost:** none in the reviewed implementation. **Gross/net:** 2 source lines / 2, with no replacement; **not additive to P2-ARCHIVE**. Current executable savings: 0. **Check:** after any revival, search all object/field consumers and run only the isolated mocked adapter/type checks, preserving delta streaming.

## Retain / no further current feature cut justified

The remainder of the assigned code is inactive archival duplication, not evidence that its feature contracts are unnecessary. Models, usage, extension input, tool metadata, workflow/subagent projections and RPC operations have actual internal callers. The assigned RPC tests separately cover framing/unicode, malformed output, oversized lines, request correlation, transport close/EOF, timeout/late responses, serialized writes and child stdin/environment behavior (8317–8631). No deletion of active cancellation, permission, identity, recovery, framing or answer-resolution logic is recommended. No whole-file claim is made for the partial RPC implementation.

Coverage ledger: `artifacts/code-reduction-audit/experiments1-patch2-coverage.json` (12 consecutive nonoverlapping entries, total 4,400 lines).
