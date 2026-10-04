# End-to-end long-thread PTY latency harness

## Installed 0.15.30 baseline / candidate comparison

Run from the repository root with the project's pinned Bun and dependencies installed (frozen lockfile):

`BRUV_BIN=/home/tnfssc/.local/bin/bruv /absolute/path/to/bun test tests/long-thread-pty-latency.test.ts`

Repeat with `BRUV_BIN=/path/to/candidate/bruv` for the candidate binary. The harness launches each CLI binary in its own isolated temporary HOME and session store, drives an actual tmux terminal, and talks to a controlled local OpenAI-compatible SSE endpoint. The endpoint holds the reply open for 12 seconds. During the hold it polls captured terminal frames every 25 ms; it reports observed full-frame changes and inter-observation gaps, plus 5 measured typing echoes per short/long history. Warmup is 800 ms. Echo latency is bounded by asynchronous capture polling and is an upper-bound observation, not a key event timestamp. Spinner cadence is full captured-frame cadence, not inferred from render calls. Compare the reported poll interval and don't interpret a gap below its granularity.

The long fixture is 100 turns, each with repeated markdown/prose, five execute call/result pairs, and multi-line source-like tool output; the short fixture is two turns with one pair each. This intentionally stresses the same mix as an actual coding session instead of one-line synthetic messages. Test output prints sizes' response measures for each case. Failures to connect to the local OpenAI-compatible endpoint indicate a provider configuration incompatibility; no external network or real credentials are needed.

Private source-shape cross-check (stats only, no text copied): current parent session measured 517 JSONL records, 989,789 bytes, 225,126 content text chars, 99 tool calls; roles included 105 assistant, 99 toolResult, 285 custom, and 22 custom_message. Fixture scale targets the same multi-hundred-turn/tool rich density but is not a private-session clone. The test generates fresh data and never opens or changes the real session.

Limitations: tmux's capture-pane polling adds its own overhead and can miss transitions faster than the sampling interval; terminal capture content is used as the evidence. Results depend on machine load, terminal size, and build. Run baseline and candidate under comparable conditions, retain full JSON output, and do not treat one run as a stable benchmark.
