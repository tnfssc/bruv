# Terminal performance investigation — 2026-10-11

The user reported that a submitted message takes time to appear above the input, confirmed this
means the bruv/Pi terminal, and asked for a broad investigation before fixes. Reviewed the current
extension, installed Pi code, and the separate website at commit `2031154b`. Pi is 1.1.0; Bun is
1.4.2. No application or Pi files were changed. Scratch probes are under `.tmp/`.

## First priority: input waits for a full Git snapshot

`src/check.ts:117-150` returns the snapshot promise from its input handler. Pi awaits input handlers
in `dist/core/extensions/runner.js:1202-1221`; `dist/core/agent-session.js:1538` does this before
creating the user message. The terminal adds that message to chat on `message_start` in
`dist/modes/interactive/interactive-mode.js:2830`.

The snapshot in `src/check.ts:33-54` runs five sequential Git commands: find root, find HEAD,
read HEAD into a fresh temporary index, `git add -A`, and write the tree. This scans and stages
the current working tree into the temporary index on every ordinary input, including untracked
files outside `.tmp/`. It preserves the real staging area, but recreating the index loses the
working-file stat cache. Checking defaults to on, and the snapshot also runs when keep-going is
off or the selected model will not use finish. There is no input-time cancellation signal here.

Measured with the actual checker registered in a Pi SDK session and a local faux provider. Times
are from calling `session.prompt` until the user `message_start` event, before actual terminal
painting. Five prompts per configuration; values below are medians, with observed ranges in
parentheses. Synthetic fixture setup is excluded.

| Working tree | Check on | Check off |
| --- | --- | --- |
| This checkout, 138 tracked files | 47.45 ms (42.08–97.53) | 1.98 ms (1.21–10.19) |
| Synthetic 5,000 clean files | 171.57 ms (162.94–243.81) | 1.08 ms (0.98–1.74) |
| Same tree plus a 16 MiB untracked binary | 194.82 ms (173.18–619.53) | 0.86 ms (0.75–1.09) |

The first snapshot of the untracked binary was the 619.53 ms sample. These are local reproduction
measurements, not a trace of the user's affected session. They demonstrate a direct explanation
for the symptom without requiring a model request. Turning checking off was a diagnostic control;
the user's settings were not changed.

Direction: make message acknowledgement visible before repository preparation, avoid snapshots
when no checker can run, and reuse Git work safely. Simply starting the snapshot without awaiting
it is unsafe: the model could edit files before the baseline is captured. Keep that ordering while
separating it from visible acknowledgement. An extension solution must respect the rule against
changing Pi files or non-rendering runtime behavior.

## Second priority: collapsed tool history gets expensive

`src/activity.ts:161-164` calculates a header for every top-level tool component, including those
that draw no header. `header` at lines 102-109 scans its group's calls and failures and copies the
entire session's group map each time. This produces quadratic work across a full transcript render,
even with short tool groups and collapsed results. Ordinary Pi spacing reproduces the issue;
`compactRender` is not the underlying cause. Pi lays out the full transcript before clipping it.

Actual Pi tool components, width 120, groups of ten top-level calls, warmed median timings:

| Top-level calls | Current render | Same components with header strings precomputed |
| --- | --- | --- |
| 100 | 0.674 ms | 0.400 ms |
| 500 | 5.421 ms | 2.114 ms |
| 1,000 | 17.495 ms | 5.072 ms |
| 3,000 | 104.778 ms | 14.935 ms |

Current 3,000-call timing uses ten samples; the other timings use 25. These exclude terminal I/O.
The comparison is a diagnostic control, not an implemented fix. The numbers count top-level
components, not the nested-call total printed in a tool header. Other runs were slower under CPU
contention, but the repeated-work mechanism and the controlled improvement were consistent.
`src/board.ts:28` requests redraws every 100 ms while jobs run, repeating the historical work.

Direction: only compute headers for group heads, remember the latest group directly, and update
counts and cached header strings when their inputs change.

## Shown thinking: compact paragraphs increase Markdown cost

