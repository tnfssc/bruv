# Held terminal touch lifecycle

## Review blocker

Base: `9b373e83`. Worktree: `/home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_85bcabb5`.

The reviewer held a finger on tab A, switched to B, then moved the held finger. The helper kept A's gesture. In the alternate buffer, its synthetic wheel reached xterm and produced `ESC[A`; A's open socket still forwarded that input. Normal-buffer moves could also scroll the hidden pane. Hiding and showing A before the next move bypasses a visibility-only guard.

## Fix

Touch start and move reject hidden or detached panes and clear the gesture. The helper returns a cancel callback. Session owns it and calls it from the existing hide lifecycle (including document hide) and before terminal disposal. This also clears fractional scroll lines. No observer or second visibility state is needed.

The input socket handlers stay unchanged. No global keyboard/network gate. Alternate-screen touch still uses the existing xterm wheel path; normal history still uses public `scrollLines`. Resize observers and shared viewport reporting stay unchanged.

## Proof

- Focused touch/browser tests: 38 pass. On the base implementation, the same suite gives 29 pass and 9 expected regression failures.
- Unit tests cover hidden and detached moves in both buffers, rejected starts, hide→show cancellation, and a fresh gesture on return.
- Browser-entry tests load the real helper with fake DOM/xterm/socket peers. They cover tab switching with A's socket open, hide→show before a move, fresh input/scroll, document hide, and disposal. The alternate-buffer peer emits `ESC[A` from wheel to onData, checking the original forwarding chain. This is not a new real-browser or physical-phone proof.
- `TMPDIR=/var/tmp bun test tests/web`: 74 pass across 10 files.
- `TMPDIR=/var/tmp bun run check` and `bun run build`: pass.
- Focused Biome format and lint: exit 0; lint reports 33 warnings and 47 infos. `git diff --check`: pass.

Only this worktree was edited. The main integration and active UI worker trees were untouched. No paid APIs, push, or PR. Parent can cherry-pick this commit into the frontend handoff for PR64.

Values unchanged: this uses the existing pane owner and tests the late event plus fresh start, already covered by values 1–3. No new ownership principle.
