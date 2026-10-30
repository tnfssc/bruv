---
name: shared-agents
description: Why bruv adds ~/.agents/AGENTS.md to Pi's context files, and what it left out
---

# `~/.agents/AGENTS.md`

Pi already reads global (`~/.pi/agent/`) and local (working folder and its parents) context files. Users who
keep one file for several agents keep it at `~/.agents/AGENTS.md`, so bruv adds it in `before_agent_start`,
first, read once per session like Pi's. It is skipped when a Pi file resolves to the same path (a link), and
when Pi runs with `--no-context-files`.

Pi has no hook for context files, so this edits `systemPromptOptions.contextFiles`.

Not done: nested `AGENTS.md` in folders below the working folder (loaded when a tool touches a file there).
Asked on 2026-10-30; the user wanted only the shared global file for now.
