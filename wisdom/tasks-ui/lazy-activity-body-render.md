# First terminal frame optimization: don't render hidden activity bodies

2026-10-05 · baseline fc8bec58033ffd7c0435338127ee46f79609b343 · worker task_81a5a66d

## Decision and shipped path

Keep this first patch small: make the native/task-body callback in `src/ui/sdk-task-rows.ts` lazy. Ownership already exists before the child wrapper runs, so it supplies hasOwnedTasks without rendering the body. Rolling activity may then hide the body completely. Headers, human handoff controls and save warnings still render; live snapshot merging and ownership remain unchanged.

The old wrapper eagerly rendered the native/task body before projectActivity decided to hide it. The long-thread audit had identified this ordering too. The supplied CPU profile's workload render wrapper included that work; it was not evidence that the settled-shell cache alone was broken. Looking at the actual SDK adapter found the direct unnecessary work.

No new cache, dependency patch, node_modules edit, frame state or invalidation protocol. Expansion still runs the SDK lifecycle on demand with the current args/result, native detail state and width. The existing settled execute cache stays responsible for its own lifecycle. No scripts/terminal-perf files or tests changed.

## Reproduce and inspect

Working directory (local evidence, not tracked):
/home/tnfssc/.bruv/worktrees/t3code-bbf9268f-5442693331ce-task_81a5a66d

```sh
bun run perf:terminal --samples 40 --out artifacts/terminal-perf/worker-before
# apply the production change
bun run perf:terminal --samples 40 --out artifacts/terminal-perf/worker-after \
  --baseline artifacts/terminal-perf/worker-before/run.json
bun --cpu-prof --cpu-prof-md --cpu-prof-dir artifacts/terminal-perf/worker-after-profile \
  scripts/terminal-perf.ts --case input --scales 1000 --samples 100 \
  --out artifacts/terminal-perf/worker-after-profile
```

Both clean timing runs: Bun 1.4.2, Pi 1.0.3, Ryzen 9 7940HS Linux x64; samples=40, warmup=5, width=120, height=40, scales=100/500/1000, fixtureVersion=1. Before was clean at fc8bec58; after was that revision plus the dirty production diff. The profile is separate evidence, not a timing gate. No build/test job overlapped the matched full before/after runs. Shared-host noise remains. My baseline input/1000 was slower than the parent's 30–40ms baseline; use this same-options pair, not the parent-vs-worker difference, as the improvement.

Raw run.json, report.txt, index.html and trace.json are in each before/after directory above. Profile: artifacts/terminal-perf/worker-after-profile/CPU.20261005.233247.651548.0.001.cpuprofile and CPU.20261005.233247.651548.0.002.md. Parent supplied baseline/profile at /home/tnfssc/.t3/worktrees/bruv/t3code-bbf9268f/artifacts/terminal-perf/{fc8bec58-baseline/run.json,input-profile/terminal-input-1000.cpuprofile.md} were also read.

## Matched results (ms, before → after)

| Case/scale | p50 | p95 | max | cold max |
| --- | --- | --- | --- | --- |
| input/100 | 4.844 → 1.645 | 12.577 → 3.261 | 25.749 → 5.018 | 30.937 → 20.580 |
| animation/100 | 3.016 → 1.385 | 4.589 → 2.276 | 5.132 → 2.932 | 7.669 → 4.680 |
| streaming/100 | 3.379 → 1.537 | 8.534 → 2.720 | 16.693 → 4.323 | 6.736 → 5.286 |
| resize/100 | 4.335 → 1.973 | 6.122 → 3.848 | 6.692 → 5.916 | 10.209 → 3.808 |
| scrollback/100 | 3.427 → 1.293 | 5.318 → 2.763 | 6.270 → 4.084 | 5.162 → 2.983 |
| task-update/100 | 3.153 → 1.407 | 5.304 → 3.002 | 6.336 → 5.693 | 7.523 → 3.192 |
| input/500 | 18.998 → 8.705 | 24.050 → 11.219 | 26.459 → 13.206 | 34.515 → 18.666 |
| animation/500 | 17.559 → 9.452 | 23.101 → 11.985 | 24.962 → 12.882 | 28.827 → 17.426 |
| streaming/500 | 18.333 → 8.656 | 22.446 → 11.458 | 23.074 → 13.264 | 27.590 → 19.250 |
| resize/500 | 22.518 → 11.440 | 26.476 → 15.319 | 29.574 → 15.705 | 33.259 → 17.422 |
| scrollback/500 | 15.959 → 7.513 | 21.102 → 10.131 | 22.109 → 11.050 | 24.721 → 16.029 |
| task-update/500 | 17.361 → 8.178 | 22.769 → 11.372 | 24.998 → 14.885 | 23.339 → 13.102 |
| input/1000 | 42.056 → 21.712 | 48.929 → 24.762 | 50.707 → 25.338 | 56.498 → 39.626 |
| animation/1000 | 40.003 → 19.032 | 46.523 → 23.139 | 51.263 → 24.411 | 58.959 → 32.795 |
| streaming/1000 | 36.726 → 20.897 | 43.611 → 27.069 | 48.554 → 28.530 | 57.691 → 27.700 |
| resize/1000 | 42.685 → 24.823 | 52.245 → 27.737 | 53.491 → 28.995 | 45.409 → 29.790 |
| scrollback/1000 | 34.916 → 17.718 | 39.664 → 21.802 | 42.372 → 25.440 | 50.549 → 34.663 |
| task-update/1000 | 39.290 → 17.821 | 44.160 → 21.797 | 45.568 → 24.588 | 45.835 → 30.098 |

