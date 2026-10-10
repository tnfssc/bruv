# Worktrees and agent tabs

User direction, 2026-10-09. Deferred design brief. Agent discovery, read-only agent tabs, retained finished output and presence are not shipped. See the [current browser contract](../../src/web/README.md).

## The shape

- The workspace sidebar should reflect real worktrees, not just manually added folders.
- When an agent creates a worktree for delegated work, that worktree should appear in every connected browser's sidebar.
- A subagent running in an existing worktree should appear as a new tab in that workspace while it works.
- Each workspace can contain several agents. Some may run for hours; others may need attention.
- Subagent tabs are read-only inspection views. Do not turn opening a tab into permission to type into or steer that agent.
- Finished subagents should show Done and become inactive. Keep their output available for inspection rather than dropping the tab on completion.
- Workspace and agent state is shared. Selected workspace and tab belong to each browser. Switching one viewer never navigates another. Viewing the same terminal shares that terminal.

## Not decided yet

Refine how running, attention, done, failure, and cancellation appear. Decide what the inspection view contains, how it follows live output, and how long completed views persist. Define how existing worktrees are discovered and how agent lifecycle events map to tabs. Do not promise durable history or server-restart recovery from the current in-memory implementation.

Use actual agent/worktree lifecycle data. Do not start duplicate agents just to display them, or infer completion from terminal output. The existing interactive root terminal and a read-only subagent view need different input permissions.

## People and presence, later

User also wants lightweight participant identity and live presence:

- A new browser asks for a display name before joining. Initials are enough to start; an optional profile image may come later.
- Sessions show who created them. Keep that attribution separate from who is looking at them now.
- Show current viewers on workspaces/tabs with avatars or initials and a live indicator. A person can view another person's workspace without becoming its creator.
- Presence should help people see where others are working. It must not force viewers to follow one another.

Display names and avatars are not authentication or new access rights. Exact presence rules, multiple tabs for one person, reconnects, and image handling still need design.

Independent navigation and shared terminal views already work. Do not gate them on name entry, profiles, avatars or presence.

## Space and attention

The user made this a hard product constraint: screen space and attention are precious. Every visible item must earn its place. Avoid filler subtitles, repeated labels, incidental metadata, and status text that does not help the current task. Keep terminal work central. Use progressive disclosure for detail; keep important errors, permission requests, and needed actions clear. Future avatars, activity, and agent status must fit this constraint rather than filling the sidebar with noise.

Keep the build simple too. Use Bun's bundler and embed static browser assets in the compiled binary. No Vite or extra frontend framework/build server is needed for this UI. The current pipeline already does this (scripts/build/web-assets.ts and src/web/assets.ts). Track real asset size rather than promising no binary growth.
