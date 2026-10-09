# Browser terminal

Run `bruv web` in a project. Open the printed URL. This is xterm.js attached to a native Bun PTY running the ordinary Bruv CLI, not a chat frontend or bundled T3. No shell wrapper is inserted.

- Default: 127.0.0.1:3773. Use --port 0 for a free port and --host ::1 for IPv6.
- Only loopback bind is allowed. Tunnel it for remote use; browse the same hostname and port printed by the server (the Origin/Host checks are exact).
- Arguments after -- go to Bruv, e.g. bruv web -- --offline --provider openai --model gpt-4o.
- bruv web --setup retains the external T3 guide. --help explains the terminal.
- The token URL grants terminal control with the server user's rights. Do not share it. It is scrubbed from the address bar and kept in sessionStorage for refresh, not localStorage. HTTP API clients send Authorization: Bearer TOKEN and Origin: the exact printed origin. Browser WebSockets offer protocols bruv and bruv-token.TOKEN; the server selects bruv.
- Public static assets do not grant control. No PTY starts until an authenticated terminal socket connects.
- One browser controls one CLI per server. A new attachment detaches the previous browser. Disconnect keeps the CLI alive. Input while disconnected is discarded, never queued or replayed.
- Existing-tab reconnect uses an output sequence cursor and keeps its xterm state. Refresh starts a fresh renderer and replays from zero. Replay is a bounded raw terminal stream (2 MiB), not a durable terminal snapshot or resize history. Refresh after earlier resizes is best effort; the next CLI redraw repairs it. Expired replay explicitly reports a gap and will not display a guessed screen or spawn another CLI. Restart bruv web to begin again.
- Output/socket queues are bounded. Slow sockets disconnect and can replay if still within the window. Exit reports the real CLI code; it does not create a replacement process.
- Ctrl-C/SIGTERM on the server shuts it down. POSIX cleanup sends TERM to the PTY's owned process group, escalates to KILL after 1.5 s, awaits the CLI, and closes the PTY. Detached/new-session jobs are outside that group; this is not a promise to cancel durable Bruv jobs.

## Audio integration interface (no audio implemented here)

Use startWebServer from src/web/server.ts with an optional extension:

```ts
import { startWebServer, type WebExtension } from "./server";
const extension: WebExtension = {
  fetch(request, server) {
    if (new URL(request.url).pathname !== "/api/audio") return undefined;
    if (server.upgrade(request, {
      data: { channel: "audio", /* own connection metadata */ },
      headers: { "Sec-WebSocket-Protocol": "bruv" },
    })) return "upgraded";
    return new Response("WebSocket required", { status: 426 });
  },
  websocket: {
    message(socket, payload) { /* own audio protocol */ },
    // Optional open, close, drain callbacks.
  },
  async stop() { /* release relay resources; do not stop Bruv jobs */ },
};
const app = startWebServer({ command, assets, extension });
```

All /api/* routes first pass shared Host + token + exact Origin checks. Terminal reserves /api/terminal and socket data.channel === "terminal". Use a different channel. Extension fetch returns a Response, "upgraded" after a successful upgrade, or undefined for an unhandled route (404). Do not return undefined after upgrading. The socket payload is string | Buffer; data is SocketData with channel plus arbitrary own fields. Callbacks are dispatched by channel. Global socket limits are 128 KiB per message, 2 MiB backpressure, 60 s idle with pings. Extension stop is awaited along with PTY cleanup by app.stop(), which is idempotent. Returned app fields: server, terminal, token, origin, url, stop().

Launcher integration point: src/web/launcher.ts constructs the server. Audio owner/parent can build an extension there; terminal code imports no src/live module. Browser audio controls can use the token resolved by src/web/browser.ts and the same protocol pair. Asset entry point is scripts/build/web-assets.ts, called by prepare-assets; generated HTML/JS/CSS are embedded file imports in src/web/assets.ts.

## Checks

bun run build
bun run check
bun test tests/web tests/t3/web-launcher.test.ts tests/architecture.test.ts tests/cli tests/packaging
bun run smoke -- --reuse-build

Optional real-browser smoke (Playwright is a test tool, not a production dependency):

bun add --no-save playwright
bun node_modules/playwright/cli.js install chromium
bun scripts/web/browser-smoke.mjs

The browser smoke starts the compiled bruv web command in an owned offline fixture, types into its real editor, reconnects, refreshes, resizes to 390 px, captures ignored artifacts, and sends SIGTERM. Fixtures are retained under /tmp/bruv-web-* for inspection. No paid/provider or physical mic acceptance is claimed.
