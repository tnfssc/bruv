# Remote human rendering (in progress)

Human chat is not the remote machine API. Cursor/event-count/cache metadata belong in structured operations, not repeated conversation messages. Polling should keep a compact status, and emit human notices only for semantic attention changes. Review the rendered compiled terminal, not only RPC parsing.

Workspaces for this feature:
- Integration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dca0ef2b
- Rendering: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dca0ef2b-a86675007a5e-task_39ff48d7 (branch die/remote-human-rendering-and-semantic-poll-39ff48d7)
- Terminal proof: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dca0ef2b-a86675007a5e-task_3afc7eb6 (branch die/compiled-remote-human-terminal-acceptanc-3afc7eb6)

Baseline focused remote suite: 55 pass, 2 opt-in skip, 310 assertions. Existing compiler/runtime from local tools and existing repository dependencies reused; no installation. Tests use disposable fixture homes, not real user storage. Final evidence follows integration.

- Hardening follow-up: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dca0ef2b-a86675007a5e-task_6faf3e3c (branch die/harden-semantic-remote-notices-and-statu-6faf3e3c). Review reconnect identity and unresolved-attention status before final proof.

Build note: default build attempted an upstream SSH fetch (local key loading failed); it was stopped. Use `bun scripts/build.ts --reuse-web` with existing worktree web assets for this CLI-only change. Do not fetch upstream or inspect user state for acceptance.

## Integrated findings

- Calling setStatus alone was insufficient: the compact footer hid unknown keys as "+1 status". Remote work now occupies a named field in the existing row, including narrow layouts; no extra widget.
- Exact autocomplete suggestions swallowed Enter for fully typed status/task commands. Exact matches now submit directly; partial autocomplete remains.
- The bottom terminal viewport is not its full transcript. Request actual event offsets and inspect enough rendered rows; terminal wrapping is not lost transcript content.
- Semantic identities persist in session branch entries, never global user state. Question owner/version and new terminal assistant content remain distinct. Changing SSH diagnostics stay one outage; later outages/recovery are new transitions. Reload restores connectivity state.
- Pending questions, blocked work, result review and offline state remain in compact status after active work ends. Open-menu polling is deferred and shutdown clears status.
- Machine operations stayed unchanged, including execute-only Live and structured transcript pagination. Tests preserve machine assertions while removing JSON.parse of human chat.

Existing value 8 covers the lesson; values unchanged. Final compiled evidence follows. No install, push, or release. A cancelled fixture’s owned container/image/tmux/home were explicitly cleaned up.

## Final evidence

[Compiled terminal captures and logs](evidence/human-rendering/README.md): actual PTY passed, 87 focused tests passed, typecheck passed. Initial raw-rendering fixture failed as expected; subsequent integration caught hidden footer status and exact-completion Enter interception, both fixed. Unit tests also cover hundreds of varying running/offline polls and session-reload dedup. Native macOS validation and shipping remain with parent.
