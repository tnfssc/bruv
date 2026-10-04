# Long-thread task-row rendering

## Cause and fix

Each collapsed execute used to scan all siblings, merge every typed task, then search siblings again for each task source. A repaint did quadratic work even without tasks and could do cubic work with tasks. Editor input and animation share this synchronous render path, so both stalled.

Collect rows once per parent render. Preserve sibling order when merging execute details and notices, then merge the live snapshot. Index source call IDs and rows by owner. Child renderers use that frame’s index. Drop it after rendering, so partial results and task updates are never cached across frames. Expanded details still use the native renderer.

Only build the index when a parent has collapsed execute or task-notice children. Native tool bodies are containers too. The first draft called the live snapshot inside every body; the expanded-live benchmark caught 1,001 snapshot reads per frame and 846 ms at 1,000 tools. The final path skips those unrelated containers and does no ownership work for a fully expanded transcript.

## Proof

Run `bun scripts/benchmark-task-row-render.ts` in an installed checkout. It uses real Pi tool components, three warmups and seven samples, with no provider. Compare the same fixture across revisions. Times are local medians, not CI thresholds.

| Fixture | Before (develop) | Final |
| --- | ---: | ---: |
| 500 persisted task rows | 1,613.458 ms | 4.168 ms |
| 1,000 persisted task rows | 8,572.149 ms | 6.303 ms |
| 1,000 expanded tools with live tasks | 0.806 ms | 0.333 ms |

Final 1,000 tools without tasks: 0.445 ms. The initial audit measured about 155 ms with activity enabled; that was a different full-layout fixture, not a matched comparison to this number. Rendering remains linear in transcript/row size, not virtualized.

The focused suite passed 83 tests / 408 assertions: task rows, conversation density and execution previews. Count-based tests assert linear detail reads, a single parent snapshot despite nested native containers, no snapshot for fully expanded tools, and chronological outcome precedence. TypeScript passed. The final fresh `bun run build` passed, followed by six compiled-terminal tests / 246 assertions. The real compiled-terminal suite covers 1,000 saved tools across 100 user turns, typed input, Home/End history navigation, Ctrl+O expansion/collapse and a 48-column resize, plus existing preview, editor and task-monitor flows. Frames live under `artifacts/tui/bruv-long-thread-*`; inspect them, not only the passing assertions. An early assertion saw the previous frame; it now waits for the changed collapsed row and reflowed footer.

## Scope and resume

The human chose a clean PR against develop. Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_6d5d7a6d`. Branch: `fix/long-thread-tui-lag`. Base: `b47e4f5f`. No unrelated local feature commits belong in this PR.

The second root cause is in the unpublished rolling-activity feature: it materialized the disk-backed branch on every frame. Its separate local fix is `682273e0` on `fix/long-thread-local-feature`, worktree `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_cf9459d7`. That branch starts at `156e2450`; it does not yet include this renderer fix. Its history-only probe improved 1,000 entries from 29.7289 ms / 1,000 materializations to 0.0308 ms / zero. It passed 43 focused tests and TypeScript. Apply the shared renderer fix too when integrating that feature. See its `wisdom/tasks-ui/rolling-activity-journal-cache.md` for invalidation and limits. The mistaken full-file restore on `fix/activity-repaint-history` is superseded; do not cherry-pick `6481f622`.

Values stay the same. Existing guidance already calls for measured work, real visible frames, safe scope, and code with a durable handoff. No new broad rule is needed.