Input/1000 p50 fell 48.4%; p95 fell 49.4%. Named history.document.render median fell 41.880 → 21.585ms. All 720 steady samples changed the screen; every corresponding screenHash and outputHash matched before/after, including resize, scrollback and task updates.

The coarse traversal counters are deliberately **unchanged** on input/1000: 2 document renders, 3504 component wrapper invocations, 4504 branch entries and 2000 snapshot rows/frame. Those counters count visits, not the skipped native render/formatting inside each wrapper. New deterministic tests assert 0 native bodies for 1000 hidden executes, 1000 on reveal, no additional work on recollapse, and native restoration on disposal. Another test asserts 0 task formatting while hidden, current live failed status in the header, and 1 task formatting on reveal.

## Behavior proof

- bun run check — passed.
- bun run build — passed; no dependency/preparation changes.
- bun test tests/rolling-activity.test.ts tests/task-rows.test.ts tests/settled-execute-render.test.ts tests/rolling-activity-disk.test.ts tests/execution-previews.test.ts — 109 passed, 0 failed.
- Regression check: with the committed eager adapter temporarily restored, `bun test tests/rolling-activity.test.ts -t collapsed` failed exactly the two new work assertions (3000 native body renders rather than 0 across three hidden paints; 1 task formatting rather than 0). The production fix was restored afterward.
- New hidden-body lifecycle test changes args/result/error, invalidates, changes detail state and width while hidden; reveal shows the replacement label/output rather than stale output. Existing focused tests cover theme/image invalidation, task status, branch navigation/reopen, partial results, group/detail clicks, handoff, and disposal.
- Compiled acceptance: bun test tests/long-thread-tui.test.ts — 1 passed, 1049 assertions. Real tmux compiled dist/bruv, 1000 saved executes; history top/bottom, typed input, Ctrl+O, reading anchor, narrow resize, reopen, oldest/latest details and regular mode preserved. Frames inspected in artifacts/tui/bruv-long-thread-649693-1791228691693: loaded, typed, oldest, narrow, reopened-latest-detail, regular-expanded. Visible detail output and draft survive; collapsed groups show tool counts rather than hidden bodies.
- Compiled acceptance: bun test tests/execution-previews-tui.test.ts — 1 passed, 58 assertions, covering collapsed execute/task rows, failures, small width and native expansion.

## Remaining misses and next measured step

This is **not** an under-8ms solution. After run: all 1000-scale cold/steady frames miss; 500-scale cases still have steady misses (15–40 of 40). Even input/100 has a 20.580ms cold miss. Terminal paint/backpressure, real scheduler responsiveness and unsampled frames were not proven by CPU runs. Compiled acceptance proves preservation, not an all-frame latency bound.

The after sampling profile still shows taskTitle, upsertTaskRow, taskRowsFromDetails, activityMembership and SDK ownership render traversal. Document work remains nearly the whole frame. Next investigate why this fixture renders the document twice and reuse ownership/membership within the synchronous frame, or cache unchanged settled ownership facts with explicit task/result/branch invalidation. Pi layout already has a per-layout component/width cache; do not add another cache blindly or assume refreshSearch caused the duplicate. First identify the exact second invocation and compare width/lifecycle boundaries. A dependency change must be a pinned reproducible patch. An unchanged-row cache needs direct invalidation tests for task status, source ownership, branch switches and rebuilds; keep this small lazy callback patch independent.

Feature-specific evidence belongs here. Values unchanged: existing measured-proof, simplest-working-change and pickup principles already cover this lesson.

## Frame-local ScrollView follow-up

[Share ScrollView content renders](scroll-content-frame-cache.md) patches the pinned SDK measurement path to use the existing layout cache. Matched input/1000 p50: 18.008 → 9.270ms; all 738 cold/steady fingerprint pairs unchanged. Document renders 2 → 1. Still not under 8ms; remaining misses, reproducible install, deterministic tests and compiled acceptance are in that note. No harness changes.
