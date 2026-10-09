# Write without clutter

The user cut the original README and the first GIF pass, then made the scope clear: this value applies to everything we write, including the app. They next asked to put it in the system prompt. See [the two cleanups and scope correction](../landing-page/readme-gifs.md#the-users-two-cleanups).

Added one bullet to Working together in `src/prompts/system.md`. It covers app text, prompts, docs, comments, notes, and replies. Cut repeated ideas and sections. Do not narrate what a UI, image, command, or example already says. Use layout and structure. Keep useful depth, facts, steps, warnings, and reasons. This is not a token cap or a rule to make every answer tiny.

`src/prompts.ts` embeds this source as `collaborationGuidance()` and extracts its bullets as `workingValues`. Roots and children use that shared guidance. Live uses the ordinary prompt hook too. Do not make another copy in each role or voice prompt. Explicit user-owned system prompts still control their own instructions. A source edit does not update a running compiled binary; rebuild it to get the new text.

Added a small wording check and included the new bullet in the existing working-values assertions. Existing prompt-delivery checks test that the shared values reach the model context.

Worktree: `/home/tnfssc/.bruv/worktrees/bruv-writing-system-prompt`. Branch: `docs/writing-system-prompt`, from `64b72c0c`. PR base: `docs/writing-without-clutter` (#61). Prior worktrees stay untouched.

`bun install --frozen-lockfile`, `bun run prepare:assets`, and all 45 tests in `tests/prompts` passed. That includes the real prompt-delivery checks. `git diff --check` passed. Format before the final commit and push this task as its own PR. No release or deployed binary change is claimed.

Value 8 stays unchanged: this task puts the existing value in runtime guidance. No new general lesson.
