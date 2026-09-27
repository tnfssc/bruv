# Remote human rendering (in progress)

Human chat is not the remote machine API. Cursor/event-count/cache metadata belong in structured operations, not repeated conversation messages. Polling should keep a compact status, and emit human notices only for semantic attention changes. Review the rendered compiled terminal, not only RPC parsing.

Workspaces for this feature:
- Integration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dca0ef2b
- Rendering: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dca0ef2b-a86675007a5e-task_39ff48d7 (branch die/remote-human-rendering-and-semantic-poll-39ff48d7)
- Terminal proof: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dca0ef2b-a86675007a5e-task_3afc7eb6 (branch die/compiled-remote-human-terminal-acceptanc-3afc7eb6)

Baseline focused remote suite: 55 pass, 2 opt-in skip, 310 assertions. Existing compiler/runtime from local tools and existing repository dependencies reused; no installation. Tests use disposable fixture homes, not real user storage. Final evidence follows integration.

- Hardening follow-up: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_dca0ef2b-a86675007a5e-task_6faf3e3c (branch die/harden-semantic-remote-notices-and-statu-6faf3e3c). Review reconnect identity and unresolved-attention status before final proof.

Build note: default build attempted an upstream SSH fetch (local key loading failed); it was stopped. Use `bun scripts/build.ts --reuse-web` with existing worktree web assets for this CLI-only change. Do not fetch upstream or inspect user state for acceptance.