`src/compact.ts:45-89` removes blank lines between prose paragraphs. When reasoning is shown, this
turns many short Markdown paragraphs into one large paragraph. The wrapper at line 237 applies
the transformation on each assistant update; Pi recreates the Markdown component for updates.

Actual Pi assistant update plus render, synthetic paragraph text, width 120:

- About 50 KB: ordinary Pi 9–13 ms; compacted thinking 80–87 ms.
- About 101 KB: ordinary Pi 23.5 ms; compacted thinking 155.3 ms.
- The transformation itself costs only 0.14–0.29 ms. Stable cached renders are about 0.01 ms.

Alternating measurement order and changing paragraph lengths reproduced the result. This affects
long thinking while shown and streaming; hidden thinking skips it. Keep Markdown paragraph
structure while changing visual spacing instead of merging the text into a large paragraph.

## Background output: memory growth and event-loop stalls

`src/jobs.ts:104-106` ignores the return value of the log stream's `write`, while stdout and stderr
listeners at lines 165-174 continue reading. If the disk cannot keep up, queued output can grow
well beyond the 64 KiB preview tail. A 32 MiB child-output probe with a controlled slow writable
queued 31 MiB, despite a 64 KiB stream high-water mark. This is a stress scenario, not evidence
that the user's normal log disk is slow.

The same method copies the retained tail on each chunk. Processing 16 MiB of output in synthetic
1 KiB chunks took 273 ms for tail maintenance; 128-byte chunks took 4.34 s. Normal larger chunks
were far cheaper. Pause child output while the writable is full and keep the preview without
repeatedly copying the accumulated tail.

`src/agents.ts:90-96` concatenates and rescans an unfinished JSON line on each incoming chunk,
then parses every event. Pi trims streaming update events, but its final `agent_end.messages`
still includes the child's run history, which bruv parses and ignores. Large tool results and
images can make this line large. Actual spawned-child probes emitting synthetic final events:

- 4 MiB event: largest 1 ms timer gap was 41 ms.
- 16 MiB event: largest timer gap was 140 ms; total elapsed time including child startup and
  logging was 304 ms.

Fixed 16 KiB input chunks made the scaling especially clear: parser time was 72 ms at 4 MiB,
314 ms at 8 MiB, and 1,348 ms at 16 MiB. Those are aggregate parser times, not single uninterrupted
UI pauses. Frame incoming lines without rescanning or copying all earlier chunks, and avoid
decoding unused large event bodies where possible.

## Steering and completing work

`src/jobs.ts:238-248` discovers pending user input with a 250 ms poll. A message just after a poll
took 249.7 ms to release `wait`. This delays the agent responding to steering; it is not itself
the reason the transcript initially omits the message. Abort already has an immediate listener.
An extension input notification could wake waits without this polling delay.

The fresh checker repeats the full snapshot at `src/check.ts:193`, runs several diffs at lines
202-213, then waits for a separate model run at lines 221-238. This is intentional validation
latency after work, distinct from initial display lag. It uses the parent's model and thinking
level and can request two review rounds. The patch is capped at 40,000 characters only after Git
has produced and buffered the full patch; the subprocess buffer limit is 16 MiB. Reducing work
before that cap could help large changes. No paid model timing was measured.

Pi can also auto-compact before emitting a new user message (`agent-session.js:1586`). Bruv's
Codex compaction handler at `src/codex-compaction.ts:254-264` waits for a network request and stream
completion, with no extension-specific deadline beyond the abort signal. This is a conditional
additional delay near context limits, confirmed by code inspection, not measured with a live
provider. Avoid attributing every delayed prompt to network latency.

## Smaller recurring costs

- Activity clears and rebuilds history indexes on every streamed message update
  (`src/activity.ts:55-80,130`), including text/thinking-only updates and RPC mode. About
  0.15–0.18 ms/update at 1,000 historical calls; 0.34–0.43 ms at 3,000.
- The footer calls Pi's context calculation every frame (`src/footer.ts:60`), walking the session.
  About 0.21 ms at 1,000 simple entries and 1.31 ms at 5,000. Its incremental cost tracker also
  obtains a copied entries array at line 25. Refresh these values when their inputs change.
