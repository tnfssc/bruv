# Write like rest. No extra talk.

The user cut the original README, then cut the GIF pass. We wrote too much. They kept the pitch, install, commands, and four GIFs in one small grid. See [both cuts](../landing-page/readme-gifs.md#the-users-two-cleanups).

They said this applies to all writing. App text too. We put it in value 8, then `src/prompts/system.md`. But we changed the voice again. The user called that out: "again you dont follow exsting language voice. this repeated so many times bruv".

Read nearby text first. Match its words and rhythm. No say we follow the voice, then write in our own. The old wisdom prompt already says "Short words. Short sentences. Plain talk." Use that voice.

Rewrote the writing bullet and value 8. No new value or prompt layer. Cut extra ideas, not just words. Screen or example says it? No tell it again. Keep needed facts, steps, warnings, reasons. Need depth? Keep it.

## Where it reaches

`src/prompts.ts` embeds `system.md`. `collaborationGuidance()` gives the text. `workingValues` gives its bullets. Roots, children, and Live use it. No need a copy for each role. User-owned system prompts still win. A running binary keeps its old text. Rebuild to get the change.

Tests check the wording and that values reach the model context. Green tests alone do not prove voice. Read the changed text beside what was there.

## This pass

Worktree: `/home/tnfssc/.bruv/worktrees/bruv-writing-voice`. Branch: `fix/writing-voice`. Started from `d5b9091b`. PR base: `docs/writing-system-prompt` (#62). Old worktrees stay as they are.

Read the new bullet beside the old ones and `src/prompts/wisdom.md`. All 45 prompt tests passed, including prompt delivery. `git diff --check` passed. No release or running binary changed.

Value 8 changed to the same plain voice as the prompt. The lesson stays the same; reading and matching nearby text is now part of it.

## Worktree prompt follow-up — 2026-10-09

The worktree fix slipped back into formal rules talk. The user called it out and asked to put the same-language rule in the system prompt too. Rewrote both worktree prompts in the nearby voice. Strengthened the existing writing bullet in `system.md` and value 8: match words and rhythm. The user made clear this means everything, not just prompts. All writing. No formal talk. No new value or prompt layer.

Work stays in `/home/tnfssc/.t3/worktrees/bruv/t3-612daa13`, branch `t3/reduce-worktree-aggression`. 110 tests passed before the last wording change. All 16 focused prompt tests pass after it. `git diff --check` passes. Changes are local and uncommitted. No release or running binary changed.

The user then said “NO RULES.” Cut “same rule” and “rules talk” from the live prompt text. Say what we mean: match the words and rhythm in all writing. No formal talk.

## Value-based prompting

“NO RULES” meant values, not just removing the word. The user made that clear: “VALUE BASED PROMPTING.” We kept adding commands when they wanted judgment.

The shared system prompt now says: “Values over rules. Say what matters and why. Leave room for judgment.” Value 8 carries the same lesson. Both worktree prompts explain the tradeoff: shared work is simpler in one place; extra worktrees cost care; separate branches and PRs can make that cost worth it. Tool facts stay exact. No new value section or runtime change.

111 prompt and delivery tests pass for this pass. `git diff --check` passes. Work stays local and uncommitted on the branch above.
