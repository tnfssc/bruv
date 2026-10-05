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
