# Shared terminals, local selection

Browser slice of multiplayer, 2026-10-09. Code: [browser.ts](../../src/web/browser.ts), [browser.css](../../src/web/browser.css), [index.html](../../src/web/index.html). Builds on [browser terminal](browser-terminal.md) and [browser audio](browser-terminal-audio.md).

## State

Use one authenticated events socket: /api/events with protocols bruv-state and bruv-token.TOKEN. Each state message carries the full workspace snapshot, revision and global voice owner. connectEvents reconnects after loss. The small update status makes a broken feed visible without replacing terminal or mutation errors.

applyState accepts only a higher revision. REST and events use the same gate, so a late GET or mutation response cannot undo a newer event. Reconnect supplies the current snapshot; no separate event log or browser persistence is needed.

Selection stays in the browser's existing sessionStorage. Remote create and rename do not select or focus their new terminal. A selected deletion falls back to the first remaining workspace/tab. Our own create still selects its result, even when events delivered it before REST. Creation APIs append their new item; choose the last new item in the mutation snapshot, then reconcile selection against current state.

Removed tabs dispose their local xterm, reconnect timer and socket. Reconciliation never sends DELETE. Only the explicit close/remove actions send deletion requests, after their existing confirmations.

## Geometry and replay

Each tab keeps its xterm, socket and replay sequence. Joining a terminal starts inactive. resizeSelected uses FitAddon.proposeDimensions to report the local available viewport on selection, attachment readiness or container resize. It never calls fit. A cached viewport avoids sending the same report again after a state render or server size update.

Server size messages resize xterm directly. They do not send a reply or change the local viewport report. The backend chooses the minimum size of visible attachments. hideSession sends visibility active:false and clears the cached report when a tab hides or the document goes into the background. Returning to a tab reports its local dimensions again. Hidden or zero-sized containers do not report dimensions. A socket reconnect clears the report so a new inactive attachment becomes active when ready.

Do not restore local fit calls or wire xterm resize events to the socket. That would override shared geometry and can cause a resize loop. Replay still writes ordered output only; gaps halt the renderer rather than silently starting another terminal.

## One microphone

The snapshot names the global voice tab and attachment ownerId. audio-owner on each terminal socket supplies this browser's attachment capability. renderAudio compares the two. Observers see Voice in another browser plus workspace/tab name, with no disable control for another owner's mic.

The local device stays tied to its original attachment, not selection. Its owner retains the enable/disable control while viewing another tab. Observer joins, departures and socket loss do not release it. Local owner socket loss, disposal, device loss or authoritative release closes that local device. A pending permission request still uses the existing generation check, so a late device cannot reclaim a released owner. Enable is blocked until authoritative voice is null; another browser must click explicitly after release. There is no group call or audio mixing.

## Checks and handoff

- bun run check and bun run build pass.
- bun test tests/web/browser.test.ts: five frontend contract tests pass. They execute the browser entry point with mock DOM, xterm, sockets and devices. They cover monotonic REST/events, remote selection/deletion, event reconnect, local viewport versus shared size, replay and voice ownership. They do not prove actual xterm rendering or media devices.
- bun test tests/live/browser-audio.test.ts: eight existing audio tests pass. These exercise the unchanged audio client/relay contract, not the new shared backend.

Real two-browser checks belong to the integrating parent. This slice has no multiplayer events backend, shared PTY arbitration or global audio owner enforcement. Server-dependent multiplayer acceptance is not yet possible here. Check two differently sized windows, remote create/rename/close, events reconnect plus a late GET, hidden view resize, and owner/observer enable, selection and disconnect. Keep the existing smoke selectors and actual xterm terminals.

Values stay unchanged. This applies their existing one-owner, honest-proof and simplest-working-path guidance; there is no new cross-feature rule.
