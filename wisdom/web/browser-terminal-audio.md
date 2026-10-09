# Browser audio for the real terminal CLI Live path

This is an audio device replacement, not a second web voice agent. Old web Live adapters were removed (see [removal](../releases/web-live-removal-release.md)); none were reused. The actual CLI extension retains all provider credentials, orchestration, transcripts, interruptions and job authority.

## Parent terminal-server mount contract

Import `createAudioRelay` from `src/web/audio-relay.ts`. Configure `{ allowedOrigins: [externalOrigin], authorizeBrowser(request, sessionId) }`. The callback MUST check ordinary web authentication and ownership of that exact terminal session. Origin is exact scheme/host/port; never wildcard. Use secure web cookies and HTTPS for remote browsers. CLI relay sockets reject any Origin and require the private session secret in their first message. Browser sockets require Origin/auth but never receive that secret.

On terminal spawn, call `relay.registerSession(terminalSessionId)` once. It returns a random 256-bit secret. Set only that child's environment:

- `BRUV_LIVE_RELAY_URL=ws://127.0.0.1:PORT/api/live/audio?role=cli&session=ENCODED_SESSION` (loopback on the server), or a wss URL.
- `BRUV_LIVE_RELAY_SECRET=RETURNED_SECRET`.

Neither variable is needed for native CLI audio. Partial/invalid configuration fails closed, never opens the remote OS microphone. Non-loopback CLI ws URLs are rejected. Do not expose secret through HTML, browser URL, terminal messages, logs, or global environment.

Fetch dispatcher: `if (relay.matches(request)) return await relay.upgrade(request, server);`. Successful upgrade returns undefined (Bun convention); failed requests return a Response. Other requests remain the parent's responsibility. Bun WebSocket data is discriminated by `channel: "audio"` (exported `AudioRelayData`). Dispatch open/message/close to `relay.websocket` only for that channel; keep terminal sockets separate. Set Bun's `maxPayloadLength` to a bounded value (audio messages <=16,000 bytes); the relay also validates message size, direction, PCM length and epochs. Per socket buffering is capped at 64 KiB. Set normal WebSocket idle/ping settings to detect broken network connections. No routes for provider keys or tools exist here.

Call `relay.unregisterSession(id)` on terminal disposal/logout; closes both audio sockets, revokes secret. One browser and one CLI per registered session; duplicates cannot replace active owners. CLI authentication timeout 5s, paired-browser timeout 30s. Disconnect either peer closes both; CLI observes device loss and stops capture/provider, NOT coding jobs. Audio control/data isn't buffered while waiting for a peer.

## Browser caller

Import `connectBrowserAudio` from `src/web/browser-audio.ts` (browser-only module; no Bun imports). Put an Enable audio button alongside the exact terminal instance. DIRECTLY in its click handler call `await connectBrowserAudio({ url, onState })`. URL is same-origin `wss://HOST/api/live/audio?role=browser&session=ENCODED_SESSION` (ws on localhost HTTP). Authentication is the browser's normal cookie. The returned `{ close(): Promise<void> }` releases tracks, AudioContext, worklet and socket. Close when terminal is disposed or ownership changes. Do not change its session URL when another terminal is selected; explicitly close/re-enable instead. onState emits connecting/enabled/running/closed/error; show these plainly. Browser disconnect or /live stop requires another Enable audio click before restarting. Click opens the browser media device; capture is not sent until CLI /live starts. Permission refusal fails with a sanitized message.

The device contract is PCM16 little-endian mono: input 16kHz, 20ms (640 bytes); output 24kHz, <=200ms (9600 bytes). Browser worklet resamples capture using window averages and tags acquisition-time PTT epochs. Output uses Web Audio scheduling, <=1s queue, interruption flush and queuedMs reports. Google receives 16k directly; OpenAI's existing adapter still does its 16k->24k conversion; GPT-Live receives the existing 16k microphone input. No provider wire format changed. Echo-cancellation constraints request browser processing, not proof of acoustic effectiveness.

