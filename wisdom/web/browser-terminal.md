# Browser terminal ownership

`bruv web` embeds a real terminal renderer and starts the ordinary CLI on authenticated attachment. It is not a chat UI or bundled T3. See the [operator guide](../../src/web/README.md), [renderer](ghostty-renderer.md) and [surface](surface-rethink.md).

## Server and PTYs

One [TerminalSession](../../src/web/terminal.ts) owns each tab's Bun PTY. Attachments own views, not the process. Joining never evicts a viewer. Detach removes a view; tab/workspace deletion and server shutdown stop the owned process group with TERM then KILL. This includes lingering descendants after CLI exit, but not detached Bruv jobs. Deletion never removes folder files.

The [server](../../src/web/server.ts) owns the shared workspace/tab registry and revisioned snapshots. Mutations publish before waiting for teardown. REST replies can trail events; the browser ignores older revisions. Selection stays local. Folder identity uses realpath relative to the launch folder. Opening an existing folder returns its workspace ID without creating a tab, publishing a revision or renaming it.

Visible attachments report available geometry. The server chooses the per-axis minimum and broadcasts it. Hidden views withdraw; with no active views, the last size remains. Size messages must not trigger resize replies. An exited view can change display size without resizing its closed PTY.

Output replay is bounded to 2 MiB and private to the joining view. An expired cursor reports a gap and freezes that view, not the CLI. Reconnect retains the same PID. Never replay or queue input. Terminal/state sockets have per-client send-backlog bounds; a slow observer closes independently while healthy views continue. Fresh-view replay after old resizes is best effort until redraw. Registry and replay are in memory, not durable restart recovery.

## Access and voice

The token is shared shell authority, not participant identity. Bind loopback. Check exact Host, Origin and token before API dispatch. WebSocket upgrades and mutations require Origin; authenticated GET may omit it. The initial token lives in the URL fragment, then sessionStorage; requests use Bearer auth or a WebSocket subprotocol. Remote use needs a matching SSH tunnel, not public HTTP or an unreviewed proxy mount. Failed state reconnects recheck authenticated HTTP state, because browser WebSocket errors hide upgrade status. Confirmed 401/403 stops input and retries and shows access guidance; network loss still retries.

The [input owner](../../src/web/input-ownership.ts) issues a bounded one-use ticket at Enter and inserts a private OSC marker into PTY input. The root Live extension consumes it before the editor. Capture the ticket when `/live` is invoked, before async settings or dialogs; later keystrokes cannot retarget it. Mixed authorship rejects voice rather than guessing an owner. Ctrl-C resets authorship; focus/resize and bracketed-paste newlines are not submissions.

The [audio relay](../../src/web/audio-relay.ts) consumes that ticket and targets only its attached browser. Admission needs the matching request and private attachment capability. Shared owner IDs are hashes for display, never credentials. Keep per-tab CLI relay secrets out of browser state, URLs and logs, and strip them from [descendant environments](../../src/delegation-environment.ts). Invalid relay configuration fails closed, not back to a server microphone.

One voice reservation spans the server. Page load, focus, selection and observer joins cannot acquire it. Observers cannot steal or release it. Owner attachment loss, CLI/device error, audio close, cancellation or disposal releases voice without stopping coding work. Stale requests and late closes cannot release a newer reservation. Late permission tracks must stop before capture is wired. App code cannot dismiss the browser's permission prompt.

Run `/live stop` in the voice tab before requesting voice elsewhere. The command stops that CLI's Live run, not every tab. Trusted collaborators still share command authority. Provider, agent and tool ownership stays in the real CLI; the browser is only its audio device.

## Regression checks

[Workspace/PTY tests](../../tests/web/multiplexer.test.ts), [server tests](../../tests/web/server.test.ts) and [multiplayer tests](../../tests/web/multiplayer-server.test.ts) cover auth, same-PID reconnect, replay gaps, shared geometry, slow observers and group cleanup. [Audio tests](../../tests/live/browser-audio.test.ts) cover tickets, refusal, retry, cancellation and stop; [environment tests](../../tests/remote/remote-descendant-environment.test.ts) cover secret scrubbing. Keep assertions, not old pass counts. Commands and device limits are in the operator guide.

For Bun socket fixtures, send `headers: { Origin: ... }`; ws's `origin` option is not equivalent. The extension dispatcher must distinguish successful upgrade from an unhandled route, or it can return 404 after upgrading. Packaging fixtures must include every new module and license input. Isolate child temp/config state rather than inheriting worker placement or changing product behavior to fix a fixture.

Retired browser recipes and CI diaries are recoverable with `git show f54a51c77863169409c433b5e112d2bddc32d83b:<path>` (repo-relative path). They describe old controls and runs, not the current contract.
