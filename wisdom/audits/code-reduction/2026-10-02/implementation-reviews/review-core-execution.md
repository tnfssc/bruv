# Independent implementation review — core / execution / test infrastructure

Reviewed pinned commit `8bf8cf6a7dd682b49f1a11c1a75704434195a61f` against `d80d7058a2f5481f067586fd7042fe2746cff4ae`. Read `wisdom/values.md` and the three concise implementation notes; inspected actual production/test diffs and relevant callers. Large audit documents were excluded, and wisdom was not counted as code reduction.

## Findings

**No actionable regression identified in the integrated changes.** No source fix is requested.

- Compaction: removed captured-context builder/snapshot fields were not used by the production request path. Migrated tests now invoke the registered compaction handler and provider seam, retaining frame/budget, replay-history and literal-focus assertions; current redaction/tool-result and low-reserve coverage replaces obsolete captured-prefix restrictions.
- Fast mode: the session-ID check still precedes consent capture (`src/agent/native-fast-mode.ts:385`); removing the unused authorization field does not remove that check. Standard-tier override still uses request-local AsyncLocalStorage, including overlap coverage. Persisted model-bound consent and failure restoration remain.
- Questions: production list returns canonical arrays with `text` (service handle and runtime projection), matching the reduced UI shape. UI/service ownership, version checks and read-only history handling remain. Wisdom removal deletes only the empty job-change hook/context cache; root command and guidance behavior remain.
- Launch/settlement: inherit returns before worktree-only logic (`src/tasks/job-service.ts:628`). Shared launch construction preserves argv/environment/session metadata; inherit batch cleanup and worktree reserved identity, preparation cancellation and original deadline remain separate. Shared completion tail retains output-budget enforcement before notification/event delivery.
- Bridge: failed handler replies still enter the common fallback block (`src/typescript/job-bridge.ts:590`), which releases the controller and marks the reply failed; removing the earlier duplicate cleanup does not permit ACK ownership of an error frame.
- Rendering/helpers: footer candidate order, long/short question labels and placement/status fields remain equivalent; monitor branches retain their individual row budgets and shared bounded/control-safe output. TUI helpers carry explicit socket/config/target/history inputs, while fixture lifecycle and startup barriers remain local. History probes still run in separate children with concurrent stream drainage; Herdr identity scrubbing is deliberate.

Bun JSONC rejection of unterminated comments/comma-only arrays is the approved malformed-input tightening, not a valid-JSONC feature cut. Valid comment/trailing-comma, escaped-string and original-byte digest checks remain on the setup reader.

## Proof limits

This was a static, read-only review, not final UI acceptance. No concrete unresolved concern required an additional offline runtime check, so no tests/build/full suite, provider/network or hardware runs were performed. Existing worker results are recorded evidence, not independently rerun proof; test-infrastructure acceptance used the copied baseline binary. The parent owns the rebuilt merged gate. No claim is made about final compiled CLI/TUI/web behavior or unintegrated cleanup proposals.

The reviewed worktree remained clean; source, tests and wisdom were unchanged. Only this requested external report was written.
