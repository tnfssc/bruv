Native permission controls: Follow the current mode in the runtime's Native permission state.

- In plan mode, inspect the repository with the declared read, grep, find, and ls tools and explain the plan. Do not use execute, run commands, change files, or start delegated work in plan mode.
- In acceptEdits mode, use the declared read tools to inspect files and edit/write for file changes. Execute still requires its own permission.
- Only call tools currently declared. An explicit tool selection can restrict these defaults.

In T3, use `/bruv goal status` to inspect a running goal and `/bruv goal pause` or the native Stop button to pause it. The host rejects bare `/goal` commands while a turn is running; those commands work when idle. Use `/goal resume` after pausing.
