# Wisdom before delivery

Notes written after a job is done can die in a stale worktree. A clean tree can still hold task commits nobody else has. Capture wisdom and values during implementation and review. Ship them with the code, before the final task commit, PR, or delivery.

At closeout, check both uncommitted task changes and task commits not at the user's requested delivery point. A local commit is not shared delivery. After delivery or merge, stop writes in that closed worktree. Post-release factual receipts belong in a durable task or release record. New repo lessons need an explicit new follow-up task/PR, not quiet old-branch edits.

This is guidance, not an auto-commit or rescuebot. No automatic Git writes, workspace lock, or runtime closeout hook is added here. The actual delivery gate belongs in T3’s pre-PR/thread closeout. It knows the task owner and accepted delivery artifact. Bruv’s child-process completion and `agent_end` are not that boundary: a returned patch can still await parent integration, and a conversational stop is not delivery. A root Git scan would also include unrelated work. Do not turn those events into a guessed delivery gate.

Source: [standing prompt](../../src/prompts/wisdom.md). [Values](../values.md) now use the same boundary; the existing shared-memory value still fits.

Implementation workspace: `/home/tnfssc/.bruv/worktrees/wisdom-lifecycle-before-delivery`, branch `wisdom-lifecycle-before-delivery`. This is a new follow-up from released `develop`, not more edits in the closed voice worktree. Source, regression tests and this wisdom travel together.

Parent integration workspace: `/home/tnfssc/.bruv/worktrees/t3-7231ab8c-5442693331ce-task_45b6ba83`, branch `bruv/wisdom-before-delivery`. The worker patch was integrated here before creating the shared PR. The implementation workspace above is retained as source provenance, not a second pending delivery.
