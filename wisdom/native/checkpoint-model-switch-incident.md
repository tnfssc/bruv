# Checkpoint model switch: check upstream first

## What the user needed

The user selected gpt-6.1-sol after a checkpoint made with openai-codex/gpt-6-astra. /shake refused the opaque branch. Sending then gave a model mismatch and a generic abort. They asked to force forward, then said: "check codex code. they let you switch models".

They were right for this pair. Normal switching is the goal. Do not finish the earlier reject-only guard or add a force approval hurdle for this switch.

## Evidence

Official openai/codex revision [8ea2428c38f8994e18d789669f5cbc5df75e1f17](https://github.com/openai/codex/tree/8ea2428c38f8994e18d789669f5cbc5df75e1f17), checked 2026-10-01:

- codex-rs/models-manager/models.json: Astra 4–37 and Sol 178–210 both have comp_hash:"3000" and context_window 272000.
- codex-rs/protocol/src/openai_models.rs462–464 calls this the identifier for compaction-compatible model configurations.
- codex-rs/core/src/session/step_settings.rs258–270 updates the model without resetting the conversation.
- codex-rs/core/src/session/turn.rs1328–1414 recompacts with the previous model when two known hashes differ. Missing hashes do not trigger that step. A bounded current-model fallback exists. Lines1417–1461 handle a smaller context window.
- codex-rs/core/src/compact_remote_v2.rs447–460 retains the opaque compaction output directly.

This pair needs neither hash-change recompaction nor window downshift. That is not proof of cross-provider/account portability or every model pair. Do not mistake a turn compatibility hash for a proven immutable encryption binding on a saved item.

Source probe: /home/tnfssc/.die/tmp-pi-removal/codex-source-probe-1790829586. Research task_e19afd27 is done. No paid model call was made.

## Die's two blockers

native-compaction.ts checks exact API, provider and model ID in both the context guard and message adapter. Tests of that rule prove local behavior, not provider limits.

Pi 0.99.1 dist/api/transform-messages.js68–84 also drops empty signed thinking from another model. Die uses that slot as an internal compaction bridge. Removing only the first guard still loses the item.

The synthetic bridge may use the selected model for routing. It is not saved assistant history. Keep the saved checkpoint's origin model and opaque item unchanged. Keep the exact serialized-item check before provider dispatch. Do not broaden generic encrypted-reasoning replay. In-flight compaction capture identity and generation checks must still reject model changes.

/shake remains separate. No encrypted state may be silently flattened or discarded.

## Current work

Implementation task_b1e4ae76 finished the small normal-switching fix and real SDK tests. Commit 123545d integrated as d99f8e9. Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_b1e4ae76. Branch: die/allow-codex-compatible-model-switching-w-b1e4ae76. Base 82cdcff. Parent owns this incident note. The pinned SDK exposes no comp_hash. The fix follows upstream missing-hash behavior within the same API/provider, not full Codex transition parity. Known-unequal-hash recompaction and dedicated context downshift remain follow-ups. See [implementation and proof](codex-compatible-checkpoint-switching.md).

42 focused tests passed in the worker and again after integration: new model on the request, original opaque item exactly once, stored provenance unchanged, disk reconstruction, wrong API/provider blocked, ordinary switching unchanged, stale in-flight captures rejected. Worker typecheck passed. Parent log: /home/tnfssc/.die/checkpoint-switch-parent.log. Pushed with proof note 3280620. Full hosted CI [36817970940](https://github.com/tnfssc/die/actions/runs/36817970940) passed on that SHA. Watch log: /home/tnfssc/.die/checkpoint-switch-ci.log. No live-session surgery, paid probe or release dispatch.

Superseded task_042241cf left an uncommitted reject-only patch in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_042241cf, branch die/reject-incompatible-checkpoint-model-sel-042241cf. Do not integrate it as the solution. Its 59 passing tests tested the old policy. PARENT_NATIVE_GUARD_STATUS.md has the handoff.

## Independent Release failure

The user also linked Release 36813685812/job 110214202400. Release sets DIE_T3_SOURCE; the cache-key fixture assumed it absent. Production correctly rejects custom sources. Worker a6da360 integrated as 82cdcff after the version bump 0aba473. The fixture checks rejection, clears its own input and restores caller state. No production guard was weakened.

30 focused tests passed with inherited DIE_T3_SOURCE. Log: /home/tnfssc/.die/release-cache-env-regression.log. Commit 82cdcff is pushed; ordinary CI 36815463809 passed. No Release was dispatched. An old pinned job does not pick up a new commit on rerun. Version 0.15.15 is prepared, not confirmed published.

## Lesson

Check upstream behavior before turning an uncertain assumption into a user restriction. Local rejection tests cannot establish a provider limitation. Value 2 now says this explicitly. The feature details stay here.
