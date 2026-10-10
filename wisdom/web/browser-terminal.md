# Browser terminal ownership

`bruv web` embeds a real terminal renderer and starts the ordinary CLI on authenticated attachment. It is not a chat UI or bundled T3. See the [operator guide](../../src/web/README.md), [renderer](ghostty-renderer.md) and [surface](surface-rethink.md).

## Server and PTYs

One [TerminalSession](../../src/web/terminal.ts) owns each tab's Bun PTY. Attachments own views, not the process. Joining never evicts a viewer. Detach removes a view; tab/workspace deletion and server shutdown stop the owned process group with TERM then KILL. This includes lingering descendants after CLI exit, but not detached Bruv jobs. Deletion never removes folder files.

The [server](../../src/web/server.ts) owns the shared workspace/tab registry and revisioned snapshots. Mutations publish before waiting for teardown. REST replies can trail events; the browser ignores older revisions. Selection stays local. Folder identity uses realpath relative to the launch folder. Opening an existing folder returns its workspace ID without creating a tab, publishing a revision or renaming it.

Visible attachments report available geometry. The server chooses the per-axis minimum and broadcasts it. Hidden views withdraw; with no active views, the last size remains. Size messages must not trigger resize replies. An exited view can change display size without resizing its closed PTY.

Output replay is bounded to 2 MiB and private to the joining view. An expired cursor reports a gap and freezes that view, not the CLI. Reconnect retains the same PID. Never replay or queue human input. Renderer protocol replies are different: each output chunk can claim one reply batch, independent of human authorship. The browser keeps unacknowledged batches within a 2 MiB bound and resends on reconnect; deduplication lives with retained replay, not an unbounded log. An older pending reply whose outcome was evicted reports view loss; it is not falsely acknowledged. Terminal/state sockets have per-client send-backlog bounds; a slow observer closes independently while healthy views continue. Fresh-view replay after old resizes is best effort until redraw. Registry and replay are in memory, not durable restart recovery.

## Access and voice

The token is shared shell authority, not participant identity. Bind loopback. Check exact Host, Origin and token before API dispatch. WebSocket upgrades and mutations require Origin; authenticated GET may omit it. The initial token lives in the URL fragment, then sessionStorage; requests use Bearer auth or a WebSocket subprotocol. Remote use needs a matching SSH tunnel, not public HTTP or an unreviewed proxy mount. Failed state reconnects recheck authenticated HTTP state, because browser WebSocket errors hide upgrade status. Confirmed 401/403 stops input and retries and shows access guidance; network loss still retries.

The [input framer](../../src/web/input-ownership.ts) labels authors without guessing editor commands. Private OSC labels stay outside bracketed paste. The root Live extension consumes them before rendering and scopes a submit hook around the existing CompactEditor input handler and observes its clear boundary. The callback stays a normal composable data callback; the hook restores it after input. Only that real editor boundary resets command authorship; CR can mean a continued line. `/live` captures the submitted one-use ticket before async settings or dialogs. Mixed authorship rejects voice. Unsupported or replaced editors fail closed rather than guessing from the last key.

Repeated same-author input may renew only an unspent ticket for that author. Consumed and detached tickets cannot be renewed. The relay keeps a bounded ticket set; long-lived requests can fail closed after eviction. This is not another text editor or an input replay queue.

The [audio relay](../../src/web/audio-relay.ts) consumes that ticket and targets only its attached browser. Admission needs the matching request and private attachment capability. The server callback owns synchronous exact-Origin, token and attachment checks; the relay owns reservations and one-use admission IDs. There is no extension dispatcher or optional async authorization mode. Shared owner IDs are hashes for display, never credentials. Keep per-tab CLI relay secrets out of browser state, URLs and logs, and strip them from [descendant environments](../../src/delegation-environment.ts). Invalid relay configuration fails closed, not back to a server microphone.

One voice reservation spans the server. Page load, focus, selection and observer joins cannot acquire it. Observers cannot steal or release it. Owner attachment loss, CLI/device error, audio close, cancellation or disposal releases voice without stopping coding work. Stale requests and late closes cannot release a newer reservation. Late permission tracks must stop before capture is wired. Device close shares one in-flight teardown promise: concurrent abort, CLI stop and disconnect wait for it and report closed once. The browser device API requires the server token and private attachment capability; there is no unauthenticated variant. App code cannot dismiss the browser's permission prompt.

Run `/live stop` in the voice tab before requesting voice elsewhere. The command stops that CLI's Live run, not every tab. Trusted collaborators still share command authority. Provider, agent and tool ownership stays in the real CLI; the browser is only its audio device.

## Regression checks

[Workspace/PTY tests](../../tests/web/multiplexer.test.ts), [server tests](../../tests/web/server.test.ts) and [multiplayer tests](../../tests/web/multiplayer-server.test.ts) cover auth, same-PID reconnect, replay gaps, shared geometry, slow observers and group cleanup. [Audio tests](../../tests/live/browser-audio.test.ts) cover tickets, refusal, retry, cancellation and stop; [environment tests](../../tests/remote/remote-descendant-environment.test.ts) cover secret scrubbing. Keep assertions, not old pass counts. Commands and device limits are in the operator guide.

For Bun socket fixtures, send `headers: { Origin: ... }`; ws's `origin` option is not equivalent. Packaging fixtures must include every new module and license input. Isolate child temp/config state rather than inheriting worker placement or changing product behavior to fix a fixture.

Retired browser recipes and CI diaries are recoverable with `git show f54a51c77863169409c433b5e112d2bddc32d83b:<path>` (repo-relative path). They describe old controls and runs, not the current contract.
