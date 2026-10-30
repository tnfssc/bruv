---
name: context-order
description: How bruv tells the model which instructions win when they conflict, and how it was tested
---

# Which instructions win

Most specific wins: the user's words in the chat, then a folder's `AGENTS.md`, the project's, parent folders',
global files (`~/.agents`, `~/.pi/agent`), then bruv's own guidance. "How bruv works" in `prompts/system.md`
is the exception: it describes how the tools run (finish, jobs, agents, wait), so files can't change it.

- `src/context-order.ts` replaces Pi's `project_context` section (an extension section of the same name
  replaces Pi's in place). Each file gets `scope="global|parent|project|folder"`, sorted broadest first,
  under `prompts/context.md`.
- Saying it only in that header was not enough. kimi-k3 followed bruv's "look things up instead of
  asking" over a global "ask first" file, so `prompts/system.md` now says right at the top that files win
  over its defaults. kimi-k3 also followed a global "never call finish" until bruv's keep-going nudged it, so
  the exception now sits under "How bruv works", next to finish, with the reason.

Tested 2026-10-30 with real `pi -p` runs in a fake HOME outside any repo (a run inside the bruv checkout picks
up bruv's own `AGENTS.md` as a parent): tone, ask-first, tabs vs spaces, never-call-finish, user overrides
"never commit". kimi-k3 and gpt-6-luna: 11/12 after the first fix. After the finish fix, deepseek-v4.1-flash 2/2. The
free opencode-go models were unavailable. The user asked to keep tests on cheap models.
