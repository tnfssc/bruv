# Long-thread latency after PR 25

## Current handoff: compiled 100 passes; 1,000 still fails

Latest runtime integration is `9f797667`; the compiled measurements below are from `775ed3df`, before the native settled-shell cache. The built candidate passes all unchanged latency gates at 100 turns / 1,201 entries: idle p95 32.2 ms, held-input p95 29.2 ms, 62 observed spinner transitions in five seconds. The installed 0.15.30 baseline has held-input p95 171.4 ms on the same fixture.

At 1,000 turns / 12,001 entries, the candidate still fails: idle median 51.2 ms but first input 1,279 ms; held median 78.6 ms but first input 936 ms, with a few later samples over 100 ms. Spinner cadence passes (55 transitions, gap-p95 110 ms). Do not call the whole long-thread task fixed. Synthetic raw checkpoint data is in [full-frame-latency-checkpoint.json](full-frame-latency-checkpoint.json).

The integrated checks pass: 137 focused tests / 1,162 assertions, TypeScript, build, and five compiled terminal-flow tests / 220 assertions. The full 1,000-turn latency gate fails. Read-only review task_5d5e112f found no concrete integration blocker; it did not establish performance.

Remaining render work: task_fa6de4df, worktree `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_fa6de4df`, branch `fix/long-thread-render-tail`, base `775ed3df`. It is profiling the remaining native render cost and cold first-frame stalls. Parent owns integration, final compiled proof, and the PR. No follow-up PR or release is published.

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

The independent 1,000-turn diagnostic completed with the 30-second setup limit. It did NOT meet the performance goals: 12,001 entries, idle median 273 ms, held median 472 ms, only 21 observed spinner transitions in five seconds. A retained real frame shows the last saved tool results, submitted prompt, loading glyph and echoed draft. This is not just a cold-start issue at that scale. Full-frame scaling is delegated to task_e17b18f2 in `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_e17b18f2`, branch `fix/large-thread-frame-scaling`, base `2d37e58d`. It owns the actual steady-frame hotspot, not the history context cache. No heavy parent timing jobs run alongside its profiling.

The metadata trace confirms why the single-user shortcut misses the first real prompt: the SDK appends a new system message, then the user message. The required request projection contains both. Parent harness now reports request setup time and start/end host load separately; neither changes the echo or spinner gates.

## Request projection seeds numeric context usage (source proof only)

