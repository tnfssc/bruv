# Changelog

## Unreleased

- Separate footer parts with dots in a fixed order: usage, fast, goal, then agent cost.
- Give race agents task titles and put the result comparison on the first report line.
- Fix worktree diff totals when `.tmp/` is ignored; count once at completion and keep totals visible beside long titles.
- Shorten bash call rows to the first command line and 60 columns.
- Clear inherited agent settings before tests so the suite also runs inside bruv agents.

- Notify when long runs, races, and goals finish; show a working title and pending wait IDs in the terminal. Keep terminal escapes out of RPC, JSON, and print modes.

- Add a dim turn summary with tool and agent counts, elapsed time, and weekly plan use changes.

- Render script calls and bash/wait output as readable lines, with full script and output on expansion.

- Show running jobs and agents on a live board with tools, tokens, elapsed time, and finished worktree changes.

- Add `/race` and the `race` tool: compare agents in separate worktrees, pick a result, and bring its changes back uncommitted.
- Save `/fast` globally for future sessions and agents, with a one-time cost confirmation.
- Add `/usage` for ChatGPT plan limits, credits, and session usage, with footer status and limit warnings.

## 1.0.0

- Rewrite bruv as a Pi package installed with `pi install`.
- Remove voice, remote access, the web UI, the T3 Claude connector, history search, the old compaction modes, the compiled binary, and the updater.
- Start jobs and agents in the background, wait inside tools, and deliver work left running with the next message. Esc or Stop ends the run and its background work.
- Carry over goals, fast mode, Codex compaction, and questions that let work continue while the user answers.
