# Native coverage after durable shake (2026-10-01)

## Cause and fix

The provider-bound capture sees the durable shake projection, while SDK
`prepareCompaction` supplies raw discarded messages. The ordered coverage check
therefore asks for messages the ordinary request intentionally no longer contains.
Do not relax ordered matching, timestamps/content, checkpoint presence, identities,
or the cut to make this pass.

`coversDiscardedMessages` now validates the latest branch shake marker and projects
the required messages with the same shared shake implementation. Pairing evidence
comes from the **full active SDK context**, then the required slice is selected by
exact occurrence. This handles calls discarded on one side of a split while their
results are kept on the other. Unmatched/ambiguous copies stay required.

The shared projection now explicitly validates each selected protocol group for
missing, duplicated, invalid, orphaned, or out-of-order call/result IDs. An unrelated
incomplete group is kept whole, but does not poison complete historical shaken
groups. A global incomplete-window refusal was tested and rejected: the actual
recorded root has unrelated incomplete groups, and that approach still fails it.

No registration/serialization changes here. `firstKeptEntryId`, opaque item,
substantive messages, ordinary signatures outside the marker, boundary/leaf,
identity and generation guards are unchanged. Malformed markers refuse coverage.

## Recorded-history proof (read-only)

Read-only replay of the original root journal
`2026-09-30T16-37-20-324Z_01a0f32d-7f44-722c-9949-015a08f82a36.jsonl`:

| Root leaf | Raw / shaken | Removed | First raw mismatch | Original cut | Fixed coverage |
| --- | --- | --- | --- | --- | --- |
| 224c003d | 703 / 492 | 211 | assistant 816be37a | bdff552a | true |
| 6de31f8c | 705 / 494 | 211 | assistant 816be37a | 9569b346 | true |
| fe92bdf7 | 707 / 496 | 211 | assistant 816be37a | 75d83b47 | true |

The first mismatch has thinking + toolCall, stopReason toolUse. Replay compared
raw SDK preparation with the already projected capture; no journal writes, changed
cuts, or content/ciphertext logging. This proves the recorded deterministic coverage
failure, not that every historical UI cancellation had this cause.

## Regression evidence

`tests/native-compaction-shake-coverage.test.ts` uses a privacy-safe reproduction
of that trigger: genuine persisted SDK shake marker + opaque checkpoint, tool-only
thinking/call assistants and results removed (211 messages), mixed substantive text
retained, raw SDK preparation, and a real SDK split-turn cut. It is not a synthetic
long-continuation-only test. Restoring only the old raw coverage helper made 7 of
the first 9 tests fail, including zero native dispatch; fixing it made all pass.

The fixture also reopens the actual SDK journal from disk, runs the pinned ordinary
Responses converter, checks the exact original opaque item appears once, and runs
the native hook with that serialized prefix through an offline fetch. Checks include
unchanged cut, instructions/cache key, original persisted checkpoint, split tool-only
and mixed messages, multi-call groups with a kept result, incomplete selection,
missing/rewritten user text, reordered messages, damaged/changed marker, ordinary
signature changes, and original leaf/boundary guards. Existing native lifecycle tests
continue covering identity/generation changes and cancellation.

This hook-level SDK preparation/serialization test does not claim a full
AgentSession ordinary-stream transport test. Disk reopen is tested after an ordinary
capture; no new capture-refresh behavior is included. No paid provider probe was used.

Values unchanged: this reinforces the existing same-source-of-truth and evidence
boundary values. Related: [coverage investigation](native-coverage-repro.md),
[coverage safeguards](native-compaction-coverage-2026-09-14.md), and
[shake policy](../compaction/auto-shake-compaction.md).

Final focused verification: 115 tests / 648 assertions passed across the new
coverage fixture and native, manual-shake, auto-shake and cache-affine SDK/unit
suites; `tsc --noEmit`, focused formatting and `git diff --check` passed.

## Final integration and scope

The supplied Oct 1 10:30 journal is a child, not the checkpoint-bearing root above.
The root crossed Sol's 255616-token automatic threshold repeatedly. SDK safety
cancellation does not lower context size, so later tool responses trigger another
attempt. Its durable context edit already omits the retry failure: widening the
empty-error exemption is neither necessary nor safe. Recent fallback diagnostics
are not retained; the recorded replay proves this path, not every UI warning.

Final narrowed verification: 144 tests, 882 assertions, 11 files; typecheck and
focused formatting pass. No fresh-capture/OAuth changes, install or PR included.

Main worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_eed5eff8`;
branch `die/fix-opaque-checkpoint-auto-compaction-lo-eed5eff8`.
Projection worker: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_eed5eff8-a86675007a5e-task_7cc4e8f3`,
branch `die/fix-recorded-shake-coverage-mismatch-7cc4e8f3`.
Independent diagnosis: sibling worktree ending `task_50e6765f`, note
`NATIVE_COMPACTION_REVIEW.md` (metadata-only historical replay).

## PR handoff

PR: https://github.com/tnfssc/die/pull/14 (base develop).
Clean PR worktree: `/home/tnfssc/.die/worktrees/die-native-compaction-pr`; branch `fix/native-compaction-shake-coverage`.
This branch passed 86 focused tests, typecheck, and diff check after preparing runtime assets. No install or release. User asked to stop speculative hardening; fresh-capture and OAuth work were left out. The shared product-first prompt/value change is separate.
