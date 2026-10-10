# Changelog

## Unreleased

- Show a framed terminal receipt after checked finishes: the request, what was tried, remaining gaps, file totals, time and usage. Keep receipts out of model context; RPC display is deferred.

- Check changed work with a fresh agent before accepting `finish(done)`. Retry gaps twice, stop checks on abort, and add `/check on|off`.

- Keep GPT runs going until they call `finish` with their reply. Add `/keep-going on|off|auto`, saved for sessions and child agents. Keep finish visible in codemode-only mode, respect Esc and Stop, and stop after two continuations without tools.

- Removed `/race`.

- Add `/review` for uncommitted changes, branch diffs and commits, with bug-focused guidance and no file edits unless asked.

- Add `/import-codex` with a preview for models, thinking, fast mode, MCP servers, skills, prompts and trusted projects. Keep existing settings and leave sign-in tokens alone.

- Show each pending script call once and update its row when it finishes.


- Separate footer parts with dots in a fixed order: usage, fast, goal, then agent cost.
- Fix worktree diff totals when `.tmp/` is ignored; count once at completion and keep totals visible beside long titles.
- Shorten bash call rows to the first command line and 60 columns.
- Clear inherited agent settings before tests so the suite also runs inside bruv agents.

- Notify when long runs and goals finish; show a working title and pending wait IDs in the terminal. Keep terminal escapes out of RPC, JSON, and print modes.

- Add a dim turn summary with tool and agent counts, elapsed time, and weekly plan use changes.

- Render script calls and bash/wait output as readable lines, with full script and output on expansion.

- Show running jobs and agents on a live board with tools, tokens, elapsed time, and finished worktree changes.

- Save `/fast` globally for future sessions and agents, with a one-time cost confirmation.
- Add `/usage` for ChatGPT plan limits, credits, and session usage, with footer status and limit warnings.

## 1.0.0

- Rewrite bruv as a Pi package installed with `pi install`.
- Remove voice, remote access, the web UI, the T3 Claude connector, history search, the old compaction modes, the compiled binary, and the updater.
- Start jobs and agents in the background, wait inside tools, and deliver work left running with the next message. Esc or Stop ends the run and its background work.
- Carry over goals, fast mode, Codex compaction, and questions that let work continue while the user answers.
