# Feature-preserving core cleanup — 2026-10-02

Baseline: `d80d7058a2f5481f067586fd7042fe2746cff4ae`. Implementation: `b95ad0e8bb66125ed1199124aef612b0926ad0cb`.
Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_dc1457d6`.
Branch: `bruv/cleanup-core-dead-paths-and-duplicate-st-dc1457d6`.
Audit proposals read from the parent’s absolute `audits/code-reduction/2026-10-02/reports/core-report.md`; verified against this baseline.

## Done

- **core-01:** removed the unused captured-context request builder, captured messages/leaf/headers, compaction re-exports and old binding alias. Meaningful frame, budget, history and literal-focus assertions now exercise the shipped handler. Boundary-changing redaction/current tool results and low reserve are covered; obsolete stale-prefix restrictions are not retained. Provider payload affinity and all real compaction paths remain.
- **core-02:** removed no-op wisdom job reconciliation and command-only context caching. Root-only command and fail-closed root guidance remain unchanged.
- **core-03:** question UI uses canonical saved-question fields (partial metadata for small fixtures, required id/text). Removed fixture-only envelopes and question alias. Durable records, CAS, delivery labels, stale-context handling and controls remain.
- **core-04:** removed invariant fast evidence and redundant authorization sessionId; kept the real session match, persisted consent and ALS isolation. Standard-tier helper takes only its callback; its tests updated.
- **core-05:** removed host/fetch rethrow wrappers, unchanged SDK name/inMemory wrappers, empty attention disposal, and identical provider-failure ternary arms. Sync-fetch failure now has a direct no-dispatch regression. Shared snapshots and real cleanup/error boundaries remain.
- **core-06:** the three leaf restorations share one small session utility. Existing append/diagnostic failure checks remain, with focused absent/null/string/missing-method/throwing-restore assertions.

No core-01–06 proposal is deferred. Core-07+ feature cuts are outside authorization; no goals, cache, fast, compaction modes, Herdr, archives or other features were cut. No changes are needed in another owner’s tests.

## Checks

Bun binary: `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun` (the worktree’s mise config is untrusted). Dependencies installed with a frozen lockfile and worktree-local cache, not parent symlinks; temporary install cache removed. Prepared only this worktree’s assets/SDK adaptation using `bun scripts/prepare-assets.ts`.

Exact focused commands below use that binary as `$BUN`:

```sh
$BUN test tests/cache-affine-compaction.test.ts tests/native-fast-mode.test.ts tests/questions-extension.test.ts tests/wisdom-extension.test.ts tests/native-compaction.test.ts tests/manual-shake.test.ts tests/live-host-bridge.test.ts tests/live-host-access.test.ts tests/session-boundaries.test.ts tests/subagent-extension.test.ts
$BUN test tests/cache-affine-compaction-sdk.test.ts tests/instruction-continuity-sdk.test.ts tests/manual-shake-sdk.test.ts tests/native-shake-sdk.test.ts tests/auto-shake-sdk.test.ts tests/phase2-native-sdk.test.ts
$BUN test tests/questions.test.ts tests/questions-runtime.test.ts tests/questions-picker.test.ts tests/history-sdk-099.test.ts tests/history-projection-parity.test.ts tests/goals.test.ts tests/instruction-mode.test.ts
```

Results, respectively: **176 pass / 839 assertions**, **25 pass / 346 assertions**, **65 pass / 478 assertions**, no failures. Final compaction-fixture/classification changes rechecked separately: **21 pass / 96 assertions**.

Final `$BUN node_modules/typescript/bin/tsc --noEmit`, changed-file Biome format and `git diff --check` passed. Changed-file Biome lint exits 0, with 63 warnings and 25 infos (no lint errors); existing style/type warnings were not swept into this cleanup.

A broader attempted group including `tests/questions-bridge.test.ts` and `tests/questions-sdk.test.ts` gave 66 pass / 2 failures: their isolated execute tests require `dist/bruv`, absent here (ENOENT). **Parent: run these after the combined build**, along with the normal TUI gate. No full build/CI, paid provider, hardware or release mutation was run.

## Reduction and integration

Implementation only: source **+54 / -237 = -183 lines**; tests **+171 / -82 = +89 lines**; combined **+225 / -319 = -94 lines**. Extra test lines buy real production-path assertions rather than preserving a second compactor. Wisdom is separate from these counts.

Internal source-only obsolete helpers/signatures changed; no shipped/public feature or persisted format changed. Inspect and cherry-pick the implementation plus this handoff commit; dependencies/assets stay local and untracked/ignored. History SDK name/inMemory parity passed without touching history-owned tests. No pending jobs or human decisions are needed to resume integration.

Values reviewed and unchanged: existing simple-owner, truthful-proof and feature-preservation values already cover this work; parent owns values integration.
