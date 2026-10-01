# v0.15.19

## Tasks can run here or on an authorized SSH target

- Use normal subagent target selection, jobs, /ps and /questions. Local/current runtime remains the default. Target and workspace are separate choices.
- Run the main agent on the server with `die --place <authorized-name>`. The terminal is a thin client. The server owns models, tools, children and worktrees. Closing the client detaches; reopen the same session.
- Send current tracked source and explicitly approved untracked files. Safe results apply automatically; local drift keeps review artifacts. Root results return after successful /close and settled children, not after every turn.
- Preserve task and command identity across uncertain SSH responses. Human replies and SDK dialogs stay human-owned. Destination profiles and supported overrides do not copy credentials.

Source handoff uses isolated, history-free Git snapshots. One named authorized target is supported, not a fleet registry. Live voice/web root presentation and full-history transfer are not included.
