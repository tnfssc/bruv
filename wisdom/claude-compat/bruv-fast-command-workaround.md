# Bruv-only Fast commands for T3 threads

2026-10-09. Worktree: /home/tnfssc/.bruv/worktrees/t3-1d0882e1-5442693331ce-task_1174b544.
Branch: bruv/add-bruv-fast-controls-for-t3-threads-1174b544.

## Decision

The user forbids T3 patches and permits this Bruv workaround. Official T3 still drops the custom catalog and Fast setting; see [live loss evidence](fast-loss-live-2026-10-09.md). Do not infer premium consent from a model badge, worker type, or composer state.

Expose the existing native Fast owner through the root human command allowlist and catalog:

- `/bruv fast on --accept-cost` enables Fast for this thread's current supported model and new supported children.
- `/bruv fast off` explicitly selects the standard tier.
- `/bruv fast status` reports the model-bound setting.

The colon form (`/bruv:fast`) also works. Discovery describes premium usage and child inheritance. RPC has no confirmation UI, so bare `on` still refuses and names command-local consent. Only the exact trailing `--accept-cost` on `on` grants it. Unknown, repeated, case-changed, or value-assigned flags fail. Existing global CLI consent, TUI confirmation, auth/model support, stale consent, branch/session binding, and checkpoint guards stay with the native owner.

No composer semantics, T3 source/worktrees, installed binary, or live user config changed. This does not repair T3's UI Fast metadata or launch compilation. Already running children keep their own selection; only new supported children inherit the parent's effective setting.

## Proof

Tests run under `env -i` with only the Bun/system PATH and owned HOME, XDG_CONFIG_HOME, TMPDIR, CLAUDE_CONFIG_DIR, and BRUV_CLAUDE_COMPAT_HOME under this worktree's `.tmp/fast-commands/`. Nothing uses the full machine /tmp. No paid provider calls: requests use offline credentials and mocked fetch; TaskManager spawn/foreground are mocked, while JobService is real.

- Focused Fast owner, native Fast connector, human commands, and command lifecycle suites: 52 top-level tests passed, including the subprocess wrapper for all 5 native Fast tests.
- `bun run check`: passed (asset preparation and TypeScript).
- Runtime regression suite: isolated SDK subprocess wrapper passed.

The native Fast fixture now goes through initialize discovery and actual runtime `onUser` dispatch, not direct host Fast settings. It proves safe status, no-consent refusal, exact flag rejection, persisted model/session/auth-bound premium consent, unchanged model/thinking, JobService child environment, a child's mocked priority request, and parent off/status with later child inheritance disabled.

One initial run failed only at a new disk reopen assertion: Pi does not create a setup-only session file until a user or assistant message exists. The fixture now seeds an existing offline thread before running commands and checks its reopened checkpoint. This keeps the existing persistence semantics; command-only fresh sessions remain buffered until a real conversation entry. No persistence owner or assertion was weakened.

## Limits and handoff

This is source-level proof, not installed/runtime UI acceptance. No build was deployed or service restarted. Parent reviews and integrates the commit. Provider billing remains authoritative; tests prove priority request serialization, not charged usage or latency.

Values reviewed and unchanged. Existing values already cover explicit user choices, one owner, real-path proof, truthful UI claims, and worktree-owned temp state.
