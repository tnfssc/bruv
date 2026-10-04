# Long-thread PTY latency evidence

Run: Bun 1.4.2, `bun test ./tests/long-thread-pty-latency.test.ts`, installed CLI `/home/tnfssc/.local/bin/bruv` (0.15.30). The harness uses a temporary HOME and isolated `models.json` fixture provider bound to loopback; it observed both requests at `/v1/chat/completions`. The response was held for 12 s. No real OpenAI endpoint is configured.

Observed run (100 long-history turns; PTY capture polling interval 50 ms):

| history | idle echo p50 / p95 | held echo p50 / p95 | spinner-only transitions | spinner cadence p50 / p95 |
|---|---:|---:|---:|---:|
| short (2 turns) | 26.9 / 44.3 ms | 18.5 / 20.2 ms | 56 | 61.4 / 117.6 ms |
| long (100 turns) | 227.4 / 326.2 ms | 196.7 / 229.9 ms | 32 | 110.5 / 113.7 ms |

Echo latency is measured from tmux send through capturePane observing the full unique token; each token is asserted and erased character-by-character. Spinner cadence is based only on changes to the braille spinner glyph row while the provider is held, not unrelated terminal repaint. Polling interval (50 ms) is reported; values reflect capture polling overhead and are end-to-end observations, not instrumented keystroke timestamps.

Re-run with a candidate binary and configurable history: `BRUV_BIN=/path/to/bruv BRUV_LATENCY_LONG_TURNS=1000 bun test ./tests/long-thread-pty-latency.test.ts`.
