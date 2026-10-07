# Task-history model-context restore

Follow-up to [task-history resource fix](task-history-resource-fix.md), based on production base 019bd94b. Task binding alone is not the SDK startup path.

## Restore only model-bearing originals

The disk adapter's buildSessionProjection still materialized every custom checkpoint in its retained root branch and made a full branch-sized skeleton array for the SDK usage estimator. Real createAgentSession also read getBranch twice for thinking/model selection. AgentSession did the same for request thresholds, virtual router state, response identity/recovery, compaction preparation, and boundary previews.

Model projection now uses bounded newest-first parent walks to locate the latest compaction and its exact kept range before collecting candidates. Settings are derived from all active-branch indexed metadata, including summarized messages. Model-bearing messages, custom_message, branch_summary, compaction and context_edit are parsed; task checkpoint/cache/task-row/instruction custom bodies are not. buildContextEntries retains the manual-shake record needed by the live context extension. Indexed selectDiskBackedEntries preserves original branch/context indices without a full branch copy or visited-ID set. Context identity and custom-record searches also use resident-entry-count cycle bounds.

Public getEntry/getEntries/getBranch remain original-history APIs. Files and resident metadata are never rewritten by context reads. An auxiliary firstKeptEntryId remains a tiny metadata boundary in private branch views, not a parsed body. Older retained compactions remain archived entries; only the newest contributes messages.

## The guarded SDK seam matters

New exact-hash adaptations in scripts/pi-host-adaptation.ts route SDK readers through dedicated settings, active model-branch, latest matching custom-record, and private preview views. In-memory managers keep their native full-branch behavior. Settings selection preserves the SDK's virtual model rule: physical responses do not replace a registered virtual model_change, and failed pi-virtual responses do not select a physical model. Router restore reads newest candidates until the requested provider/model scope matches, not all router records.

SDK compaction preparation and boundary previews reconstruct a path using parent IDs. Filtering rows without relinking private copies silently loses context. The preview view relinks copies and carries indexed thinking/model settings; it does not mutate originals. Usage still comes from the pinned SDK estimator, using the real projection and a compact type/id branch view. This preserves invalidation by later edits, post-compaction unknown usage, valid assistant usage and trailing-message token estimates; no budgets change.

Do not add these changes to the npm package patch: core files already have guarded host adaptations with source hashes, and changing package source first bypasses that ownership. Extend the existing host seam, then verify from pristine source. Bun's installed/cache state can retain prior host changes; a warm forced reinstall is not proof of a clean adaptation. Exact original and adapted hashes must both validate.

## Focused proof

New tests/history-model-context.test.ts builds 100,000 opaque auxiliary records interleaved through a branched session and starts a real createAgentSession. It rejects auxiliary DiskEntryStore.materialize calls during startup (including summarized settings and persisted virtual selection), request preparation, threshold checks, model previews, cancelled real compaction preparation, committed compaction drafts, and scoped virtual routing. It compares native SDK messages/settings/usage through originals, replacement/drop edits, compaction unknown usage, fresh usage, repeated compaction, and a sibling branch. SHA-256 checks keep the journal exact during reads; appended edits/compaction drafts preserve every original prefix byte. An auxiliary first-kept boundary is exercised without parsing its body. Explicit getEntry checks retain original user/tool/custom_message and checkpoint content.

Use pinned Bun 1.4.2 and Node 24.21.0. Full captured-original measurement remains parent/supervisor work; this worker does not replay the real journal or change harness budgets. Values stay unchanged: the existing bounded-use/no-quiet-loss and real-path proof rules already cover this lesson.

A synthetic negative control restored only the SDK startup getBranch readers: the real 100,000-row regression failed at its auxiliary-body guard. The restored bounded implementation passes.

Integration dependency: src/agent/manual-shake.ts:770 still calls getBranch in its session_compact handler to find the prior shake marker. This agent does not own src/agent/* and did not change it. The extension worker must replace that lookup with latest matching indexed custom-record selection (keeping invalid-record/session-scope semantics). Explicit original-history surfaces remain intentionally materializing APIs.

Validation: a clean-cache dependency install with --backend copyfile, bun run check, and bun run build passed. The focused history/usage/projection/model-context, native/manual/automatic shake SDK, current-pipeline/cache-affine compaction SDK, rolling-activity, and Pi-host suites passed (159 tests across 13 files). No real-original replay was run here.
