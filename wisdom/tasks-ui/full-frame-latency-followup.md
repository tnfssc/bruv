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

## The first candidate still failed

The matched installed/candidate PTY gate exposed another missed layer. At 100 turns, installed 0.15.30 held-input p95 was 409.6 ms, and the SDK-cache-only candidate was still 280.5 ms. The candidate restored 60 spinner transitions in five seconds, but failed the 100 ms input budget. It was not published as a fix.

A CPU profile of the complete source CLI running the same synthetic PTY fixture attributed about 4.47 seconds of parsing to `manual-shake.ts` → `lacksFreshUsage` → `buildContextEntries`, reached through the footer. `installShakeAccountingAdapter` wraps `getContextUsage` after the disk-backed adapter. The first unit probe had omitted that wrapper. Profiles remain locally under `/tmp/bruv-input-profiles/`; they contain only the synthetic fixture.

The final change also caches the shake freshness boolean by session ID, leaf, metadata-array identity and count. Invalid or unsupported shake records still throw. Marker append, branch changes, and valid post-shake usage invalidate the result. No timer, projection or message body is retained. The regression test and portable footer benchmark now install both adapters in the same order as the CLI. It checks warm compact and detailed footer reads, valid and invalid shake markers, post-shake usage, compaction, branching and routed limits.

## Keep bookkeeping out of the context revision

A cache-miss trace of the real CLI showed `bruv-cache-call` causing a full recalculation just as the held response began, though it changes neither model-visible context nor shake freshness. The final caches use the latest active context entry, not every journal append. The disk index now records the tiny customType field so it can recognize shake markers without loading bodies. Messages, custom messages, compactions, branch summaries, context edits and shake markers advance the context position. Cache/cost bookkeeping, labels and session names do not. A replaced metadata array or session and changed routed limits still invalidate. The accounting cache’s non-disk fallback keeps the SDK metadata count key.

The source CLI then passed the unchanged 100 ms echo-p95 / 140 ms observed spinner-gap-p95 / 45-transitions-in-five-seconds budgets at 100 turns. Long-thread input p95 was 31.2 ms idle and 27.8 ms during the held response, with 61 spinner transitions. This is source evidence, not the final compiled gate. The final gate uses the same fixture against released 0.15.30 and the rebuilt candidate, then expands the candidate to 1,000 turns. No budget was relaxed.

## Remove the first-input cold scan too

The budget kept catching a single expensive frame after submitting a prompt, even once steady frames were fast. The native estimator adds `estimateTokens` for a trailing user message; it does not need to rebuild the unchanged prefix. The guarded fast path applies only when that user message extends the cached active context at the same routed limit. It reads that one new message, keeps post-compaction unknown usage unknown, and otherwise falls back to the SDK. Tests compare with the unwrapped SDK, including an edited prefix and an image in the user message. Shake freshness ignores user/tool messages because only an assistant can supply fresh usage.

The footer’s totals cache also now keys on the latest usage-bearing metadata index across all branches, rather than cache observations and labels. New assistant/tool usage, compaction or branch-summary usage, compaction-attempt costs, native-fast markers and voice cost records still update it. The real whole-footer test verifies zero historical reads after cache bookkeeping and verifies changed costs appear. The HTTP fixture now waits until the request body is consumed and response headers are sent before measuring held-response input. Both idle and held phases use the declared sample count, and held-input frames are retained.

## Checkpoint: compiled acceptance is not green

The rebuilt candidate still misses the full latency gates. One noisy run failed even the short-thread spinner gate; host load was about 32. The long first held-input sample was 233 ms while the later samples were about 41–74 ms. Do not report this as fixed. A fresh SDK miss trace still shows a full native context read after prompt submission (36 ms at 1,201 entries); the guarded single-user append case does not cover that real submission path. Request preparation already calls buildSessionProjection before sending HTTP. Next: reuse its numeric context estimate without retaining its messages, then recheck the full compiled path.

The 1,000-turn diagnostic reached input testing but timed out waiting five seconds for HTTP request preparation. That is a setup limit, not the input latency gate. The harness now gives request preparation 30 seconds and saves a failure frame plus partial measurements. The three input/animation acceptance thresholds are unchanged. Do not kill unrelated processes to improve a benchmark.

Projection reuse is delegated to task_beb52913. Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_beb52913`. Branch: `fix/context-projection-accounting-reuse`, based on `8d0e7e3f`. It owns history/session-manager.ts and the context cache regression, not UI or latency thresholds. Parent keeps the integration tree and final compiled checks.