The disk manager now reduces every required request projection through the captured SDK 1.0.0 context estimator, supplying that projection and temporary metadata skeletons for its branch type/id lookups. Only tokens (including compaction's unknown/null), session/context identity and a weak metadata-array identity survive. No projection, messages, branch array, per-leaf map or TTL is retained. Live routed limits supply window/percent on each read without recalculating tokens; the guarded trailing-user shortcut remains for reads before request preparation. Unowned managers still call the native method. The outer shake adapter still owns freshness and fail-closed marker validation.

The focused test invokes the actual SDK pre-HTTP request-projection hook with a stub agent after a system+user append, then proves zero body materializations for the first usage and both whole-footer reads. It separately compares with the public native projection builder/native estimator for edits, branches, compaction/null, reset, switch and routed limits; seeded invalid shake records still throw. This assumes the pinned estimator's branch access remains type/id-only; SDK upgrades must revisit it. Source tests and type checking pass, but no new compiled latency gate was run here. The parent must integrate, compile and measure; do not call the full-CLI lag fixed. Values stay unchanged: this applies the existing bounded-state and real-acceptance guidance.


## Settled execute previews were still formatting every frame

A new full-source CLI CPU profile at 1,000 turns (12,001 saved entries, 15,428,991 bytes, 5,000 execute/tool pairs) found a separate steady-frame cost after accounting was warm. The path was TuiAltScreen.doRender → renderLayoutFrame → transcript Container.render → ToolExecutionComponent.render → Box.render → executeOutputPreview's render closure → truncateToWidth/grapheme segmentation. The held-spinner final five seconds had 1,929 inclusive samples in the result-preview closure and 1,718 beneath truncateToWidth. This is the actual CLI with pinned Pi 1.0.0 modules and all extensions, not a dummy layout.

Completed execute-result previews now retain only their most recent rendered width. Native invalidate clears the rows; resize replaces them. Pi recreates the result component on result updates and expansion, and invalidates/recreates it for theme changes. Call and partial-result previews remain uncached so their mutable spinner state is visible. The cache is component-owned, not a transcript cache, and retains no extra saved-history projection. Focused checks include native ToolExecutionComponent expansion, result replacement, resize, and invalidation, plus direct settled/partial preview checks.

Matched source diagnostics (three echo samples, CPU profiling on, no acceptance budgets) had long idle median 103 → 79 ms, held median 170 → 110 ms, and observed spinner transitions 52 → 61 in five seconds. First idle echo still took 468 ms in the candidate; held p95 was 122 ms, so this is NOT passing acceptance. Final held-spinner render-subtree inclusive samples fell from 3,980 to 2,056; result-preview formatting no longer appears among the hot paths. Sampling counts and shared-host timings are diagnostic, not exact per-frame durations. Parent still owns compiled final proof and projection reuse integration.

Synthetic local evidence: /tmp/bruv-render-profile-result.json and /tmp/bruv-render-cached-result.json; profiles /tmp/bruv-render-profiles/CPU.20261004.095730.1897202.0.001.cpuprofile (before) and CPU.20261004.095946.1915946.0.001.cpuprofile (after). Probe entry /tmp/bruv-render-profile-entry.ts imports this worker's exact worktree CLI; /tmp/bruv-render-profile-cli uses Bun 1.4.2 CPU profiling and SIGHUP exit to flush. No latency budgets were changed, no history was truncated, and no unrelated processes were stopped.


## Native settled execute shells still traversed their descendants

Follow-up on the combined 190bfcac + 775ed3df base used the actual source CLI, this worktree's pinned Pi 1.0.0 dependencies, Bun 1.4.2, all normal extensions and the unchanged actual-CLI tmux harness at 1,000 turns (12,001 entries / 15,428,991 bytes). It is diagnostic evidence, **not compiled acceptance**. Parent's compiled integration still owns the unchanged budgets and all first samples.

The remaining steady-frame path was TuiAltScreen.doRender → renderLayoutFrame → transcript Container.render (including sdk-task-rows) → conversation-density denseRender → native ToolExecutionComponent.render → selfRenderContainer / Box.render. The result preview was warm, but the native shell still assembled child rows and mouse geometry each time. In the last five seconds of the baseline CPU trace, the render subtree had 2,052 inclusive samples, native tool render 589, and Box 404. The hypothesis was confirmed rather than inferred from the old preview profile.

The new local pinned seam wraps **only the native completed execute shell**, below density and live task-row overlays. Each tool weakly owns one most-recent width of rows; no session projection or width map survives. Pi's updateDisplay lifecycle clears it on args/results, expansion, image options/conversion and native invalidate (themes included). Pending calls, partial results, other tools and native protocol-image components remain uncached. Returning cached rows retains the shell's already-rendered mouse geometry at that width; native mouse expansion clears it through updateDisplay. Disposal deactivates retained wrapper chains and releases the weak row map. The prior projection-seeded numeric usage and settled preview caches are unchanged.

The matched candidate's last-five-second render subtree fell to 1,392 inclusive samples (~32% lower); native tool/Box traversal disappeared from the hot nodes. Shared-host source timings: long idle median 52 → 50 ms, first idle 497 → 120 ms; held median 75 → 53 ms, held p95 100 → 124 ms; spinner transitions 62 → 61, gap p95 about 108 → 107 ms. These noisy runs are **not green**; the candidate still has an over-budget first idle and later held sample. No budget or first sample was removed. Focused native lifecycle tests cover width replacement, expansion, mouse routing, result replacement/error, args, invalidation/theme initialization, image bypass, partial/pending and live task-row updates. Adjacent density, task-row, preview and fullscreen editor tests pass (92 tests total); tsc --noEmit passes. No web build or compiled gate was run here.

Diagnostic files: /tmp/bruv-render-followup-before.{json,log}, /tmp/bruv-render-followup-after.{json,log}; traces /tmp/bruv-render-followup-profiles/CPU.20261004.101759.2040383.0.001.cpuprofile (before) and CPU.20261004.102325.2077110.0.001.cpuprofile (after). Exact-worktree source launcher: /tmp/bruv-render-followup-entry.ts and /tmp/bruv-render-followup-cli; analysis helpers: /tmp/bruv-render-followup-{analyze,window}.ts. Paths are temporary, not permanent evidence storage.

### Cold stalls are separate from settled tool formatting

The baseline first-idle window (5.5–6.5 seconds from CLI profile start) had 827 render samples; 672 descended through saved AssistantMessageComponent.render, including Markdown.render, mermaid's Markdown transformer lexer and the native Markdown lexer. Pi InteractiveMode.init first flushes the loaded transcript with ui.renderNow, then loadAllHighlightLanguages().then calls **ui.invalidate()** and requests another frame (pinned interactive-mode.js around lines 796–800). Native AssistantMessageComponent.invalidate recreates content via updateContent, losing its rendered Markdown rows; the next full transcript frame transforms/lexes saved prose again. This explains a concrete cold idle stall, unlike changing numeric usage caching. The native shell cache must honor that invalidate and does not solve wholesale saved assistant reparsing.

Submission is also not just a render: prompt → _checkCompaction and agent-loop transformContext → emitContext → native-compaction's nativeEntriesInContext/nativeDetailsInContext/adaptNativeCompactionMessages materialize branch bodies, and native-fast-mode's capture → resolveSetting → branch does another branch scan. The 10.5–12.5-second baseline window has 738 emitContext samples and 572 in the compaction context handler, plus fast-mode capture. These paths account for request setup cost, not proof of the compiled first-held delay: this source run's first-held input was 52 ms both before and after. The parent's compiled 936 ms first-held sample was **not reproduced or conclusively attributed**. No history/session-manager.ts or context-cache tests were edited.

Scoped next steps, not implemented speculatively:
- Fix the grammar-readiness owner: load grammars before the first **saved transcript** paint (without delaying terminal/editor startup), or make the completion callback invalidate only syntax-bearing Markdown instead of globally rebuilding all saved assistant prose. This requires a targeted Pi startup/Markdown lifecycle change, not skipping theme invalidation or caching arbitrary dynamic assistants. Measure the same first samples afterward.
- Inspect a compiled CPU trace around the first-held sample before claiming its cause. Separate late invalidation/full Markdown rendering from context hooks and GC; source medians cannot stand in for that sample.
- For submission setup, investigate metadata-scoped reads at the compaction/fast-mode owners; keep the required full request projection and fail-closed marker validation. This is separate from the bounded render fix and needs parent agreement before changing history interactions.

Values unchanged: bounded owner state and honest real-pipeline acceptance already cover this lesson.

## Remaining owners after the native-shell fix

`eea8523f` was reviewed and integrated as `c64e6166`. It caches native completed execute shells below density/task overlays, clears at Pi updateDisplay, and leaves partial tools and protocol images native. Its source profile still was not acceptance.

- Request hook scans: task_c92d3d57, `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_c92d3d57`, branch `fix/request-hook-history-scans`, base `0fa32939`. Scope: metadata-scoped compaction and fast-setting reads. Opaque checkpoint validation and cost acknowledgment must remain fail-closed.
- Saved-transcript grammar readiness: task_078fc82d, `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_078fc82d`, branch `fix/saved-thread-grammar-readiness`, base `c64e6166`. Scope: avoid the proven post-paint global invalidation from asynchronous grammar loading without freezing real theme/resize changes or delaying terminal/editor mounting. A tracked dependency patch may need fresh installation before building.

Wait for both pieces, review and integrate, then run the official build and unchanged 100/1,000-turn compiled gates. Do not skip the first samples. The compiled 936 ms first-held sample is still not conclusively attributed; the grammar trace proves the cold idle path, not that separate sample.

Request-hook work was reviewed and integrated: `75e0b159` → `9f797667`. [Metadata selection notes](request-setup-metadata-selection.md) record the exact branch/context rules. Ordinary histories now cause zero body reads in those hooks; matching native checkpoints are read once and reused. Invalid and incompatible replay and fast cost/identity checks stay in place. Worker checks: 77 tests / 406 assertions plus two history parity tests / 27 assertions and TypeScript. No new compiled gate yet. Grammar-readiness task_078fc82d is the remaining code owner; install any tracked dependency patch before the final build.

### Saved-transcript grammar readiness — task_078fc82d (2026-10-04)

The pinned SDK 1.0.0 has no supported startup grammar-readiness seam. A tracked Bun patch now starts its existing loader after the UI/editor is mounted for an already-loaded session, overlapping terminal-color/tool/extension setup. It awaits readiness immediately before native renderInitialMessages and omits only that case's redundant completion-time global invalidate. Empty sessions retain the existing post-flush lazy loader/callback (including its shutdown guard). Theme/result/resize and explicit invalidations remain live; no Markdown cache, lexer skip, budget change, request-hook edit, or copied init method.

The decision uses session.state.messages.length, the SDK's existing resumed-session signal in getChangelogForDisplay; no history scan is added. It describes history already loaded when init mounts, not messages first added by an extension during initially-empty setup. The existing loader still schedules import with setImmediate and preserves its eager-language/plaintext fallback on import failure. UI startup gains no readiness await; synchronous grammar evaluation still occupies the JS loop during setup. This is owner-ordering evidence, not a compiled latency acceptance claim.

Integration: cherry-pick package.json, bun.lock, and patches/@earendil-works%2Fpi-coding-agent@1.0.0.patch together, then run Bun 1.4.2 install --frozen-lockfile **before building**; old node_modules alone will not acquire the patch. Do not rerun bun patch --commit or upgrade the SDK. The patch was prepared with bun patch isolation and changes only shipped dist/modes/interactive/interactive-mode.js.

Checks: five isolated-process cases execute the installed SDK's actual patched init and real language loader with deferred readiness/tool environment controls, exercising early/late grammar completion, mounted-editor typing, saved versus empty startup, lazy completion after shutdown, unchanged rebind error propagation, and a non-eager Elixir grammar. Native saved assistants still rebuild/recolor on theme/explicit invalidation, replace content, and render at changed widths. Focused startup/density/execute tests: 71 pass; adjacent editor/fullscreen-editor/task-row tests: 34 pass. Asset preparation + tsc --noEmit, focused Biome check, and git diff --check pass. Frozen installation reapplies the tracked patch. No compiled CLI/web build or large timing job was run; parent owns 100/1000-turn first-sample input/spinner gates.

Values unchanged: this is the existing bounded-owner-state and honest real-pipeline acceptance lesson, not a new general rule.

## Published base changed during the investigation

Develop advanced to public v0.16.0 at `3eec281b`; merged as `271e27a4`. The original unpublished rolling branch was NOT merged. Published rolling activity now calls getBranch on every transcript frame, so task_2239a5c5 owns a fresh fix against this released source: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_2239a5c5`, branch `fix/rolling-membership-frame-reads`, base `271e27a4`. Its revision must include ACTIVITY_BOUNDARY, not just ordinary context messages.

The tracked grammar patch was installed with bun install --frozen-lockfile. The merged source passes TypeScript. Combined tests exposed global prototype pollution from the new request-hook test: another file had installed the shake wrapper first. That test now runs its unchanged assertions in a child SDK process, matching the production disk-before-shake install order, like the existing context-cache tests. No production fallback or assertion was removed.

A checksum-verified released v0.16.0 pair is private under integration artifacts/latency/baseline-v0.16.0. Main SHA256: `98baeccaf1cb570fbd26e74acdb6a9ebcc1139e84657d28dce815b7a4609c4b4`; companion: `7db4e33a6a9f329b734a515925584c8786d9a2a00dbfb88b14013569eaff89bb`. It is a test baseline, not an installation. Parent is measuring it at 100 and 1,000 turns. Final builds now use the v0.16.0 official paired build, not the removed web-payload path.
