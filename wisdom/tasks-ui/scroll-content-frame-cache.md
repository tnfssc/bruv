# Share ScrollView content renders within a layout frame

Completed-run captures/logs mentioned below are now historical Git evidence;
[recovery and retained inputs](../quality/completed-run-retirement.md). Conclusions remain here.

Follow-up to [lazy activity bodies](lazy-activity-body-render.md), based on integrated f7a46bba and the reviewed [frame lab](terminal-frame-lab.md). Target remains **strictly under 8ms**; this patch does not reach it for long histories.

## Cause and smallest fix

Pi TUI 1.0.3 already has a component/width cache in renderLayoutFrame. Actual leaf layout uses it. VStack's intrinsic height measurement caches ScrollView.render(width), but that method calls child.render(contentWidth) directly. The later scroll child layout therefore renders the same document at the same width again. The parent trace identified these two paths; before-patch deterministic tests independently saw widths [6,6] and [8,8] rather than one invocation.

Pinned Bun patch: patches/@earendil-works%2Fpi-tui@1.0.3.patch. During cached scroll measurement, layout supplies a child-render callback that uses the **existing** frame-local cache. ScrollView.render accepts that optional callback; without it, direct/regular rendering is unchanged. Its declaration is patched too. No persisted cache, revision state, wrapper monkeypatch or harness changes.

Do not replace natural measurement with viewport height or zero. Measurement still calls the real ScrollView.render, uses getContentWidth, reserves the same scrollbar gutter and returns the full wrapped height. HStack measurement at content width 11 and actual layout at width 5 must each render once, not share across different widths. Each renderLayoutFrame creates a new cache, including a second layout explicitly requested by active search to reveal a match. Once per layout is not always once per doRender.

package.json and bun.lock register the pinned patch beside the existing coding-agent patch. Existing preparation and single-binary bundling need no changes: Bun applies this at install and the compiler bundles the patched SDK. Verified by removing node_modules/@earendil-works/pi-tui, bun install --frozen-lockfile, then rerunning regressions/build. Not a node_modules-only fix.

## Matched measurement

```sh
bun run perf:terminal --samples 40 --out artifacts/terminal-perf/scroll-cache-before
bun run perf:terminal --samples 40 --out artifacts/terminal-perf/scroll-cache-after --baseline artifacts/terminal-perf/scroll-cache-before/run.json
```

Both runs: Bun 1.4.2, Linux x64, AMD Ryzen 9 7940HS, Pi 1.0.3, 120×40, warmup 5, scales 100/500/1000, full 18-case suite, 40 steady samples/case. Before is clean f7a46bba; after is the dirty dependency patch plus its tests. No other jobs from this task ran during the timing samples. Every one of 720 steady actions changed rows. **All 738 corresponding cold/steady screenHash and outputHash pairs match**, with no intentional behavior changes or comparison warnings.

Historical [before report (historical)](../quality/completed-run-retirement.md#recovery), [after report (historical)](../quality/completed-run-retirement.md#recovery), and [metadata/fingerprint/work-count comparison (historical)](../quality/completed-run-retirement.md#recovery). Full JSON/dashboard/trace remain in the ignored artifact directories above.

| 1000-execute case | p50 before → after (ms) | p95 before → after (ms) | cold before → after (ms) |
| --- | --- | --- | --- |
| input | 18.008 → 9.270 | 22.145 → 14.158 | 33.295 → 20.748 |
| animation | 19.710 → 8.923 | 27.475 → 11.089 | 35.269 → 22.641 |
| streaming | 22.037 → 9.610 | 25.655 → 12.953 | 34.874 → 23.164 |
| resize | 25.294 → 14.396 | 29.194 → 17.870 | 29.370 → 21.396 |
| scrollback | 19.835 → 9.796 | 26.693 → 14.001 | 39.976 → 21.334 |
| task-update | 18.632 → 9.344 | 22.721 → 11.928 | 30.415 → 22.709 |

Input/1000 work/frame: document renders 2 → 1, component visits 3504 → 1752, branch entries 4504 → 2252, task snapshot rows 2000 → 1000. This removes the demonstrated duplicate; it does not avoid the remaining complete document traversal.

## Behavior proof

- tests/scroll-layout-render.test.ts: 3 tests / 35 assertions. Once per same-width layout, fresh rendering next frame even if unchanged, changed content, growth/follow-end, retained reading position, resize/wrapping, natural height, always-scrollbar gutter, separate widths in HStack and direct render. Checks shared content lines and hit-test boxes. Real fullscreen input checks copied selection after content changes and search highlighting/count after resize and replacement. No machine timing assertions.
- Before the patch, the first two new work assertions fail with duplicate widths [6,6] and [8,8].
- Focused suites: scroll-layout-render, fullscreen-editor, rolling-activity, task-rows, settled-execute-render, rolling-activity-disk, execution-previews: **115 passed / 973 assertions**.
- bun run check; bun run build; focused Biome format/lint; git diff --check: passed.
- Compiled terminal: bun test tests/long-thread-tui.test.ts tests/execution-previews-tui.test.ts: **2 passed / 1107 assertions**. Real tmux compiled dist/bruv, saved 1000 executes, input, oldest/latest, detail expansion, scroll anchor, narrow width, quit/reopen and regular mode. Inspected loaded, typed, oldest, narrow, reopened-latest-detail and regular-expanded captures under artifacts/tui/bruv-long-thread-672384-1791229393127. Drafts survive and native detail output remains visible; collapsed groups retain tool counts.

## Remaining misses and pickup

All six 1000-scale cold frames miss; steady misses (out of 40) are input 27, animation 35, streaming 37, resize 40, scrollback 37, task-update 35. At scale 500, all cold frames miss, and input/animation/resize/scrollback/task-update still have 1/1/7/1/2 steady misses; streaming has none. Scale 100 has no steady misses but first input cold remains 21.005ms. Keep these visible rather than claiming an under-budget solution.

The one remaining document traversal is still nearly the whole input/1000 frame. Next measure settled ownership/membership/task-row work within that traversal; do not add a cross-frame cache without demonstrated invalidation behavior. This patch intentionally does not expand into that separate optimization. CPU sampling, terminal paint/backpressure, real scheduled load and an all-frame latency bound are not proven by these timing runs.

Values unchanged: measured proof, smallest working change, honest remaining limits and reproducible dependency edits already cover this lesson. Feature recipe and evidence stay here.
