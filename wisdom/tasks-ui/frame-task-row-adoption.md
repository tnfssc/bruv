# Adopt normalized task rows only inside the current frame

2026-10-05 · task_2c7a0457 · baseline 3379c5984e5721370dbc19c76af75e0b0152db67

## Decision and actual callers

After [lazy bodies](lazy-activity-body-render.md) and [frame-local ScrollView sharing](scroll-content-frame-cache.md), the document still visits every component once. The supplied parent profile pointed at task title normalization, merging and activity membership. I profiled the whole current input/1000 render separately, then followed sampled callers rather than treating every cloneObject sample as production work.

Within doRender, the concrete path is ScrollView/layout → the workload's document wrapper → ActivityController.sync → SDK task ownership Container.render. Ownership calls taskRowsFromDetails (which already merges into a fresh map and normalizes title metadata), immediately spreads each returned tool row to replace sourceCallId, then calls upsertTaskRow again. The by-child pass calls taskRowWithExecuteLabel even when the freshly normalized explicit title already wins. Membership is a separate sync → activityMembership path; notice detail normalization occurs in sync too. Those are not changed here. Some parent cloning was fixture instrumentation; no fixture, profiler, budget or dependency patch was changed.

Small production change in src/ui/sdk-task-rows.ts:

- Adopt the first fresh normalized detail row directly into the frame's ownership map. Assign tool provenance on that fresh object, never the raw TaskRow. Collisions still use the existing upsertTaskRow terminal-truth rules, including interleaved custom notices.
- Snapshot rows still always use upsertTaskRow. They are mutable producer data, not trusted normalized frame objects.
- Do not clean/copy an explicitly titled normalized row just to check an execute-label fallback. Missing titles still recover the current label.

The taskRowsFromDetails fresh-row contract is documented in src/ui/task-rows.ts. All maps still rebuild each render. No persistent cache, freezing, fixture shortcut, changed summaries, branch revision policy or new invalidation machinery. Live status/partial results, labels, notices, ownership, snapshots, branch replacement, expansion, theme and width continue through the existing fresh rendering paths. Adoption deliberately happens *after* per-detail normalization/deduplication: merging raw detail updates directly into the global map could alter terminal/extra-field precedence.

For 1000 unique titled settled tools this removes 1000 redundant post-detail upserts, 1000 label-helper calls and 3000 row-object copies (source spread, redundant upsert result and redundant label result). Snapshot merging and colliding notices remain. The focused deterministic 80-tool test checks 80 detail normalizations, zero label-helper calls, and identity of all 80 normalized rows in the projected overlay. Every raw row stays a different object with unchanged producer provenance. On the prior adapter the test fails: label helper called 80 times, expected zero.

## Matched full-run proof

Local worktree: /home/tnfssc/.bruv/worktrees/t3code-bbf9268f-5442693331ce-task_2c7a0457

```sh
bun run perf:terminal --samples 40 --out artifacts/terminal-perf/task-projection-before
# apply production diff
bun run perf:terminal --samples 40 --baseline artifacts/terminal-perf/task-projection-before/run.json \
  --out artifacts/terminal-perf/task-projection-after-isolated
bun --cpu-prof --cpu-prof-md --cpu-prof-dir artifacts/terminal-perf/task-projection-profile-before \
  scripts/terminal-perf.ts --case input --scales 1000 --samples 100 \
  --out artifacts/terminal-perf/task-projection-profile-before
# repeat profile after in task-projection-profile-after
```

The matched before/after timing runs had no other task-owned test/build/profile job overlapping them. An initial after run (task-projection-after) overlapped a 484ms focused test job; it is **not** the timing evidence used here. Both selected runs: Bun 1.4.2, Pi 1.0.3, Linux x64 Ryzen 9 7940HS, viewport 120×40, warmup 5, scales 100/500/1000, fixtureVersion 1, 18 cases × 40 steady samples. Before is clean 3379c598; after includes this small dirty production diff. Shared-host timing noise remains.

