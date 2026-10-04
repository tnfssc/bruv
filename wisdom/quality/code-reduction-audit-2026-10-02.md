# Code reduction audit — 2026-10-02

## Request and result

User asked for every code file and line to be reviewed for maintenance reduction. Highlight small feature cuts with large savings. Wisdom and prose were not deletion targets. This was an audit, not a code-removal patch.

Complete at baseline d80d7058a2f5481f067586fd7042fe2746cff4ae: **689 tracked code/config files, 160,840 physical lines, zero unread gaps**. All 32 research jobs finished. Shared checkout was used for read-only research; no code worktrees or branches were made. No source, test or config edits and no commit. The only tracked edits are this handoff and value 7; new audit reports live beside the code.

## Pick up here

- Main report: [audit summary](../audits/code-reduction/2026-10-02/README.md).
- [Per-file coverage](../audits/code-reduction/2026-10-02/coverage.json) records file hashes, inclusive ranges, report links and verdicts. All current code bytes matched the reviewed inventory at final check.
- [Detailed reports](../audits/code-reduction/2026-10-02/reports/README.md) retain first-pass partial reports plus completed follow-ups. Use the joined ledger for final coverage.
- [Parent checks](../audits/code-reduction/2026-10-02/parent-checks.md) record independent reference/diff checks and compiler limits.
- Raw manifests, original ledgers and exact job IDs remain in ignored artifacts/code-reduction-audit/. The durable report does not need that folder.

Next: implement the narrow no-feature-loss batch in a worktree; estimated 491–562 net lines, including specified test edits. Recheck references and run focused tests after edits. Estimates are not measured diffs. Do not sum overlapping report totals. Feature cuts still need a product choice. The frozen T3 archive is 35,011 physical code/config lines, not active runtime code. Preserve the baseline revision if retiring historical replay files. Never confuse it with integrations/t3/upstream/bruv.patch.

No full build, runtime gate, paid/provider, audio or release test was run for this audit. The extra noUnused compiler check produced 34 TS6133 diagnostics and no other diagnostic type. Several reviewers ran bounded offline/syntax probes documented in their reports. Static findings are not proof an unimplemented deletion passes.

## Important care points

- Do not remove the FFI library lifetime root just because TypeScript flags it as unused.
- The web patch allocates an unused cancellation semaphore while comments promise shared cancellation/creation ordering. Trace the actual owner before deletion; no race failure was observed and no savings are credited.
- Live privacy/teardown assertions at tests/live-extension.test.ts:658–659 target the earlier fixture, not the running fixture they just exercised. Retarget them; do not delete the apparent duplicates. No current raw-error leak was established.
- Keep durable identities, grants, confinement, host checks, cancellation ownership, output bounds, privacy and atomic-write rules. Small feature cuts remove the whole optional job, not guards around a retained job.

## What we learned

Spare production implementations survived through their own tests: volatile remote capabilities, captured-context compaction, Live transcript grouping, companion orchestration, web ancestry policy, and a future packed-web content-key wrapper. Useful assertions should follow the shipped owner. Independent reference models and real manual entrypoints are different; no import is not proof of waste. Added this distinction to existing value 7 rather than adding a new value.

For this audit, large first-pass groups returned honest partial ledgers. Follow-ups of roughly 3,000–4,400 lines closed the gaps. Some patch reviewers split coverage at diff boundaries; join ranges, not record counts. Two files lack final newlines, so wc-style totals were two lines low. Final physical-line count includes both. No wisdom/prose deletion savings are counted.

## User follow-up: keep important features

User said: "dont cut important features bro". No features have been cut. Preserve current user-facing behavior by default. The feature-cut tables are discussion only, not approval. Focus any next cleanup on proved dead code and behavior-preserving deduplication. Do not decide a feature is unimportant from its line count. Get explicit user agreement before retiring a feature or developer workflow.
