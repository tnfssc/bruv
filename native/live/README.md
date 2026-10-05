# Experimental native macOS Live Lab audio helper

Build locally with Xcode Command Line Tools / Xcode: `scripts/build-live-helper.sh`.
The script builds `dist/live-audio` and runs `--self-test` (no devices). Linux C ring tests:
`clang -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined native/live/AudioCore.c native/live/test-core.c -o /tmp/live-test && /tmp/live-test`.

Run from a **local interactive terminal** only. The helper emits protocol-v1 `hello` on launch without requesting microphone access or opening a device. Send newline JSON `{"type":"start"}` to request default-device voice processing and permission. Then send `play` with base64 little-endian signed PCM16 mono 24kHz (max 200ms) and matching integer `generation`, or `flush` with a strictly increasing generation. `stop` closes the route. Output: `ready` (includes `voiceProcessingEnabled`, `voiceProcessingBypassed`, `captureRate`, `renderRate` for configuration diagnostics; not acoustic proof), `capture` (PCM16 mono 16kHz, 20ms), `played` (queuedMs, including drain to zero), `stopped`, or sanitized `error`. A `play` command is accepted in its entirety or rejected with `playback_full`; do not assume the rejected audio was queued. The ring is limited to 50 blocks (approximately one second); producers must pace input or stop on this error, not skip the missing tail. Stdin/stdout carry only JSON; audio bytes never go to stderr.

Uses AVAudioEngine voice processing input and full-duplex source output on the current default route, AVAudioConverter capture rate conversion, and bounded lock-free SPSC rings between callbacks and non-realtime JSON/resampling code. Playback output uses linear interpolation from 24kHz; this is a prototype, not production-quality output reconstruction. Capture overflow reports `capture_overflow` with lost frame count; playback overflow rejects the whole play command with `playback_full`. A pipe that stops reading causes a nonzero helper exit rather than an unbounded backlog or silent loss. route changes stop rather than silently switching to another device. For meaningful acoustic echo cancellation, test on actual Mac hardware with permission and speakers, not CI.

macOS microphone TCC permission is attributed to the launching app/Terminal or signed executable, depending on launch context. A usage-description plist is embedded at link time; local unsigned binaries may require terminal microphone permission. For distribution, sign the helper with your own Developer ID and appropriate hardened-runtime microphone entitlement (`com.apple.security.device.audio-input`); sign after building, then validate permission on a consenting physical Mac. This repo does not ship a signed binary. macOS CI compilation/self-test never opens devices and cannot verify permission, latency, or echo suppression.

The tap buffer size is advisory; callbacks are split into ring-sized slices with no allocation or logging. The output uses a mono noninterleaved Float32 source format connected to the mixer for channel conversion. The helper delays reporting ring drain to zero by 200ms to avoid treating the final callback as immediately audible. **Neither ring zero nor this grace period is proof that the mixer, OS, device or acoustic path is silent.** Stop and flush deliberately discard queued sound; ordinary turn boundaries must not call either. CI tests pure queue admission, tail interpolation, generation flush and capture-overflow accounting under ASan/UBSan; Swift compilation/route behavior still needs macOS CI and physical consented validation.

The helper explicitly clears the input voice-processing bypass flag and verifies the enabled/unbypassed state before and after engine start. The source node and processed capture tap share the same engine. On a physical Mac, confirm the ready diagnostics and test speaker echo-only and overlapping user speech with consent; no automated self-test proves AEC. See [speaker echo research](../../wisdom/live/macos-speaker-echo-research.md).

## Capture-origin push-to-talk gate (both native helpers)

Protocol v1 hello advertises `"captureGate":true`. Opt in **before start** with
`{"type":"capture_gate","epoch":null}`. Capture remains running locally but
muted samples are discarded, not queued for the next hold. Open with a unique,
strictly increasing nonnegative int32 epoch; close with null. There is no command
acknowledgement. The JavaScript `setCaptureGate(epoch)` promise means stdin
accepted the command, not that acquisition has opened. Opening may drop the first
buffer(s); it never recovers speech recorded before the native opening boundary.
Once opted in, every emitted capture has `epoch` alongside `data`.

The sender must mute immediately on release and compare the callback's optional
second argument `capture(pcm, epoch)` against its active hold. Old capture already
in stdout keeps its original epoch and must be discarded, never relabeled.
Without opt-in, the original untagged continuous capture behavior is unchanged.
Older helpers without the capability are rejected by the JS gate API.

macOS uses the tap buffer's acquisition host time, drops entire buffers beginning
before the opening boundary (including straddling buffers), tags ring insertion,
rejects stale ring tags on drain, and resets AVAudioConverter plus its partial
20ms packet on transitions. An unknown tap timestamp is discarded in gated mode.
Linux keeps Pulse record and playback streams uncorked. While opening it discards
capture and requests a fresh server timing snapshot. Its frontier is the record
write index plus the reported source-latency samples; read indices before that
frontier are discarded, even when old PCM arrives after the hold starts. Local
capture backlog/half-packets are cleared and WebRTC mic processing state reset.
Unusable timing fails closed. These are native buffer-origin guarantees, not
claims about opaque device DSP, acoustic echo suppression, or terminal key events.

Focused portable regressions: `bun test tests/live-audio.test.ts tests/live-capture-gate.test.ts`.
The C ring gate tests run on Linux too; Swift source checks do not substitute for
macOS compilation and consenting physical-device validation. An opt-in native
protocol check is `python3 native/live-linux/tests/capture-protocol.py HELPER MIC.monitor SINK`;
use only explicitly isolated virtual endpoints (for example the private graph
setup in `scripts/live-isolated-audio.sh`), never desktop hardware/default routes.
