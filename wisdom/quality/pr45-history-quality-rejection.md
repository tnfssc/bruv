# PR45 history/session quality-intent review

**Overall: REJECT — two bounded readability repairs, not a correctness-only verdict.**

Target: 0d8066e49868c82eb793a1248d055fd52a62037c (verified HEAD). Comparison anchors: accepted continuation a0d9ef19, PR base 22ad5f50. Actual model verified from this session's model_change record: **openai-codex/gpt-6.1-sol** (2026-10-08T15:00:18.418Z).

## Read scope and evidence

Read all final code in src/history/disk-entry-store.ts:1–920, service.ts:1–451, and session-manager.ts:1–1035. Final blobs respectively: d42aa1bc6dbeae6feeba797cb92d2515375cda6e, 5c0a4181560c83f46f0ad876eac109c415abbb47, 7dfee707975b4a451045e73371e61f5bd51aa038.

Adjacent actual-code reads: complete history/types.ts and selector-lifecycle.ts; shake-record.ts initial record-validation section (first 1,900 characters); cli.ts:209–258; claude-compat/runtime.ts:281–313; claude-compat/task-binding.ts:86–158. Read installed pinned SDK session-manager.js:201–259,819–835 and agent-session.js:3401–3472. Supporting test excerpts: history-truncated-branch.probe.ts:1–101,113–155; history-model-context.test.ts:102–127. Repository-wide symbol searches checked selector consumers and startup/view callers; those other callers were not fully reviewed.

Read values.md, structural-readability-guidance.md, original owner pilot, focused agent-history-session-goals notes and its three history judgment records. Read relevant disk-backed-history, history-adapter, history-main-findings, searchable-history, task-history-model-context and product-first integration notes. Used earlier ACCEPT reasons from judges task_0426dce8 / task_150357ad / task_4b35440e as historical evidence, not acceptance of changed blobs. Historical judge worktrees were unavailable here; this review uses their retained ledger records and fresh final-code reading. Compared original append and current integration deltas where useful; not claiming complete line-by-line review of both historical revisions.

Public guidance checked directly (HTTP 200): [Google, What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html), especially complexity/over-engineering and comments. Applied its present-need/read-understanding guidance, not arbitrary size scores. Values 3 and 7 and the pilot's authority/lifetime criteria drive the findings below.

## Required repairs

### R1 — Remove the spare context-selection engine

**session-manager.ts:314–361 — REJECT.** selectDiskBackedEntries is no longer called by shipped source. Repository search finds only its export, tests/history-model-context.test.ts:121 and tests/history-truncated-branch.probe.ts:96, plus historical prose. Actual UI callers use selectDiskBackedBranchEntries; actual model/context consumers use modelContextMetadata at :367–435.

This is not just an unused convenience wrapper: it retains another compaction/first-kept/system-message/index-order algorithm, complete with two walks and positional arithmetic. A reader following context restoration must decide whether this generic branch/context selector or modelContextMetadata owns the real window. Its tests keep that parallel implementation alive, but do not make it a shipped authority or an independent reference model: it operates on the same production store and reimplements the same selection decisions.

**Repair:** remove the unused production export and its duplicate range algorithm. Keep the native SDK as the independent reference; carry useful compaction-at-context-index-zero and malformed-gap/cycle assertions onto actual buildContextEntries/buildSessionProjection and existing shipped branch selectors. Preserve intentional omission of plain auxiliary custom records. This is product-code deletion with only necessary assertion migration, not a test-polish project or a new common-selector framework.

### R2 — Finish the single-owner append journey

**disk-entry-store.ts:761–800 and session-manager.ts:566–584 — REJECT, narrowly.** The store creates owned metadata inside the transaction at :775, then discards/recreates it through indexMetadata at :796 (which calls metadata again at :577). The first object supplies publication eligibility, the second becomes the committed index record. This needlessly splits preparation of one appended row and duplicates copying/metadata construction.

The manager additionally keeps previousCount plus a catch/re-sync branch at :572–579. Its comment describes publication failure leaving advanced indexes, but actual store rollback at :783–792 leaves entries/byId untouched on write/link failure and only advances them after commit. Native _appendEntry is bypassed on this owned path, so it does not advance the SDK leaf first either. That retained recovery machinery makes readers reconstruct a second commit model that the current implementation does not use. This catch predates integration; earlier acceptance does not make its explanation accurate today.

**Repair:** prepare metadata once within the existing rollback transaction, then perform post-commit interning/task-key registration on that prepared record. Keep mutating index bookkeeping out of the rollback region. Make the owned manager path plainly append, publish committed metadata, set flushed; remove obsolete count-based recovery and misleading explanation. Do not change collision/no-overwrite, byte rollback, or successful-link cleanup semantics. No speculative exception-recovery framework is requested.

## Accepted final structure to retain

**service.ts — ACCEPT.** Followed search/read → explicit scope → retrievalScan → membership in live active ancestry → pinned text branch → live shake exclusions → bounded original text → ranked/search or UTF-16 read page. :382–449 keeps those decisions together; :390–404 makes auxiliary cursor membership distinct from scan capacity and live policy. Ranking uses visible provenance (:302–306), not a generator side map. Cross-session read-only open/validation remains a separate real authority (:79–169), not SDK repair/migration disguised as retrieval. Guard and Unicode comments explain necessary semantics rather than generic defensive sludge.

**Store and manager outside R1/R2: accepted in this focus.** The byte parser (:175–399), compact custom metadata (:51–104), shared task keys (:576–636), and conditional cycle preflight (manager :226–275) are genuine complexity, but captured-journal notes identify the actual memory failure they solve. Replacing them with full JSON.parse, copied branch arrays or per-walk sets would revive that observed problem. Original bytes remain authoritative and materialization is localized (:818–842); do not delete optimizations just to lower line counts.

Startup reconstruction is legible: read/migrate/openStore → rescan → adopt → syncIndexes; append and rebuild share publishEntryMetadata (:166–194). Reset/branch detach the SDK's mutable map before native mutations (:890–924); recovery restores the previous owner's indexes/leaf. Rewrite distinguishes skeleton identity from full originals (:586–604). The numeric usage installer (:443–532) owns cache validity and uses the pinned SDK estimator with an already-built projection, instead of retaining a second projected history. Private previews relink copies without changing originals (:687–715). These boundaries need no broad rewrite.

## Limits and handoff

Static actual-code judgment only. Runtime correctness, budgets and CI at this exact tip are **unverified here**; no tests, source edits, install, prepare, setup retry/bypass, cleanup/deletion commands or push were performed. No provider/auth/device/recovery work. Earlier safety results are not a quality verdict or a new execution claim. Only this report was written; parent owns combining, repairs and subsequent proof. Values/guidance unchanged: existing simplicity and single-owner principles already cover these concrete findings.
