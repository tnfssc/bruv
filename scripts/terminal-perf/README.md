# Terminal frame lab

Measure actual terminal render work. No provider key, build or tmux needed.

## First run

```sh
bun install --frozen-lockfile
bun run prepare:assets
bun run perf:terminal --list
bun run perf:terminal --samples 40 --out artifacts/terminal-perf/before
```

Open `index.html` in that folder. Click a workload. Switch between cold and steady frames. Hover the bars. See the slowest frames, changed rows, document renders, task scans and output bytes. The dashed line is the 8 ms budget. Red bars miss it.

Files:

- `run.json`: cold and steady frame timings, work counts, screen/output hashes, settings, dependency versions, CPU, Bun version and Git revision.
- `report.txt`: compact agent-readable table. p50, p95, p99, max and misses. Cold frames do not disappear into warmup. Cold means the new fixture’s first render in this process, not a fresh process for every case.
- `index.html`: one offline dashboard. No server or CDN.
- `trace.json`: open in Perfetto or Chrome's trace viewer. Actual frame spans. Phase totals are args, not fabricated ordered spans.

Without `--out` each run gets a fresh folder under `artifacts/terminal-perf/`. Artifacts are ignored by Git. Use a new folder for each measured revision. A dirty checkout is labeled as dirty; commit or save its diff beside results if others need to reproduce it.

## Measurement-only extraction

This branch adds a harness, not performance fixes or production instrumentation. Runtime source, installed SDK patches, dependency configuration and lockfile remain those of `origin/develop` at `2683847dec4344a458ae8d39146cd6b48f55959d`. Extracted from combined commit `134f7bcd8ceefc9c4037779f37e9eee438e7b1d9`; old combined results are deliberately not included. See [pickup/provenance](../../wisdom/tasks-ui/terminal-harness-pickup.md). Expect real budget misses on unchanged runtime.

## Agent loop

1. Read the [frame methodology](../../wisdom/tasks-ui/terminal-frame-lab.md) and [interaction boundaries](../../wisdom/tasks-ui/terminal-interaction-lab.md).
2. Run a baseline before editing. Keep the machine, Bun version, viewport, scales and sample count fixed.
3. Pick the slowest useful workload. Read its work counts and phase totals. The named `history.document.render` span isolates transcript rendering. Remaining imported fullscreen layout and inline diff live in `inlineLayoutDiffAndOther`. Do not call that number pure diff time.
4. Make one focused fix. Do not make the workload cheaper to make the fix look fast.
5. Run again with the same options and `--baseline`. Read warnings before trusting a comparison. Cold deltas are suppressed when preceding workloads or run settings change the process-warming context.
6. Run behavior tests for the code you changed. Add a deterministic work-count test if the fix removes repeated scans. Normal tests should not assert machine-speed thresholds.
7. Save the commands, before/after results and remaining misses in feature wisdom. A fast average is not enough. Check cold frames and max.

```sh
bun run perf:terminal --samples 40 --out artifacts/terminal-perf/after \
  --baseline artifacts/terminal-perf/before/run.json
# Focused runs; repeated --case filters form a union.
bun run perf:terminal --case input --case animation --scales 100,1000 --samples 80
# Dedicated-machine budget gate. ANY sampled cold/steady frame >=8 ms fails.
bun run perf:terminal --strict --budget 8
# Rebuild reports without rerunning a workload.
bun run perf:terminal --report artifacts/terminal-perf/after/run.json \
  --baseline artifacts/terminal-perf/before/run.json --out artifacts/terminal-perf/comparison
```

Report mode keeps the saved budget unless you pass an explicit `--budget`; then it rechecks the saved timings against that target.

Exit codes: 0 for a completed informational run, 1 for an opt-in budget failure, 2 for a broken workload or invalid command. Timing gates are not in normal CI. Shared runners have noisy clocks. Keep real misses visible, but rerun isolated before judging an optimization.

For a call-stack profile, use Bun's profiler on a focused workload. A sampling profile adds overhead; do not mix it with a clean budget run.

