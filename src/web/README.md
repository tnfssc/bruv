# Browser terminal

Run `bruv web` in a project. Open the printed token URL. This is Ghostty attached to a native Bun PTY running the ordinary Bruv CLI, not a separate chat app. For the separate T3 frontend, use `bruv web --setup` and the [T3 setup guide](../../wisdom/docs/t3-code/README.md).

## Remote use

On the remote machine:

```sh
bruv web --port 3773
```

On your laptop:

```sh
ssh -N -L 3773:127.0.0.1:3773 your-host
```

Open the printed `http://127.0.0.1:3773/#token=...` URL on the laptop. Use the same hostname and port: Host and Origin must match. The localhost tunnel is a secure browser context for microphone permission. The server binds loopback only; public HTTP and reverse-proxy deployment are not supported. Treat the token like a shell password. Anyone with it can control every workspace and terminal on this server. There are no user accounts or read-only roles.

## Folders and tabs

A folder is a path on the server. A workspace is its shared registry entry. Each tab owns one CLI and PTY. A view is one browser's attachment to that tab.

The launch folder is the first workspace. **Open folder** takes a path on the machine running `bruv web`, not on the browser device. Relative paths start from the launch folder. Opening the same resolved folder selects its existing workspace without creating another tab. Symlinks count as the same folder; different folders with the same name stay separate. Bad paths keep the draft and show a local error.

Use **+** to open a terminal tab. Double-click or double-tap its title, or focus it and press F2, to rename. Enter saves; Escape or blur cancels. A failed save keeps the draft. Use the tab's close button or the workspace's Remove button for shared deletion. Confirmations name the shared impact. Close and Remove can stop work and descendants for everyone, even after the CLI exits. They never delete folder files.

On phones, open the workspace drawer from the left end of the tab strip. Escape closes drawers and dialogs. Arrow keys, Home and End navigate the tab strip. Connection and voice details appear on hover or keyboard focus.

## Shared terminals

Open the same URL and token on each device, with its own matching SSH tunnel when remote. Creation, renaming and deletion appear live. The same tab is the same running CLI: all attached browsers receive its output and can type into its input. Concurrent typing is an interleaved stream, not a collaborative document editor.

Navigation stays local. New viewers do not evict old ones. Switching tabs or workspaces keeps sessions alive. Shared terminal size is the smallest active visible viewport; hidden views do not shrink it. This is one shared server, not federation between servers.

## Voice

Type `/live` in the terminal and allow browser microphone permission. Existing Live model/key setup still applies. `/live mic-check` checks the browser route without a provider call. The browser captures and plays audio; the server's CLI owns the provider, agent, files and tools. No remote audio device is needed.

One browser owns voice across the server. Voice stays bound to its labeled workspace and tab, even when you select another terminal. Run `/live stop` in the voice tab before starting `/live` elsewhere. Coding jobs keep running. Only the owner browser captures and plays audio; this is not a group call.

Page load, selection and observer joins never request a microphone. Observers cannot silently take ownership. Trusted collaborators can still submit commands in the shared voice tab. Owner disconnect releases voice; observer disconnect does not. Pending **Cancel** releases the request. Browser permission prompts themselves cannot be closed by app code; a late permission result is discarded and its tracks stopped. Start `/live` again explicitly to retry.

## Recovery and options

Reload and reconnect use server-owned in-memory state and keep the same CLI. Input is disabled while offline and is never queued for replay. An expired replay shows **View lost** and freezes that view; the original CLI still runs. **New terminal** does not replace or stop it. Fresh views after old resizes are best effort until a CLI redraw. Server restart does not restore workspaces or tabs.

- `--port 0` chooses a free local port. Remote tunnels need a fixed matching port.
- Arguments after `--` go to Bruv. Example: `bruv web -- --offline --provider openai --model gpt-4o-mini`.
- Closing a browser detaches its views. Explicit tab/workspace deletion or server shutdown stops owned PTY process groups. Detached Bruv jobs are outside that cleanup.

## Developer checks

```sh
bun run check
bun run build
bun test tests/web tests/live/browser-audio.test.ts tests/live/browser-audio-tui.test.ts tests/dependencies/ghostty-web-patch.test.ts tests/t3/web-launcher.test.ts tests/t3/web-launcher-process.test.ts tests/packaging/prepare-assets.test.ts
# Use installed test tools; Playwright is not a production dependency.
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-smoke.mjs
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-multiplayer-smoke.mjs
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-ui.mjs
bun scripts/web/browser-transport.mjs
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-audio-probe.ts
```

The smoke checks compiled CLI input, reconnect, refresh, narrow layout and device release. Multiplayer checks shared PID/input/output, local selection, shared size and voice handoff. The audio probe checks capture, playback, interruption, stop and reconnect. Fake media/provider checks do not prove audible speech or paid-provider acceptance.

See [server and voice ownership](../../wisdom/web/browser-terminal.md), [renderer updates and limits](../../wisdom/web/ghostty-renderer.md) and [surface decisions](../../wisdom/web/surface-rethink.md). Inspect populated desktop and phone views, not just passing assertions. Physical microphone, phone keyboard/IME, Safari/iOS and real screen-reader use still need human checks.
