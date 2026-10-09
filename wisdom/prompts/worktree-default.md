# Keep the current workspace — 2026-10-09

The user said the agent still creates worktrees too readily. The root and child orchestrator prompts said to use one “for work you give another agent.” That made delegation itself a reason to create a worktree, even though the API defaults to inherit.

Both prompts now explain the tradeoff. Shared work is simpler in one place. Extra worktrees cost care. Separate branches and PRs can make that cost worth it. Tool facts stay in the tool reference. No runtime or tool default changed.

Delivery tests use the new value sentence. The focused prompt test checks both roles, the tradeoff, and the absence of the old blanket rule.

The user then called out the voice. Rewrote the rule in short, plain words. The shared system prompt and value 8 now say all writing must match nearby words and rhythm. Not just prompts. See [the writing note](./writing-without-clutter.md#worktree-prompt-follow-up--2026-10-09).

Worktree: /home/tnfssc/.t3/worktrees/bruv/t3-612daa13. No new worktree was made for this fix.

Checks after the voice fix: 110 tests pass across prompt sources, real prompt preview and CLI, instruction modes, SDK mode delivery, subagent framing, and Live integration. Changed TypeScript tests were formatted. `git diff --check` passes. No paid-model behavior test was run.

Handoff: branch `t3/reduce-worktree-aggression`. Changes are local and uncommitted; no push or PR. HEAD is the shared `02e69f6a` release commit, with no local commits ahead.

The final correction is [value-based prompting](./writing-without-clutter.md#value-based-prompting), not a stricter list of reasons to allow worktrees.

## Scratch stays with work

The user wants temp files in the current worktree’s `.tmp/`. The shared system prompt carries this so roots, children, and Live get the same home. Removed the old generic temp-directory advice from both worktree prompts. Added `/.tmp/` to `.gitignore`. Value 3 keeps the reason: scratch stays with work, easy to find and clean up. No new worktree needed for scratch.

This changes agent guidance, not every test runner or OS temp API. No existing files were moved. 24 prompt and preview tests pass. `git check-ignore .tmp/probe` and `git diff --check` pass. Changes stay local and uncommitted.

## Cut leftover setup advice

The user called out the manual-path, CLI-root, and path-recording paragraph. It did not belong in these prompts. Cut the whole setup paragraph from both roles. They now carry only the worktree tradeoff. The tool reference already explains the API; the tools own workspace creation. Shared `.tmp/` guidance stays.

No new value needed. This follows the value-based prompting correction above. 53 prompt, preview, and subagent tests pass. `git diff --check` passes. Changes remain local and uncommitted.
