# Shared terminal backend

One `TerminalSession` owns each tab PTY. Its attachment map owns connected views, not the process. Joining adds a view. Detaching removes it. Only tab deletion or server shutdown kills the owned process group. All attached views can send input and receive the same output sequence.

## Browser contract

- GET and mutation snapshots keep all old fields and add `revision: number` and `voice: null | {tabId, ownerId}`.
- Connect `/api/events` with `["bruv-state", "bruv-token.TOKEN"]`. The server selects `bruv-state`. Each message is `{type:"state", state:SNAPSHOT}`; open sends the current snapshot. Workspace/tab create, rename, delete, PID, exit and voice-owner changes publish full snapshots in revision order. No selection lives on the server.
- Mutation state is committed and published before deletion teardown waits. Its REST response captures that revision. A delayed response may trail a newer event; the browser must ignore older revisions.
- Terminal `ready` includes the current `cols` and `rows`. A valid `resize{cols,rows}` marks that attachment active. `visibility{active:false}` withdraws it until its next resize. New viewers start inactive. Effective dimensions are the per-axis minimum of active views; no active views retain the last size. Changes broadcast `size{cols,rows}`. Zero/invalid dimensions do not resize the PTY. The browser must not echo size events or send hidden viewport dimensions.
- Each terminal attachment gets `audio-owner{id,ownerId}`. **Keep using `id` as the private `bruv-owner.ID` audio capability. Compare `ownerId` with shared `state.voice.ownerId`.** The public ID is a SHA-256 digest of the random attachment capability, not a usable capability. Broadcasting the capability in shared state would let an observer impersonate the owner after release.

Voice authorization accepts any currently attached capability for that tab. Admission still reserves one global microphone owner before socket open. Observer joins, disconnects and invalid capabilities cannot release it. Its own terminal attachment loss, audio close, CLI audio end or tab disposal releases it. Release never kills the PTY. Stale admissions and late closes cannot release a new reservation. CLI relay secrets remain per-tab and private; descendant environment scrubbing is unchanged.

GET bearer auth may omit Origin. WebSocket upgrades and mutations require exact Origin and Host. No persistence, accounts or federation.

## Bounds and proof

The output ring retains at most 2 MiB of raw PTY output. Replay goes only to the joining client. An expired cursor gets the existing explicit gap, not a partial screen. Each terminal/state socket has a 2 MiB send-backlog bound; a slow client closes independently and may reconnect. Bun native backpressure remains enabled.

Backend tests use real PTYs and sockets for concurrent input/output, ordered state, resizing and voice ownership. A TCP-paused observer exercises native backpressure through an 8 MiB output burst while a healthy view keeps working. A small fake socket also checks the exact per-client queue bound and private replay. Existing expired-replay, process-group shutdown, admission race and auth tests stay in place; old replacement/eviction assertions now test non-evicting joins.

Validation on Linux with Bun 1.4.2:

- `bun run check` and `bun run build` passed.
- `bun test tests/web tests/live/browser-audio.test.ts tests/live/browser-audio-tui.test.ts tests/remote/remote-descendant-environment.test.ts`: 36 passed, 0 failed, 268 assertions across 7 files. This includes the compiled TUI and relay mic-check fixture, plus descendant secret scrubbing.
- Changed TypeScript files pass Biome formatting; `git diff --check` is clean.

Resizing an exited view initially closed its socket because Bun rejects resizing a closed PTY. The terminal now updates shared view size without touching an exited PTY; the event test covers it.

These are backend and compiled-TUI checks, not browser layout, physical microphone, audible speech or paid-provider acceptance. The parent owns browser integration. No package/build/browser files changed.

Values stay unchanged: this follows the existing single-owner, bounded-queue and honest-proof lessons. See [workspace/tab base](workspaces-tabs.md).