- Hidden tool results still construct their inner renderer (`src/activity.ts:174`). Output is
  parsed and wrapped before the twelve-line cap (`src/render.ts:183-194`). About 1.26 ms parsing
  51 KB and 8.26 ms parsing 512 KB; the latter exceeds Pi's default output limit and is a stress
  case. Width-dependent wrapping also lacks caching.
- Usage events synchronously rewrite a small JSON file (`src/usage.ts:105-106`), and Codex request
  capture clones the full payload (`src/codex-compaction.ts:234`). These are observable costs but
  have not been demonstrated to be significant here; do not rank them with the measured stalls.
- Job records persist for a session and board work grows with their number. Ordinary small boards
  were inexpensive. Worktree completion also snapshots files to count changes; this was not
  measured as a primary issue.

## Startup and the separate website

No comparable routine input blocker was found in prompt/config/import/review/question handling,
editor chrome, home display, notifications, or finish-result drawing. Prompt files load once.
Home animation is disposed after the first message; board and footer timers have cleanup.

Notes indexing reads whole note bodies synchronously for titles, once per session. This checkout
took 0.039 ms; a synthetic sixty 1 MiB notes took 29.8 ms. Migration reads whole JSONL sessions
for their first line; a synthetic 64 MiB file took 30.2 ms, only during `/bruv-migrate`.

The website is independent of terminal chat. It has separate performance issues:

- `site/terminal.ts:23-24` serializes font and WASM loading while page content is hidden. A local
  uncompressed test at 200 KiB/s and 150 ms latency took 6.23 s to display it. This is deliberately
  throttled laboratory timing, not deployed-site latency. JS was 658 KB raw / 196 KB local gzip;
  WASM was 423 KB raw / 126 KB local gzip.
- `site/terminal.ts:109` forces a full canvas redraw on changed frames. Visible animation used
  about 1.05 CPU-seconds over five seconds in headless Chromium. A separate diagnostic build
  measured 207 ms idle versus 1,176 ms animating over five seconds, with no tasks over 50 ms.
- `site/layout.ts:144-159` rebuilds all three demos, including those offscreen, each animation
  tick. Whole layout cost was about 0.85–2 ms, secondary to canvas drawing.

## Verification and where work stopped

Ninety-two relevant existing tests passed, zero failures: 52 covering checks, finish, activity,
compact rendering, output rendering and compaction; 40 covering jobs, agents, worktrees, UI,
process inspection, notifications and settlement. No new performance assertions or wording
tests were added. No application fixes, user setting changes, commits, or PRs were made.

Reproduction commands and captured results, all ignored scratch files:

- `bun .tmp/send-perf.ts` → `.tmp/send-perf-results.jsonl`.
- `bun .tmp/render-perf-control.ts` → `.tmp/render-perf-control.jsonl`.
- `bun .tmp/render-perf-thinking.ts` → `.tmp/render-perf-thinking.jsonl`.
- `bun .tmp/render-perf-bench.ts` covers indexing, footer, output, and longer tool groups.
- `.tmp/jobs-perf-audit/{probe,pipe-probe,wait-probe}.ts`; results in `results.json` there.
- `.tmp/site-perf-{audit,browser,profile,size}.ts`; `.tmp/site-perf-results.json` records details.
- `.tmp/performance-tests.log` contains the 52-test run; the job audit results record its 40 tests.

Recommended order: visible acknowledgement and Git snapshot cost; activity-header work;
background stream handling; shown-thinking rendering; immediate steering wakeups. Keep the
website improvements separate. A live trace of the user's affected session would determine the
relative contribution of these problems to that particular pause.

## Fix 1 done: the message no longer waits for the snapshot

`src/check.ts` still starts the snapshot at the input event but no longer returns it, so Pi shows
the message at once. A `tool_call` handler waits for the snapshot instead, so it is still taken
before any tool can change files. A message steered in while a tool is already running had the same
race before this change. Tests now make their file edits at the next tool call (the faux model used
to edit files directly, which a real model cannot). A new test holds Git inside the snapshot with a
`core.fsmonitor` hook until the user message starts; it times out on the old code, and removing the
tool wait breaks 11 check tests. Next: activity-header work (second priority above).