**All 738 corresponding cold/steady screenHash AND outputHash pairs match.** All 720 steady actions change rows. No intentional visible fix. [Full comparison and metadata](evidence/frame-task-row-adoption/comparison.json), [before report](evidence/frame-task-row-adoption/before-report.txt), [after report](evidence/frame-task-row-adoption/after-report.txt). Raw run/dashboard/trace files remain at the ignored local paths above.

| 1000-execute case | p50 before → after ms | p95 before → after ms | cold before → after ms | steady misses before → after /40 |
| --- | --- | --- | --- | --- |
| input | 9.082 → 7.559 | 12.639 → 15.520 | 27.037 → 22.652 | 30 → 17 |
| animation | 8.626 → 7.326 | 13.265 → 12.753 | 21.085 → 19.324 | 30 → 10 |
| streaming | 8.528 → 7.050 | 11.955 → 12.822 | 23.602 → 22.080 | 27 → 10 |
| resize | 13.293 → 12.175 | 19.503 → 17.460 | 19.414 → 18.286 | 40 → 40 |
| scrollback | 9.649 → 6.728 | 12.763 → 11.519 | 19.825 → 21.929 | 37 → 8 |
| task-update | 9.651 → 6.355 | 12.336 → 9.006 | 19.719 → 17.216 | 39 → 4 |

Input max 14.952 → 17.523ms: the tail is **worse**, not a claimed universal latency improvement. The p50 reduction plus deterministic removal of redundant work supports this small patch, not a tail or budget guarantee. Do not substitute the supplied parent's 9.023ms p50 baseline for this worker's own 9.082ms matched baseline.

Input/1000 work counts are intentionally unchanged: one document render, 1752 component visits, 2252 branch entries, 1000 snapshot rows. This removes operations *inside* the ownership pass, not the document traversal. [Render-only sampled caller evidence](evidence/frame-task-row-adoption/profile.json) retains both raw profile paths. Samples beneath doRender show the SDK direct upsert path and redundant label helper; after, label-helper samples disappear and direct upsert work is smaller. Profiles include cold/warmup/steady renders and sampling overhead; none of those numbers is budget proof.

## Behavior validation

- Focused existing/new suites: task-rows, rolling-activity, settled-execute-render, execution-previews, rolling-activity-disk, scroll-layout-render, fullscreen-editor: **117 passed / 1306 assertions**. New tests verify fresh object adoption, untouched raw metadata/provenance, changed raw title/status, changed execute label, authoritative snapshot replacement, custom-notice terminal update, detail expansion and narrow width. Existing tests cover partial results, source ownership, capped summaries, branch changes and reinstall/replay behavior.
- bun run check; bun run build; focused Biome format/lint; git diff --check: passed.
- Compiled terminal: bun test tests/long-thread-tui.test.ts tests/execution-previews-tui.test.ts: **2 passed / 1107 assertions**. Real tmux/compiled dist/bruv with 1000 saved executes: input, both ends, expansion, anchors, narrow resize, quit/reopen, oldest/latest detail and regular mode. Inspected loaded, typed, narrow, reopened-latest-detail and regular-expanded captures in artifacts/tui/bruv-long-thread-702313-1791230388934. Drafts, grouped counts and real native evidence remain readable.

## Honest remaining work

Still not all-frame <8ms. All six scale-1000 cold renders miss; resize misses all 40 steady frames. Scale-500 cold renders all miss; steady misses are input 1, animation 1, streaming 0, resize 3, scrollback 1, task-update 0. Scale-100 has no steady misses but first input cold misses. Real scheduler/load, emulator paint, backpressure, disk/session materialization and unsampled frames remain separate scopes. The remaining document/membership and snapshot traversals were not redesigned or cached here.

Values unchanged: existing measured-proof, smallest-working-change and honest-boundaries values cover this result. Feature-specific evidence and the fresh-row adoption recipe belong here. Parent owns integration notes in terminal-frame-lab.md; this task did not edit that shared note, harness, package or SDK patch.
