# Gemini buffered speech: control before attribution (2026-10-05)

Branch: `bruv/fix-buffered-live-speech-acceptance-1fdf16c3`
Worktree: `/home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_1fdf16c3`

Follow-up to [startup audio queue testing](startup-audio-queue-testing.md).
Production startup buffering and production automatic VAD are unchanged.

## Observed boundary, not a production fix

The first additional Google session was normal **post-ready paced input**, bypassing
StartupAudioQueue entirely. It failed just like queued paced replay. Both used the
same production VoiceSession implementation, model/config and deterministic espeak
fixture (separate single-use provider connections, not one reused connection).
Client send counts alone were not recognition proof.

The actual selected model was **gemini-3.8-live**. Setup: AUDIO output, input/output
transcription enabled, automaticActivityDetection.disabled=false, fixture system
instructions, no tools. sendAudio sends SDK audio data with audio/pcm;rate=16000;
no activity markers. Installed/resolved SDK is **@google/genai 2.27.0**,
dist/node/index.mjs (older wisdom mentions 2.24.0). Its sendRealtimeInput serializes
realtimeInput.audio; setup passes realtimeInputConfig through. No observed SDK
serialization bug or production session defect was established.

Current primary docs, fetched HTTP 200:
- https://ai.google.dev/gemini-api/docs/live-api/capabilities
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live

Capabilities explicitly uses gemini-3.8-live in the automatic-VAD example. Automatic
VAD is the default; a >1-second paused stream should send audioStreamEnd to flush
cached audio. **Manual markers are for disabled automatic VAD**, not a documented
requirement of this model with automatic VAD enabled. Testing the documented pause
flush did not recover this fixture's automatic-VAD response.

With automatic detection disabled and explicit activityStart/activityEnd, the same
fixture was recognized and answered in normal control, queued paced and queued burst.
The previous probe conflated speech retention with automatic detector acceptance of
synthetic espeak audio. Framing fixes the retention test, not production VAD. Why the
automatic detector does not activate for this fixture remains unknown; do not infer
that every microphone stream or this model generally needs manual markers.

## Exact paid commands and evidence

Exactly **six** additional Google sessions; no retries, no further paid work. Each
session had a 35-second close deadline / 34-second observation window; commands had
40-second outer bounds. No microphone, speaker or persisted audio. The supplied key
was read only by loadLiveKey through explicit --gemini-live-env; no import, copy,
credential output, alternate lookup or storage mutation. Safe diagnostics only.

Each command below starts with:

```sh
BRUV_RUN_LIVE_STARTUP_SPEECH=1 bun scripts/probe-live-startup-audio.ts --gemini-live-env
```

| # | Additional arguments | Result | Setup/replay/elapsed ms | Output audio bytes |
|---|---|---|---|---|
| 1 | --mode=control | fail, no transcript/audio/turn | 689 / 4933 / 34000 | 0 |
| 2 | --mode=paced | fail, no transcript/audio/turn | 665 / 4915 / 34002 | 0 |
| 3 | --mode=control --flush-after-pause | fail, no transcript/audio/turn | 674 / 4923 / 34008 | 0 |
| 4 | --mode=control --manual-activity | pass | 1303 / 4931 / 10438 | 155040 |
| 5 | --mode=paced --manual-activity | pass | 1354 / 4924 / 10797 | 149762 |
| 6 | --mode=burst --manual-activity | pass | 1265 / 4 / 8257 | 228962 |

All sent 152146 PCM bytes / 4754.5625 ms, including 1200 ms trailing silence; all
provider error-code arrays empty. #3 flushed at 7098 ms: two raw SDK messages, zero
serverContent/input/audio messages. #4/#5/#6 each recognized all four expected words
in order, input finished=true, output transcript/audio=true and turnComplete=true;
raw message totals 33/35/45, voiceActivity counts 2/2/2, input transcript counts 1/1/1.
These provider callbacks, not send counts, establish **manually framed retention**.
Automatic-VAD acceptance still failed. No stream-end was sent for manual trials;
their turn-end-before-stream-end=true is not silence-only VAD proof.

## Probe changes and local checks

Only scripts/tests changed: explicit post-ready control; selectable one-trial modes;
optional separate flush/manual policies; raw provider event counts without content;
word-match count instead of word strings; separately labeled silence-only, manually
framed and flushed acceptance booleans. Manual mode cannot combine with automatic
flush or OpenAI. Google-only live.env credential selection stays explicit/read-only.
Production remains unbuffered and automatic-VAD enabled.

Test-first control and flush regressions initially failed on missing exports. Added
regressions verify ready gating, complete ordered PCM, pace, pause flushing, preserved
model/system/transcription setup, automatic-VAD default and manual wire ordering.
Final probe framing extraction was checked offline after the six paid trials; no
seventh real-provider revalidation was attempted.

Local commands:
```sh
bun test tests/live-startup-speech-probe.test.ts tests/live-startup-audio-queue.test.ts tests/live-session.test.ts tests/live-credentials.test.ts
bun node_modules/typescript/bin/tsc --noEmit
bun node_modules/@biomejs/biome/bin/biome check scripts/probe-live-startup-audio.ts tests/live-startup-speech-probe.test.ts
bun scripts/probe-live-startup-audio.ts --fixture-only
git diff --check
```

Final checks: **37 pass, 0 fail, 183 assertions** across four focused files;
TypeScript and selected-file Biome checks passed; git diff --check passed.
Fixture-only: 152146 bytes, 4754.5625 ms, 1200 ms zero silence tail.
Existing untrusted mise.toml warning did not stop Bun; no trust/config change.

Values unchanged: existing honest-proof and test-the-real-boundary values cover this.
Remaining: automatic-VAD speech acceptance (including natural/device audio), its
underlying failure cause, and production startup buffering are **not proven/fixed**.
Do not ship buffering or switch production to manual activity from this evidence.
