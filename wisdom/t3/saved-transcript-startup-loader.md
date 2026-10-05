# Saved transcript startup loader synchronization

The saved-transcript startup fixture exercises the patched SDK's real syntax-highlighting loader. Do not use a fixed number of `setImmediate` turns to wait for its `grammars:ready` event: that only measures event-loop scheduling, not completion of the dynamic grammar import, and can intermittently leave the empty-stopped scenario pending.

The fixture's intercepted loader should signal a completion promise only after the upstream `loadAllHighlightLanguages()` promise resolves. Await that signal wherever the test needs grammar readiness; keep the real loader and existing stopped-mode invalidation assertions.

Proof: `bun test tests/saved-transcript-startup.test.ts` (5 scenarios pass). Worktree: `/home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_189c5d2c`.
