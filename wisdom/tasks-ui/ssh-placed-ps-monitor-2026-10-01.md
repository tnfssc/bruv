# Ordinary /ps includes SSH placed work (2026-10-01)

Feature branch: `remote/task-placement-monitor`.
Lasting worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_9d77ad7e`.

## Lead wiring (this worker deliberately does not edit agent/extension.ts)

Remove the current `registerTaskMonitor(pi, getManager);` (baseline line 525).
Immediately after `const remoteJobs = createRemoteJobsAdapter(remoteClient);` (baseline line 552), add:

`registerTaskMonitor(pi, getManager, remoteJobs);`

The handler captures `ctx.sessionManager?.getSessionFile?.()` each time /ps opens. No durable session means no SSH query; never fall back to another session's jobs.

## Boundary and durable design

- `MergedTaskMonitorSource` is a per-panel read projection, not a scheduler, lifecycle registry, event outbox, or completion consumer. Local TaskManager and remote backend stores remain separate. The two-argument registration/local panel contract still works.
- Existing RemoteJobsAdapter list/inspect/stop signatures are unchanged. Optional future SshJob target/workspace fields are not required. Scope all remote reads/stops by the captured parent session.
- List reads poll existing remote cache once per second with one request in flight. List failures retain previous observations and display an unavailable notice. Running and unknown SSH tasks remain actionable/visible; unknown never becomes failed because a read or stop failed.
- SSH output is explicitly cached; observations explicitly stale. Inspect has no tail index, so read one first page at offset 0, max 5,000 UTF-8-safe bytes. Preview further bounds to 2,400 bytes. Do not walk transcript pages or imply live output. Terminal escapes/control characters are cleaned before display, including ownership metadata.
- Stop preserves the frozen task ID plus host/owner/epoch token. Revalidate ownership via the session-scoped cache before remote stop. Pending/confirmed cancellation delivery is not terminal state; only a terminal job observation removes the row. Stop errors and pending requests stay visible as not confirmed stopped. No stronger atomic compare-and-stop guarantee is invented beyond the existing remote API.
- Panel disposal detaches its own listener and disposes only its newly-created adapter, clearing refresh/render timers. Shared manager and unrelated subscriptions remain intact. Late list/output results cannot publish after close; an outstanding preflight cannot issue stop after close. Already-sent remote cancellation is owned by the backend, not by the panel.
- Existing local output, selection, stop confirmation, zero-row action suppression and frozen narrow-terminal identity behavior remain tested. No task-tree redesign or separate remote inbox was added.

## Verification

Direct Bun 1.4.2 at `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun`, with `TMPDIR=/home/tnfssc/.die/tmp-pi-removal`:

- Monitor unit tests plus existing remote-jobs tests: 35 pass, 0 fail (3 files). Existing local monitor tests unchanged. New tests use fixture adapters only; no real placed task or remote user state/config/cache.
- TypeScript `tsc --noEmit`: passed after preparing runtime assets.
- Focused Biome formatting passed; lint exits 0 with existing-style warnings/informational template suggestions (not claimed warning-free).
- Full binary/PTY verification is **not** claimed: existing TUI tests require dist/die, initially absent; their startup fixture therefore failed. Attempted repository binary build was blocked in packed-web preparation by missing `pnpm`. Unit/component assertions are not a substitute for compiled SSH end-to-end proof.

Only this feature commit should be picked; the worktree starts on the lead's launch-rejection/README ancestry. No agent/extension.ts edit is included.