```sh
bun --cpu-prof --cpu-prof-md --cpu-prof-dir artifacts/terminal-perf \
  scripts/terminal-perf/terminal-perf.ts --case input --scales 1000 --samples 100
```

## What we measure

The profiler wraps the concrete TUI instance's synchronous `doRender` entry through return or throw. This includes full layout, screen diff, escape construction and `Terminal.write` calls. It does not wrap an async function and mistake waiting for CPU work. Observable phase methods have exclusive times. Their sum plus the unattributed work explains the whole frame. Instrumentation overhead is included.

Request-to-frame-entry and input-dispatch-to-frame-entry delay are separate from render duration. The repeatable workload runner calls public `renderNow()` to drain a frame. Those delay samples do not prove scheduler responsiveness. The profiler tests also check real scheduled input on both screen modes. You can attach `attachTerminalProfiler(renderer)` to another test or interactive probe and inspect `snapshot()`. Pass `observe: [{ target: component, method: "render", name: "my.component" }]` to attribute a component without global patches. Always call `dispose()` to restore instance methods. The ring is bounded; `droppedFrames` makes overwritten samples visible.

Current workloads use full-screen Pi 1.1.0 with real SDK messages, ToolExecutionComponents, Bruv execute previews, typed local/native/SSH task rows, rolling activity and conversation density. They cover typing, animation, streaming results, resize, scrollback and task status updates at 100/500/1000 settled executes. Each measured action must change screen rows. A no-op cannot claim a win.

## Add a workload

Add a mode/fixture in `workloads.ts`. Keep it provider-free and deterministic. Use real components and the real TUI layout/diff/write path. Bound live text. Use setup/step/dispose. Install only one fixture at a time: Bruv's adapters patch SDK prototypes and must be restored. Use the renderer-ready hook so the cold render is measured too.

Add assertions in `tests/terminal-perf-workloads.test.ts` for visible changes, output, work counts and disposal. Bump the runner's fixture version when workload meaning changes. Never compare two different fixtures as proof of a code speedup.

## Known limits

A counting terminal is not a terminal emulator. It cannot measure paint, stdin decoding before the TUI dispatcher, pipe/PTY backpressure, GC pauses outside sampled renders or all other app main-thread work. Fixture setup is not a full session-open benchmark. History is in memory here; disk-backed SessionManager materialization needs its own workload. The profiler supports regular and full-screen renderers, but this first workload suite targets full-screen. This frame suite does not cover mouse, search, detail expansion or live waveform. The separate interaction runner covers those component paths with scheduled frames; it still does not reproduce real scheduled app load.

Use compiled-terminal acceptance for visible behavior after a render fix. These results are useful CPU evidence, not a promise that lag can never happen.


## Broad interaction runner

The frame-only command above is unchanged. Use the reusable interaction runner for send admission, tool mutations, navigation and initialized SDK lifecycle evidence:

~~~sh
bun run perf:interactions --list
bun run perf:interactions --out artifacts/terminal-interactions/before
bun run perf:interactions --groups send,navigation --repetitions 2 --out artifacts/terminal-interactions/send-nav
bun run perf:interactions --cases tools/single-line,navigation/tool-detail --repetitions 3 --strict --budget 8 --out artifacts/terminal-interactions/focused
bun run perf:interactions --report artifacts/terminal-interactions/after/run.json --baseline artifacts/terminal-interactions/before/run.json --out artifacts/terminal-interactions/comparison
~~~

Open **index.html** directly in a browser: it is self-contained and offline. Filter groups/cases, select a repetition, inspect the largest inclusive spans, normalized checks/boundaries and complete raw fixture/profiler evidence. Baseline deltas are current minus baseline (positive means slower); mismatch warnings include environment, fixture parameters/scope, source hashes, screen/content/output and sample count. Source changes are expected during optimization, not permission to ignore changed fixture meaning.

Options: --groups send,tools,navigation; --cases ID,... (exact runnable IDs from --list); --repetitions 1..100 (default **1**); --budget MS (default **8**, strict less-than); --width 24..240 / --height 8..100 (100x32); --baseline run.json; --out DIR; --report run.json; --strict. Report mode runs no fixtures and keeps the saved budget unless explicitly overridden; selectors/repetition/dimension options only apply to measurement.

