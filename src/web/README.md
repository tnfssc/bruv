# Browser terminal

Run `bruv web` in a project. Open the printed token URL. This is xterm.js attached to a native Bun PTY running the ordinary Bruv CLI, not a separate chat app.

## Remote use

On the remote machine:

```sh
bruv web --port 3773
```

On your laptop:

```sh
ssh -N -L 3773:127.0.0.1:3773 your-host
```

Open the printed `http://127.0.0.1:3773/#token=...` URL on the laptop. Use the same hostname and port: Host and Origin must match. The localhost tunnel is a secure browser context for microphone permission. The server binds loopback only; public HTTP and reverse-proxy deployment are not supported in this experiment. Treat the token URL like a shell password. Anyone with it can control every workspace and terminal on this server.

Type `/live` in the terminal and allow browser microphone permission. Existing Live model/key setup still applies. `/live mic-check` checks the browser route without a provider call. The browser captures and plays audio; the remote process owns the provider, agent, files, and tools. No remote audio device is needed. Voice stays bound to the labeled workspace and tab, even when you select another terminal. Use `/live stop` to release voice before starting it in another tab. Coding jobs keep running. Type `/live` again explicitly for the next voice session.

## Folders

The launch folder is the first workspace. Add takes a folder path on the machine running `bruv web`, not on the browser device. Relative paths start from the server's launch folder. Adding the same resolved folder selects its existing workspace without opening another tab or CLI. Symlink paths to that folder count as the same folder; different folders with the same name stay separate. Removing a workspace closes its tabs, not its files.

## Multiplayer

Open the same server URL and token on each device, with its own SSH tunnel when remote. Workspace and tab creation, renaming, and closure appear live. The same tab is the same running CLI: all attached browsers receive its output and can type into its input. Navigation stays local. New viewers do not evict old ones. This is one shared server, not federation between separate servers.

Collaborators share shell authority; there are no user accounts or read-only roles. Only share the token with people you trust to control every terminal. Concurrent typing is an interleaved input stream, not a collaborative document editor. Shared terminal size is the smallest active visible viewport. Hidden views do not shrink it.

Voice has one microphone owner across the server. Everyone sees its workspace/tab; observers cannot silently take another browser's microphone. Shared terminal commands, including `/live stop`, still belong to all trusted collaborators. Observer joins, departures, and tab changes do not stop voice. Release voice with `/live stop`, or disconnect the owner, before starting `/live` from another browser. Only the owner browser captures and plays audio: this is not a group call or shared audio playback.

## Behavior

- Each workspace has its own terminal tabs. Use + to add a tab and the tab menu to rename or close it. The workspace menu holds reload and remove. Compact dialogs confirm shared destructive actions. Each tab owns a real Bruv CLI in that folder.
- On phones, open the workspace drawer from the left end of the tab strip. Escape closes drawers, menus, and dialogs. Tab arrows move between terminals. Connection and voice details appear on hover or keyboard focus; microphone ownership does not follow tab selection.
- Switching workspaces or tabs keeps sessions and output alive. Reload and reconnect use the server-owned in-memory state. Server restart does not restore workspaces or tabs.
- `--port 0` chooses a free local port. Remote tunnels should use a fixed matching port.
- Arguments after `--` go to Bruv. Example: `bruv web -- --offline --provider openai --model gpt-4o`.
- `bruv web --setup` retains the separate external T3 setup guide.
- Each CLI starts on its first authenticated terminal connection. Static pages alone grant no control.
- Disconnect keeps the CLI and other viewers alive. Input is disabled while disconnected; it is never queued and replayed later. Losing the microphone owner releases voice; losing an observer does not. Voice is never silently restarted.
- Reconnect keeps the existing xterm screen and resumes from its output cursor. Refresh replays a bounded raw stream (2 MiB). This is not a durable snapshot or resize history. Refresh after earlier resizes is best effort; the next CLI redraw repairs it. Expired replay reports a gap instead of guessing a screen or starting a second CLI.
- Server Ctrl-C/SIGTERM sends TERM to its PTY process group, then KILL after 1.5 seconds if needed. Detached jobs are outside that group. This differs from turning off voice.
- Linux with Bun 1.4.2 is tested. Other platforms and real physical microphone quality are not yet verified.

## Code map

`launcher.ts` starts the server. `terminal.ts` owns the PTY and replay. `browser.ts` owns xterm and command-requested browser audio. Browser assets are bundled by `scripts/build/web-assets.ts` and embedded through `assets.ts`; the installed binary needs no browser-side CDN or node_modules.

`server.ts` owns the workspace/tab registry. `/api/events` broadcasts revisioned snapshots; REST responses use the same revision, so stale responses cannot overwrite newer state. Terminal sockets share one PTY per tab with private replay for each joining viewer. Exact Host/Origin and token checks still apply. Each attachment gets a private audio capability and a separate public owner ID for shared status. Only the actual microphone attachment loss releases its voice. CLI relay credentials remain root-only and are stripped from tool/worker environment copies. The worklet stays same-origin under strict CSP.

`POST /api/workspaces` returns the revisioned snapshot plus `workspaceId` and `created`. Select that ID locally, even when `created` is false. Reuse does not change tabs, names or revision. New folders get one tab and `created: true`.

Other optional extensions still use authenticated `/api/*` routes and their own socket channels. Return `"upgraded"` after successful upgrades. Their stop hooks are awaited with PTY cleanup.

## Checks

```sh
bun run check
bun run build
bun test tests/web tests/live/browser-audio.test.ts tests/t3/web-launcher.test.ts
# Use installed test tools; Playwright is not a production dependency.
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-smoke.mjs
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-multiplayer-smoke.mjs
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-workspace-design.mjs
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-audio-probe.ts
```

The first browser check runs the compiled CLI, enables fake browser media, pastes and runs `/live mic-check`, confirms device release, and checks typing, reconnect, refresh, narrow layout, and shutdown. The multiplayer check uses independent browser contexts, shared input/output on one PID, live workspace/tab updates, local selection, reload/reconnect, close cleanup, shared resize, and explicit voice handoff. The device probe checks capture frames, playback queues, capture gates, interruption flush, stop, and explicit reconnect. Fake media and a fake-provider command test are not audible-speech or paid-provider acceptance. Physical speech quality remains a manual check.
