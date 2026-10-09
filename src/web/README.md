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

Open the printed `http://127.0.0.1:3773/#token=...` URL on the laptop. Use the same hostname and port: Host and Origin must match. The localhost tunnel is a secure browser context for microphone permission. The server binds loopback only; public HTTP and reverse-proxy deployment are not supported in this experiment. Treat the token URL like a shell password. Anyone with it can control this terminal.

Click **Enable microphone**, allow browser permission, then type `/live` in the terminal. Existing Live model/key setup still applies. `/live mic-check` checks the browser route without a provider call. The browser captures and plays audio; the remote process owns the provider, agent, files, and tools. No remote audio device is needed. Click **Disable microphone** or use `/live stop` to end voice. Coding jobs are not cancelled. Enable the microphone again explicitly for the next voice session.

## Behavior

- One server owns one terminal. Herdr is not part of this change.
- `--port 0` chooses a free local port. Remote tunnels should use a fixed matching port.
- Arguments after `--` go to Bruv. Example: `bruv web -- --offline --provider openai --model gpt-4o`.
- `bruv web --setup` retains the separate external T3 setup guide.
- The CLI starts on the first authenticated terminal connection. Static pages alone grant no control.
- A new browser attachment detaches the previous browser. Disconnect keeps the CLI alive. Input is disabled while disconnected; it is never queued and replayed later. Browser voice is released, not silently restarted.
- Reconnect keeps the existing xterm screen and resumes from its output cursor. Refresh replays a bounded raw stream (2 MiB). This is not a durable snapshot or resize history. Refresh after earlier resizes is best effort; the next CLI redraw repairs it. Expired replay reports a gap instead of guessing a screen or starting a second CLI.
- Server Ctrl-C/SIGTERM sends TERM to its PTY process group, then KILL after 1.5 seconds if needed. Detached jobs are outside that group. This differs from turning off voice.
- Linux with Bun 1.4.2 is tested. Other platforms and real physical microphone quality are not yet verified.

## Code map

`launcher.ts` starts the server. `terminal.ts` owns the PTY and replay. `browser.ts` owns xterm and explicit audio controls. Browser assets are bundled by `scripts/build/web-assets.ts` and embedded through `assets.ts`; the installed binary needs no browser-side CDN or node_modules.

`server.ts` reserves `/api/terminal` and `/api/live/audio`. Terminal sockets use token subprotocols and exact Origin/Host checks. Browser audio uses the same token and Origin checks plus a fresh capability for the controlling browser attachment. Disconnect or replacement closes both audio peers on the server. CLI audio has no Origin and authenticates with a separate secret passed only to the owning CLI. Tool and delegated-worker environment copies strip the relay credentials. The server-local audio identity is `terminal`; each server has a fresh secret. Audio sockets use channel `live-audio`. `/audio-worklet.js` serves the capture worklet from the same origin, so CSP does not need blob scripts.

Other optional extensions still use authenticated `/api/*` routes and their own socket channels. Return `"upgraded"` after successful upgrades. Their stop hooks are awaited with PTY cleanup.

## Checks

```sh
bun run check
bun run build
bun test tests/web tests/live/browser-audio.test.ts tests/t3/web-launcher.test.ts
# Use installed test tools; Playwright is not a production dependency.
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-smoke.mjs
CHROMIUM_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs bun scripts/web/browser-audio-probe.ts
```

The first browser check runs the compiled CLI, enables fake browser media, pastes and runs `/live mic-check`, confirms device release, and checks typing, reconnect, refresh, narrow layout, and shutdown. The second checks real browser capture frames, playback queues, capture gates, interruption flush, stop, and explicit reconnect. Fake media and a fake-provider command test are not audible-speech or paid-provider acceptance. Physical speech quality remains a manual check.
