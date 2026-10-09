# Browser folder reuse and shipped help

Bounded server/launcher slice for the browser surface rethink. Base: c66b65e3.
Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_b9132ef7.
Parent integration: /home/tnfssc/.bruv/worktrees/bruv-web-surface-rethink.
Evidence: parent artifacts/surface-rethink/workspaces/findings.md found duplicate folders and stale microphone-button help. See [values](../values.md) and [multiplayer ownership](multiplayer-browser.md).

## Folder contract

Authenticated POST /api/workspaces still returns HTTP 200 and the flat revisioned snapshot: revision, voice, workspaces and defaultCwd. It also returns workspaceId (string) and created (boolean). The browser must select workspaceId locally for both outcomes, not infer an ID from a list diff. Other REST routes and event snapshots are unchanged.

- New folder: created: true; one workspace, one tab, one published revision. The PTY still starts only on authenticated attachment.
- Existing folder: created: false; return its ID and current snapshot. No new tab, PTY, rename, revision or state event. This is not an error.
- Resolve relative paths against the launch folder, then use realpath for both launch and added folders. Symlinks and dot segments share one identity. Different paths with the same basename stay separate.
- Lookup and insertion are synchronous after JSON parsing. Concurrent Adds cannot insert twice. No discovery index, lock, persistence or auth changes.

The frontend owner must use the explicit ID after its usual revision reconciliation. Browser selection, empty-tab recovery and real-browser acceptance remain with the parent. This slice changes no browser code, HTML, CSS, mocks or probes.

## Shipped help

Launcher help and README now start voice through /live and browser permission, not removed microphone buttons. /live stop releases voice without cancelling coding jobs. Only the owner browser captures and plays audio; switching tabs does not move voice. Disconnect keeps CLIs alive; server Ctrl-C stops owned CLIs. README retains the TERM/KILL process-group limit and detached-job caveat.

Folders belong to the server machine. Remote browser access uses a loopback SSH tunnel with the same URL host and port. Token, Host and Origin checks stay unchanged. No new flags.

## Checks

All commands used TMPDIR=/var/tmp. No paid API or network install.

- bun run check and bun run build passed.
- Focused server, multiplexer, multiplayer-server, launcher and compiled-theme tests: 34 passed, 0 failed. Includes symlink/dot/default-path reuse, live PID preservation, twelve concurrent Adds, same-basename folders, auth and stale help removal.
- A later combined run kept all 33 source tests green but the compiled-theme test timed out waiting for first CLI output. Its isolated retry passed (1 test). Cause was not established; no timeout or runtime behavior was changed.
- dist/bruv web --help printed the new command-driven help.
- bun run lint passed with existing repository warnings/info; bun run format:check passed with two existing oversized-wisdom-file warnings. git diff --check passed.
- First focused run exposed old duplicate-folder assumptions in server fixtures. Those now use distinct folders where needed, or expect launch-folder reuse. Test cleanup still stops owned PTYs and removes only owned temp folders.

No UI, physical microphone, tunnel connection or hosted CI proof is claimed here. Parent owns those checks and PR64 integration. Values are unchanged: this applies existing simple-state, clear-owner and honest-proof guidance, not a new cross-feature lesson.
