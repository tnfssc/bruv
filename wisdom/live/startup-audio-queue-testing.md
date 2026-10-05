# Startup audio buffering: testing only (2026-10-05)

Production Live flow unchanged. No devices, credential import, or paid session.
Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_280b61da
Branch: bruv/test-live-buffered-startup-audio-280b61da

Read values.md and Live acceptance/provider/VAD test notes. Values unchanged:
existing truthful-proof, bounded-queue and single-owner values cover this experiment.

## Commands/results

```sh
bun test tests/live-session.test.ts tests/openai-session.test.ts tests/openai-session-schema.test.ts tests/openai-session-diagnostics.test.ts tests/gpt-live-session.test.ts tests/live-startup-audio-queue.test.ts tests/live-provider.acceptance.test.ts tests/live-openai-provider.acceptance.test.ts tests/live-gpt-live-provider.acceptance.test.ts
```

Existing baseline: 76 pass, 3 opt-in skips, 0 fail. Final: **89 pass, 3 skips,
0 fail**, 830 assertions, 9 files (534 ms). Thirteen new test-only checks use actual
VoiceSession, OpenAIRealtimeSession and GPTLiveSession with fake SDK/socket transports.
They copy distinct PCM chunks during delayed connect, wait for provider readiness
(not transport-open), preserve fresh audio during/after burst or paced drain, and
discard stopped/failed startup including late ready. Byte-limit overflow fails explicitly.
OpenAI/GPT comparisons include streaming 16→24 kHz resampling with one held sample.

- `bun node_modules/typescript/bin/tsc --noEmit`: passed after fixing probe stdin typing.
- Selected-file Biome format/lint: passed. Installed Bun 1.4.2 works despite the shell’s
  untrusted mise.toml warning; no trust/config change.
- `bun scripts/probe-live-startup-audio.ts --fixture-only`: passed; 152146 PCM bytes,
  4754.5625 ms, including 1200 ms verified trailing silence; espeak-ng/ffmpeg in memory.
- `BRUV_RUN_LIVE_STARTUP_SPEECH=1 bun scripts/probe-live-startup-audio.ts`: exit 1.
  Both google/openai canonical credential states **missing**, loadKey unavailable,
  paidSessions=0. Explicit BRUV_GPT_LIVE_ACCEPTANCE_API_KEY absent too. No keys logged.

The opt-in speech probe allows only four sessions: Gemini/OpenAI Realtime × burst/
20 ms paced, 35 seconds each, no retries. It buffers speech during setup and checks
four distinctive transcript words in order, output transcript/audio, and remote
turn-end from trailing silence before stream-end/forced commit. Logs are booleans/
counts, not transcripts. Its credentialed path was NOT exercised here. Existing
provider acceptance tests stayed skipped because credentials were absent; no claim
about network reachability. GPT-Live is separate and lacks remote speech evidence here.

## Conclusion/gap

Local retention/order is demonstrated in the test-only adapter experiment. Mocks
are NOT proof that remote VAD recognizes all buffered words or handles burst replay.
Need existing credentials in the executing runtime and the bounded opt-in speech
run. No production buffering or physical capture-start/latency claim is warranted.

## Parent check

User asked for testing before more investigation. Worker task_280b61da finished.
Worker commit: 074428027f8b313abcf88c2c9f1cb14d137bd4ad. Brought back as 4e09a680.
Parent read the queue and speech probe and reran the 13 FIFO tests in the worker tree.
Production is unchanged. Next step is the credentialed speech probe, not more mock claims.
Paced replay alone does not catch up if fresh audio arrives at the same rate.
The remote probe compares a fixed utterance; it does not prove continuous capture catch-up.

Integrated FIFO rerun: 13 passed, 0 failed. First run lacked @google/genai;
`bun install --frozen-lockfile` fixed the local dependency gap. Lockfile unchanged.
`git diff --check` passed.

## Explicit supplied-key Google replay (2026-10-05)

Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_f9d283db
Branch: bruv/run-gemini-buffered-speech-proof-f9d283db

Correction: the earlier canonical-only lookup did not establish that the supplied
Google key was absent. The parent found the EXISTING GEMINI_API_KEY assignment in
/home/tnfssc/.bruv/live.env; canonical auth.json only has openai-codex OAuth.
The previous worker missed the legacy supplied source. Canonical status/loadKey
intentionally do not consult live.env, so those missing states were true only for
the selected canonical lookup, not all user-supplied credentials.

The test-only probe now accepts --gemini-live-env: Google only, read directly with
src/live/credentials.ts loadLiveKey() and its existing private-file checks. No
importLiveEnv call, key copy, credential-file output, or canonical login mutation.
Default canonical Google/OpenAI selection is unchanged. OpenAI is skipped in this
explicit run; its API key remains unavailable. No production files changed.
Only four synthetic expected words can appear in diagnostics, not transcripts or
credential material. Failure output now includes retention/turn/timing fields too;
null setup/replay timing means provider setup/replay did not complete.

