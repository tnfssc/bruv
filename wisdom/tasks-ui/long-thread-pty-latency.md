# End-to-end long-thread PTY latency

## Run the actual interaction

Use the pinned Bun in an installed checkout. The default binary is this checkout’s dist/bruv; set BRUV_BIN to test an installed release. Both runs use a private HOME, synthetic saved sessions, tmux at 100 by 32, and a fixture provider bound only to loopback. The harness proves that both requests reach that provider. No real credentials or message contents are needed.

The provider holds each response until measurement ends, not for a fixed time. That keeps a slow run in the same loading state. The test measures idle and held-response input echo separately, then observes only braille-spinner glyph changes for a full five seconds. Each input token must appear, and Ctrl+U must clear it before the next sample. Default sample count is 12; change BRUV_LATENCY_SAMPLES for a longer run. The two-turn and 100-turn fixtures include assistant markdown, nonzero usage, and execute outputs. BRUV_LATENCY_LONG_TURNS changes the long fixture size.

Input capture retries sleep 20 ms; spinner capture retries sleep 50 ms. Each also includes tmux process overhead. The measured times are upper-bound observations, not instrumented key timestamps or exact render FPS. Run baseline and candidate in sequence, without a build or another benchmark running. Do not compare only eventual test success.

Diagnostic run:

```sh
BRUV_BIN=/path/to/installed/bruv BRUV_LATENCY_OUTPUT=/tmp/baseline.json bun test tests/long-thread-pty-latency.test.ts
```

Acceptance run on this machine (explicit budgets, rather than load-sensitive default CI assertions):

```sh
BRUV_BIN="$PWD/dist/bruv" BRUV_LATENCY_MAX_ECHO_P95_MS=100 BRUV_LATENCY_MAX_SPINNER_GAP_P95_MS=140 BRUV_LATENCY_MIN_SPINNER_TRANSITIONS=45 BRUV_LATENCY_OUTPUT=/tmp/candidate.json bun test tests/long-thread-pty-latency.test.ts
```

Each run saves measurements and actual held-input/spinner terminal frames under artifacts/latency/. Those survive cleanup of the temporary session and provider. Inspect the frames. A diagnostic run without budgets records numbers but does not certify responsiveness. The count-based context-cache test supplies the stable CI regression check.

## Handoff

Integration worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_43fd9f57, branch fix/long-thread-full-frame-latency. See [the follow-up](full-frame-latency-followup.md) for the missed footer path and final results. Earlier draft evidence used a timer-held response, fewer samples and weaker assertions; it is superseded, not acceptance for this fix.
