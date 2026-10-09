# Bruv in a browser means a real terminal

Task: browser-terminal half of bruv web, 2026-10-09. Source and interfaces: [src/web](../../src/web/README.md). The audio owner integrates separately. Herder is not part of this task.

The old web command printed an external T3 guide. We keep that under bruv web --setup. The default command now starts a loopback HTTP/WebSocket server and launches the ordinary CLI in a PTY when an authenticated browser attaches. It is not another chat UI and it does not bundle T3.

## What we learned

Bun 1.4.2 has native Bun.Terminal. A small probe got a real TTY, stty size 31 91, and exit 0. Its POSIX PTY child was a process-group/session leader with PID = PGID = SID. We can use that group for shutdown instead of adding node-pty or a shell wrapper. Shutdown tests cover a CLI that ignores TERM and its child tool. TERM then KILL reaps both and releases sockets. Detached Bruv jobs are not covered by PTY group cleanup.

Use an actual terminal renderer. xterm.js 6.0.0 and addon-fit 0.11.0 are bundled at build time and embedded into the normal executable. The compiled CLI does not need node_modules, a CDN, or a separate asset install. Existing release names and version stay unchanged.

A token is shell access. Bind loopback only. Require an exact Host and Origin plus the random token before any API dispatch, including future audio routes. Put the token in the initial fragment, then sessionStorage; send it in a WebSocket subprotocol or HTTP Bearer header. Do not make an unauthenticated fallback or a broad Origin list. Tunnel users must preserve the printed browser origin.

A terminal replay is not conversation history. Reconnect must keep the same PID and disable input while offline. Only output is replayed, never input. Keep a bounded raw replay window and report gaps. This first version does not save durable terminal snapshots or resize history; refreshing after past resizes is best effort until the next CLI redraw. Existing-tab reconnect retains its renderer. An expired replay or exited CLI does not create a replacement. These limits are deliberate and documented, not hidden recovery claims.

WebSocket tests under Bun need headers: { Origin: ... }, not ws's origin option. Bun uses its own WebSocket implementation and ignored that option in our probe. Also avoid Bun console color escapes in fixture assertions about booleans/numbers. The first timeouts were test setup errors, not PTY failures.

An extension fetch needs to distinguish a successful upgrade from an unhandled route. The interface returns "upgraded" for the former and undefined for the latter. Otherwise the HTTP dispatcher can return 404 after an extension upgraded. A focused extension socket test proves the seam before audio code is attached.

## Proof and limits

Focused tests cover shared token/Origin/Host protection, no pre-auth CLI startup, PTY input and resize, same-PID reconnect and bounded replay, actual exit code, failed startup without retries, owned group shutdown, and the authenticated extension WebSocket seam.

The compiled Bruv TUI starts offline in an owned home/config/agent fixture. Its model footer renders and typing reaches its actual editor. A Chromium smoke opens the printed compiled bruv web URL, types browser PTY input, reconnects, refreshes, and resizes to 390 px. Wide and narrow screenshots were inspected. No page errors or horizontal page overflow; server SIGTERM exits 0. Reproduce with scripts/web/browser-smoke.mjs. Screenshots and disposable outputs stay ignored under artifacts; fixtures stay under /tmp/bruv-web-*.

Final checks passed: bun run check, paired bun run build, 98 tests across terminal/T3 guide/architecture/CLI/packaging, paired standalone smoke, production notice generation (including the two xterm packages), Chromium smoke, and git diff --check. Focused lint exits 0 with existing-style warnings (non-null assertions and assignment expressions); no clean-lint claim.

This is Linux/Bun 1.4.2 proof. macOS, Termux, real paid-provider requests, physical mic/audio, and parent whole-flow integration remain separate acceptance. No src/live edits or audio relay were made.

Values unchanged. Values 1 (requested mechanism), 2 (honest proof), 5 (bounded use), 6 (owned cleanup) and 10 (handoff with exact interfaces) already cover the lesson. Keep PTY/browser details with this feature instead of adding another general rule.