Testing first: the two new selection tests initially failed because the export did
not exist; after the script edit, focused tests passed: **18 pass, 0 fail, 73
assertions, 3 files** (final rerun 360 ms). Files: live-startup-speech-probe.test.ts,
live-credentials.test.ts, live-startup-audio-queue.test.ts.

- bun node_modules/typescript/bin/tsc --noEmit: passed.
- Selected-file Biome check: passed after sorting imports; git diff --check passed.
- Fixture-only: 152146 PCM bytes, 4754.5625 ms, trailingSilenceMs=1200,
  silenceTail=true (synthetic espeak-ng speech/ffmpeg PCM, memory only).
- Without BRUV_RUN_LIVE_STARTUP_SPEECH, --gemini-live-env exits 1 before key
  lookup/session launch (generic suppressed-detail error); opt-in remains required.
- Shell emits the existing untrusted mise.toml warning; Bun runs successfully.
  No trust/config change.

Paid command (one invocation, no retries; two Google attempts, 35-second per-trial
bound, outer shell timeout 80 seconds):

```sh
BRUV_RUN_LIVE_STARTUP_SPEECH=1 bun scripts/probe-live-startup-audio.ts --gemini-live-env
```

Credential diagnostic:

```json
{"provider":"google","credentialSource":"live.env","credentialState":"supplied_api_key"}
```

Burst result (exact probe JSON):

```json
{"provider":"google","mode":"burst","ok":false,"bufferedDuringConnect":true,"inputTranscript":false,"inputFinished":false,"retainedWords":false,"matchedWords":[],"turnEndBeforeStreamEnd":false,"outputTranscript":false,"outputAudioBytes":0,"pcmMs":4754.5625,"trailingSilenceMs":1200,"sentBytes":152146,"setupMs":800,"replayMs":4,"elapsedMs":34010,"errors":[]}
```

Paced result (exact probe JSON, 20 ms chunk spacing):

```json
{"provider":"google","mode":"paced","ok":false,"bufferedDuringConnect":true,"inputTranscript":false,"inputFinished":false,"retainedWords":false,"matchedWords":[],"turnEndBeforeStreamEnd":false,"outputTranscript":false,"outputAudioBytes":0,"pcmMs":4754.5625,"trailingSilenceMs":1200,"sentBytes":152146,"setupMs":673,"replayMs":4911,"elapsedMs":34020,"errors":[]}
```

Command completed **exit 1**, not outer-timeout; exactly two session attempts and
no retries. Each trial closed after its approximately 34-second observation
window, inside the 35-second cap. No OpenAI session launched.

Both modes reached ready and replayed every local PCM byte; neither produced any
input transcript, recognized expected word, output transcript/audio, or remote
turn-end before cleanup stream-end. Burst setup/replay: 800/4 ms; paced:
673/4911 ms. Both provider-error arrays were empty. This is a failed speech/VAD
acceptance result despite successful credential loading/setup/client sending;
it is NOT proof that no words reached the provider, and it does not establish a
cause for the missing response. Matched words are empty because no input
transcript was observed, not because a different transcript was inspected.
No further investigation, retries, model changes, forced commit/stream-end before
measurement, or production buffering change was made. The supplied-key lookup
mistake is corrected; remote buffered-speech retention/VAD remains unproven.

Parent brought back worker commit 57749fe228aa160f1ed459c497c9e55aba1eebe5.
Follow-up job was task_f9d283db. No extra paid retries.
Values unchanged: the lookup correction and failed acceptance fit existing go-look
and truthful-proof values. Production startup remains untouched.

## Investigate and fix

User asked about investigating and fixing the failure. Parent took the work;
user does not need to debug it. Job task_1fdf16c3 compares normal post-ready
paced streaming with buffered replay before changing the production path.
Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_1fdf16c3
Branch: bruv/fix-buffered-live-speech-acceptance-1fdf16c3
Base: da984b505d6406cf9cf7199754b9fd9de31fd5e8
Bound: six additional Google sessions, <=35 seconds each. Existing key via
loadLiveKey only. No credential writes, mic/speaker use, or broad retries.
Check the probe, actual model, VAD and sendAudio; fix only an observed cause.
Startup buffering stays out of production until evidence supports it.
Await result, check code/evidence and bring useful changes back.
Follow-up: [Gemini control and framed retention investigation](gemini-buffered-speech-investigation.md).
Normal automatic-VAD control also failed; manual-framed control/paced/burst recognized
the fixture. This isolates retention from detector acceptance, not a production VAD fix.

## Natural speech check and remaining matcher gap

Natural-speech test commit 3532a250 brought back as bef1fa78.
Integrated focused suite: 42 passed, 0 failed. Natural control, paced and burst
all produced automatic turns and replies. Exact word matcher reported 3/4 in
all modes. No evidence yet whether it is numeric rendering or missing speech.
Final diagnostic job: task_318aef23.
Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_318aef23
Branch: bruv/resolve-live-replay-word-check-318aef23
At most four additional sessions: generation plus control/paced/burst.
Check fixed token flags and seven/7 without logging transcripts. Do not loosen
arbitrary matching or change production. Await result and bring useful fix back.