## Proof / limitations

Validation (2026-10-09): full `bun test tests/live` passed **613 tests**, 4 skips (paid GPT-Live/OpenAI/Gemini acceptance and existing optional diagnostic test), no failures. Added exact-session pairing/revocation coverage afterwards: focused browser tests passed **9 tests** including actual TUI route proof. `bunx tsc --noEmit` passed; new-file Biome lint/format and git diff whitespace checks passed. Existing extension lint warnings (control-character cleanup/non-null PTT assertion) are pre-existing, not new transport warnings.

Proof levels:
- Real Bun HTTP/WebSocket relay sockets: owner auth/origin checks, bad secret, duplicate non-replacement, exact-session pairing, revocation, invalid/tool messages, bounded PCM and server backpressure, capture gates, playback epochs, stop acknowledgement.
- Real CLI extension /live start command + fake provider and browser PCM: default env device selection, capture reaches provider, browser loss closes provider/owner, no job cancellation.
- Actual source CLI in tmux, remote SSH/web markers, built-in /live mic-check: visible browser-specific consent, default relay route start/stop, no native helper/provider/device. This is not just a fake command handler.
- Browser client with fake Web Audio/media devices over actual relay: 24k playback scheduling, flush, capture forwarding, track/AudioContext release; acquisition worklet executes 48k->16k PCM/epoch proof.

No Chromium binary was found locally. Browser APIs above were simulated, not an actual browser engine. Offline/fake PCM and provider proof is not real speech, acoustic quality, or paid provider acceptance. HTTPS/microphone permission, autoplay activation, echo cancellation and actual remote reconnection still need real browser/manual acceptance. AudioWorklet requires a secure context (localhost is allowed). No browser transport dependency or terminal launcher/build edits in this slice.

Values unchanged: existing whole-user-path and honest-evidence principles already apply. This note supersedes historical direct-provider/WebRTC web designs for this requested remote terminal flow.

## Mount sketch (parent-owned server/client)

```ts
const relay = createAudioRelay({
  allowedOrigins: [publicOrigin],
  authorizeBrowser: (request, id) => authenticateAndOwnTerminal(request, id),
});
const secret = relay.registerSession(id);
// Spawn the ordinary PTY CLI with per-child env; do not add these to browser bootstrap:
const env = { ...childEnv,
  BRUV_LIVE_RELAY_URL: "ws://127.0.0.1:" + port + relay.pathname + "?role=cli&session=" + encodeURIComponent(id),
  BRUV_LIVE_RELAY_SECRET: secret,
};
// Bun server dispatch:
fetch: async (request, server) => relay.matches(request)
  ? relay.upgrade(request, server)
  : terminalFetch(request, server),
websocket: {
  open: ws => ws.data.channel === "audio" ? relay.websocket.open(ws) : terminalWs.open(ws),
  message: (ws, data) => ws.data.channel === "audio" ? relay.websocket.message(ws, data) : terminalWs.message(ws, data),
  close: ws => ws.data.channel === "audio" ? relay.websocket.close(ws) : terminalWs.close(ws),
},
// Browser click callback, with same-origin WS URL issued for this terminal only:
const device = await connectBrowserAudio({ url: audioUrl, onState: showAudioStatus });
// Terminal disposal/ownership change:
await device.close();
relay.unregisterSession(id);
```

Do not call browser enable automatically at startup (activation/consent). Do not silently reconnect an old browser capture after /live stop. The mic-check startup proof does not verify speech recognition, acoustic echo cancellation, interruption audibility, or remote TLS/cookie deployment. Parent still owns wiring and a real browser/provider/manual acceptance pass.

## Parent integration follow-up

The terminal and browser controls are now wired. See [integrated experiment](browser-terminal-live.md) for real Chromium and compiled CLI evidence. Socket channel is now live-audio. The browser passes its terminal token through WebSocket subprotocols, and loads /audio-worklet.js from the same origin instead of a blob URL. The earlier mount sketch describes the worker handoff, not current server wiring.
