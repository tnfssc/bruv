# Long-thread latency after PR 25

## User correction

The user installed 0.15.30 after PR 25 and reported that typing, loading animation and the whole long thread still felt slow. The first acceptance was not enough. It measured task-row ownership and waited for eventual terminal frames. It did not measure input echo delay or spinner cadence. One-line tool fixtures missed ordinary footer work over a large saved history. Do not call this fixed until that actual path improves.

## New measured clue

The released SDK AgentSession.getContextUsage calls buildSessionProjection and getBranch on each read. Both footer renderers call it on every repaint. The existing footer cache only saves aggregate usage and cost; it does not save this context calculation. The disk-backed adapter materializes bodies for those full-demand APIs.

A parent probe used the actual pinned 1.0.0 AgentSession method and disk-backed SessionManager. It appended synthetic user/markdown assistant turns, then called the unchanged method six times. Each call read the branch. Warm medians: 40 entries 2.77 ms; 400 entries 38.84 ms; 2,000 entries 253.06 ms. Probe: /tmp/bruv-context-usage-probe.ts. These isolate the likely cause; they are not terminal latency proof. The implementation worker must retain a portable real-footer benchmark.

The current parent session shape was inspected without retaining text: about 1.22 MB on disk, 258 message records, median serialized message 2,894 characters, p95 9,520, max 15,551. It is a shape reference, not a claim that this is the user’s slowest session. No real session was changed.

## Owners and resume

- Integration: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_43fd9f57`, branch `fix/long-thread-full-frame-latency`, base `f9638335` (released 0.15.30).
- Context-usage fix: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_83b8ecf8`, branch `fix/footer-context-repaint-latency`.
- Actual installed-binary latency harness: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_39ecf1c9`, branch `test/long-thread-measured-latency`.
- `8a8433ee` is an unrun first harness draft. It has wrong provider and measurement assumptions. Do not treat it as proof or publish it alone.

The first full-layout worker did not reproduce the lag and made no fix. Its layout-only profile excludes the footer, so it cannot rule out app-level lag. The installed binary is `/home/tnfssc/.local/bin/bruv`, version 0.15.30. All changes stay apart from the main checkout’s unpublished native work.

## Next gate

Get real short/long key-to-echo distributions while a controlled local provider holds a response. Count changes in the actual spinner, not unrelated frame changes. Assert the provider was reached and every input token was rendered. Record polling overhead. Repeat on the final compiled candidate with the same data. Preserve history, scrolling, expansion, resize, model changes and context accuracy. Report whatever still fails.

## Implementation checkpoint

The footer-only draft `64409402` is rejected. Its 250 ms expiry would keep making expensive synchronous reads and may expire during the read itself on a large history. Do not cherry-pick it. Parent implemented the cache at `AgentSession.getContextUsage` inside the existing disk-backed history adapter instead. That owner can read `_limitsModel().contextWindow` directly, so a routed model change invalidates immediately without polling. The other keys are manager/session ID, leaf, metadata-array identity and count. Cache values are only numeric context usage, never projections or message bodies. In-memory managers keep native behavior.

The focused four-file suite passed 24 tests / 287 assertions, including real disk-backed whole-footer repeated renders with zero historical materializations and parity after history/limit changes. TypeScript passed. Real installed-binary reproduction is now successful; the candidate still needs the identical final measured run after its official build.
