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

## Parent check and next test

Worker commit 5f6c34ff90d704408009bc9c842f875686b07dcd brought back as b5c48315.
Integrated focused suite: 37 passed, 0 failed. diff check passed.
Natural-speech follow-up job: task_28db202e.
Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_28db202e
Branch: bruv/check-live-replay-with-natural-speech-28db202e
Use a known natural-sounding fixture in memory, generated from text if needed.
Budget is four sessions total, including generation; <=35 seconds each, no retries.
Compare automatic-VAD normal control, queued paced, queued burst on same fixture.
No mic/speaker, credential writes or production buffering yet.
Await evidence and bring useful test-only changes back.

## Natural voice follow-up: automatic turns, exact retention still fails

Branch: bruv/check-live-replay-with-natural-speech-28db202e
Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_28db202e
Paid job: task_6ca45b2c. One invocation, exactly four additional Google sessions,
no retries; each below 35 seconds. Outer command bound: 150 seconds.

No existing repo wav/pcm/mp3/flac/ogg fixture was found (node_modules excluded).
Added test-only `--fixture=gemini-natural`: one Gemini spoken response to the
known phrase, captured only in process memory. Same supplied key via loadLiveKey
only; no key/audio files, exports, transcript logs, microphone or speaker.
Production startup/VAD are unchanged. All sessions used gemini-3.8-live.
Generation uses text-triggered completion, **not** automatic input-VAD proof.
Trials retain production session setup/transcription/automatic VAD and existing
probe instructions. Same PCM object reused for control, queued paced, queued burst.

Exact paid command:
```sh
BRUV_RUN_LIVE_STARTUP_SPEECH=1 bun scripts/probe-live-startup-audio.ts --gemini-live-env --fixture=gemini-natural
```

Generation: pass, 5045 ms, exact known-word count 4/4 in output transcription.
PCM24 mono: 170402 bytes, 85201 samples, peak 21698, nonzero 82125, clipped 0.
ffmpeg band-limited pipe-only resampling to PCM16 mono: final 152002 bytes,
76001 samples, peak 21730, nonzero 55069, clipped 0; total 4750.0625 ms,
including an exactly zero 1200 ms appended tail. Duration/alignment bounded.

| Trial | Full acceptance | Exact word count | Setup/replay/elapsed ms | Output audio bytes | Raw/input/audio messages |
|---|---|---|---|---|---|
| post-ready control (paced) | fail | 3/4 | 766 / 4931 / 9550 | 202082 | 41 / 1 / 16 |
| queued paced | fail | 3/4 | 1215 / 4917 / 9785 | 188160 | 37 / 1 / 14 |
| queued burst | fail | 3/4 | 637 / 2 / 6359 | 192002 | 43 / 1 / 17 |

All three sent every byte; input transcript=true, input finished=true, output
transcript=true, turnComplete=true, automaticVad=true, voiceActivity count=2,
retainedWords=false, errors=[]. No activity markers or stream-end/flush during
measurement; provider turns occurred before cleanup endAudio. Command exit 1
is failed **exact four-word retention**, not transport/setup/VAD silence.
The JSON silenceOnlyVadAccepted field denotes full acceptance, so remains false
although automatic turns were observed. No manual/flushed acceptance claimed.

Natural speech removes the prior no-response symptom across all three modes.
It does not prove robotic speech caused that symptom or prove exact four-word
retention. Count 3 alone does not identify a missing word, alternative spelling,
numeric rendering or acoustic loss. No transcript was logged to resolve that.
Do not relax exact matching, flip production to manual framing, or ship buffering.
Next: parent decide whether to authorize a bounded count-only recognition diagnostic
(e.g. numeric rendering versus truly missing speech) before the product decision.
No further paid sessions in this task; the four-session budget is exhausted.

Only test tooling changed: fixture selection rejects wrong credential source,
manual/flush mixing and fixture-only paid generation; generation is bounded and
closes on failure; memory-only conversion; rate/channel/amplitude counts; exact
ordered token matching replaces substring matching. Default espeak remains a
legacy diagnostic, not representative automatic acceptance evidence.

Local commands:
```sh
bun test tests/live-startup-natural-fixture.test.ts tests/live-startup-speech-probe.test.ts tests/live-startup-audio-queue.test.ts tests/live-session.test.ts tests/live-credentials.test.ts
bun node_modules/typescript/bin/tsc --noEmit
bun node_modules/@biomejs/biome/bin/biome check scripts/probe-live-startup-audio.ts scripts/live-startup-fixture.ts tests/live-startup-natural-fixture.test.ts
git diff --check
```
42 pass, 0 fail, 219 assertions; TypeScript/Biome/diff checks pass. Initial local
TypeScript check caught the SDK LiveServerMessage mock type; fixed with the SDK
message class. Existing untrusted mise.toml warnings did not prevent Bun; no trust
or credential configuration changes. Values unchanged: existing honest-proof and
real-boundary testing values cover the distinction between VAD and retention.


## Narrow fixed-flag follow-up: exact acceptance passes (2026-10-05)

Branch: `bruv/resolve-live-replay-word-check-318aef23`
Worktree: `/home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_318aef23`
Paid command job: `task_8c555372`; exit **0**, 28764 ms wall time.
The user authorized this bounded diagnostic directly; no new authorization,
credential setup, or research was needed. This closes the prior "next test" for
this task, not a production release gate.

