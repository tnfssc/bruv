# Wisdom goes with the code

Job done. Then notes get written. Those notes stay in an old worktree and die there. Even a commit can get stuck there. A clean tree does not mean the work was shared.

Write what we learn while doing the work. Put it with the code. Finish before the last commit, PR, or handoff. Before saying done, check for edits not committed and commits not shared yet. Send both where the user asked. Not there yet? Say what is left.

Task done or PR merged? Stop editing that worktree. Record release facts with the release or task, not in the old worktree. Need a new repo change? Start a new task and PR. No quiet edits on the old branch.

No auto-commit, rescue bot, or worktree lock. T3 owns PRs and when a thread is done. It can check where the work went. A child process stopping does not mean its work is shared. Its parent may still need to pick up the patch. No guess at delivery from that event. No Git scan that mixes our work with somebody else’s.

The rule lives in [the prompt](../../src/prompts/wisdom.md). [Values](../values.md) say the same thing. The tests check the wording and make sure no hook writes notes after the turn ends.

Worker: `/home/tnfssc/.bruv/worktrees/wisdom-lifecycle-before-delivery`, branch `wisdom-lifecycle-before-delivery`.
Parent: `/home/tnfssc/.bruv/worktrees/t3-7231ab8c-5442693331ce-task_45b6ba83`, branch `bruv/wisdom-before-delivery`.

The parent has the worker’s changes. Code, tests, and these notes are in the same PR. Nothing waits in the worker tree for somebody to find later.

User caught formal words in this change too. Rewrote the prompt, README, tests, and notes in the same plain voice. Values say the same rule; no new value needed.