Default coverage is broad but bounded: seven send cases (short/16 KiB/queued steer/queued follow-up/command/256 KiB paste/Bruv disk short), **all 13 tool component shapes, eight additional `tools/events/{normal,ascii,ansi,unicode,newline,structured,error,warning}` tool-event workloads, and all nine ordered stages**, all 14 navigation modes, and the initialized offline SDK lifecycle probe. Histories are four send/navigation turns or eight settled tool items. A tool runnable case always executes its full stage sequence, with each stage and setup reported separately. Every repetition is a fresh process; action follows setup in that process. These are not warmed-process throughput measurements. Navigation lifecycle uses its fixture's fixed **80x24** terminal regardless of CLI dimensions.

Run **one** measurement command at a time; do not overlap long/high-sample probes with workers. The runner serializes child processes, isolates permanent SDK/Bruv journal installers and global SDK theme/watch state, and disposes each fixture. Each child has a 120-second failure deadline. Raw files/logs and partial.json survive a broken case. Completed output is run.json, report.txt, index.html and raw/*.json. Raw evidence is embedded in run.json/dashboard too, so report-only rendering does not need the old raw directory. Artifacts are ignored by Git and remain in the worktree; retain the directory when handing timings off.

### What the interaction gate means

Exit **0**: informational completion (or strict observed scopes passed). Exit **1**: opt-in observed budget miss, including cold/init scopes. Exit **2**: invalid CLI/report or broken fixture/child. Unit tests use synthetic timings for gate boundaries; they never assert that a machine can meet 8 ms.

The maximum **observed** synchronous scope is gated, not a sum of nested inclusive spans and not awaited elapsed. Tool mutation batches are known non-overlapping work, but the fixture does not expose the full contiguous mutation-through-render boundary. Reports explicitly mark this **missing boundary** and do NOT add mutation+frame. A clean observed gate therefore **does not prove** the full slice or all-app responsiveness. Navigation measures a real synchronous callback and a separate scheduled frame; send includes real action-profiler input/frame/heartbeat evidence attached through its renderer-ready callback, alongside fixture method prefixes. Async continuations outside named spans remain unobserved. Provider timer waits, first admission/visible acknowledgment elapsed, request scheduling and heartbeat gaps are separate diagnostics, not CPU.

Screen/content/output SHA256s, output byte/write counts, changed rows/visible acknowledgments, work counters, raw traces, repository byte fingerprints and installed SDK JS fingerprints are retained. Unchanged/idempotent tool stages are visible as such; init screens unavailable from a fixture are explicitly not invented. Counting-terminal writes are attempted output, not physical paint. The send seam uses real SDK InteractiveMode init/editor/session/journals with a recording provider; queued sends stop at queue acknowledgment, not later queue consumption. Lifecycle runs initialized SDK selectors/tree/resume/fork with provider/fetch forbidden, **not actual extension-rich Bruv startup**. Regular-screen, PTY/emulator paint, real network/provider latency and comprehensive async continuation coverage are not provided. See [runner wisdom](../../wisdom/tasks-ui/terminal-interaction-runner.md).


Tool-event cases use a fresh isolated worker and the real SDK dispatch/render fixture. Their controlled direct `handleEvent` burst is a measured contiguous same-turn slice; subscribed Enter input and scheduled frames are separate observations. The overall action spans multiple turns and unobserved async continuations, so it is not a complete-action timing claim. Setup/init/grammar warmup are not sampled. Input lateness and heartbeat timing are diagnostics, not CPU, and raw event/file evidence is retained unchanged.

## T3 actions

Import the repository `t3.json` scripts in T3 Code to get **Terminal Frame Lab** and **Terminal Interaction Lab** actions. Both run on demand, in the background. They do not run during worktree setup. Commands print the saved dashboard path; open `index.html` for the report. These are informational runs, not strict budget gates.