Test-first regression initially failed: 4 pass, 2 fail, missing diagnostic fields.
Implemented only fixed count/boolean diagnostics. Flags have the fixed order
[amber, river, seven, lighthouse]. Presence and greedy ordered checks run for
**each** word even if an earlier word is missing. numeric7 is complete-token
presence; numeric7Order requires amber, river, numeric 7, lighthouse in order.
No provider words, tokens, transcripts, audio or secrets were logged/persisted.
The existing ~/.bruv/live.env was read by loadLiveKey only; no import, copy,
credential storage writes, microphone or speaker use.

Exactly one invocation, **four additional Google sessions**, no retries. One
bounded text-triggered generation followed by control, queued paced, queued burst
on the **same in-memory PCM**. Generation closes at 34 seconds; trials have a
35-second close deadline / 34-second observation window; outer bound 150 seconds.
All used gemini-3.8-live. Production VoiceSession startup and automatic VAD unchanged.

Exact paid command:
```sh
BRUV_RUN_LIVE_STARTUP_SPEECH=1 bun scripts/probe-live-startup-audio.ts --gemini-live-env --fixture=gemini-natural
```

| Session | Exact count/order | Expected presence/order flags | numeric7/order | Automatic turn | Setup/replay/elapsed ms | Output audio bytes |
|---|---|---|---|---|---|---|
| Generation | 4/4, true | TTTT / TTTT | false / false | **not applicable: text-triggered** | — / — / 5209 | 153600 (fixture PCM24) |
| Post-ready control | 4/4, true | TTTT / TTTT | false / false | true | 623 / 4530 / 8594 | 177120 |
| Queued paced | 4/4, true | TTTT / TTTT | false / false | true | 681 / 4552 / 8673 | 178562 |
| Queued burst | 4/4, true | TTTT / TTTT | false / false | true | 723 / 3 / 5692 | 158880 |

Generation source: PCM24 mono, 153600 bytes, 76800 samples, peak 19894,
nonzero 73470, clipped 0. Pipe-only ffmpeg resampling produced PCM16 mono:
140800 bytes, 70400 samples, peak 19907, nonzero 49219, clipped 0. Exactly
4400 ms including a zero 1200 ms tail. Every trial sent all 140800 bytes.
Control/paced/burst raw messages: 37/37/33; input messages: 1/1/1;
audio messages: 14/14/12; voiceActivity messages: 2/2/2. All trials had
input transcript=true, input finished=true, output transcript=true,
turnComplete=true, automaticVad=true, automaticTurnAccepted=true,
silenceOnlyVadAccepted=true, ok=true, errors=[]. No activity markers or
stream-end/flush occurred during measurement. Turns/input/audio preceded
cleanup endAudio. Manual/flushed acceptance fields remained false.

**Result:** the same four expected tokens and order survived all three input
modes, with strict matching. Numeral rendering was **not observed** in any session;
the earlier 3/4 result did not recur. It cannot be attributed retroactively to
numeric rendering, recognition loss, or a particular missing word. Stop here;
no guess and no further paid sessions. An offline-only candidate that mapped the
complete token 7 to seven was exercised as a diagnostic during this command;
its counts/order equaled the strict results in every session. It was **never**
the acceptance criterion and was removed after the negative numeral observation.
The final matcher does not normalize seven or relax arbitrary recognition.
The existing strict count remains matchedWordCount; no normalization fix is
justified by this evidence. Post-run edits only remove unused candidate fields;
strict acceptance and automatic-turn logic are unchanged. No fifth paid run.

The test-probe fix separates automaticTurnAccepted from exact word representation.
It requires automatic mode, no manual markers/flush, input/output transcription,
output audio, turn completion and no errors. Full silenceOnlyVadAccepted also
requires complete delivery and exact ordered words. Generation is explicitly
textTriggeredGeneration=true, automaticTurnAccepted=false; manual framing is
never reported as automatic acceptance.

The prior synthetic espeak fixture's automatic no-response is a detector/fixture
acceptance boundary, not proof of lost startup PCM or a need for manual production
framing. Natural speech now has strict control/paced/burst acceptance proof. The
underlying reason automatic VAD did not accept espeak is still unknown, and the
previous natural fixture's 3/4 matcher cause is **unverified**. Production startup
buffering is still test-only; shipping it, device/microphone/macOS acceptance,
real-user voice quality and broader provider coverage remain outside this task.
No production startup or VAD change was made.

Final local commands:
```sh
bun test tests/live-startup-natural-fixture.test.ts tests/live-startup-speech-probe.test.ts tests/live-startup-audio-queue.test.ts tests/live-session.test.ts tests/live-credentials.test.ts
bun node_modules/typescript/bin/tsc --noEmit
bun node_modules/@biomejs/biome/bin/biome check --write scripts/live-startup-fixture.ts scripts/probe-live-startup-audio.ts tests/live-startup-natural-fixture.test.ts
bun node_modules/@biomejs/biome/bin/biome check scripts/live-startup-fixture.ts scripts/probe-live-startup-audio.ts tests/live-startup-natural-fixture.test.ts
git diff --check
```
Final suite: **43 pass, 0 fail, 234 assertions**. TypeScript, selected-file Biome
and diff checks pass. Existing untrusted mise.toml warnings did not prevent Bun;
no trust/config changes. Only scripts, tests and this wisdom note changed.
Values unchanged: honest evidence, real-boundary tests and bounded work already
cover this distinction; no new general rule is needed.
