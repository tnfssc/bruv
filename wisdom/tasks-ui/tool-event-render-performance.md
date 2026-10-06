# Initialized tool-event render/input backlog: duplicate fitting-row clipping

## Change and scope

Owned change: `src/ui/execution-previews.ts` expanded execute output only. Measure a decorated row with native `visibleWidth` before calling native `truncateToWidth`. A fitting row is returned unchanged; overflowing rows still use precisely the existing native clipping. This removes prefix construction/ANSI parsing/grapheme accumulation which native truncation performs even when it ultimately returns its original input. It does **not** move synchronous work into the event callback, defer it, cap output, alter storage, replace Unicode wrapping or change expansion. Narrow oversized graphemes, titles and artifact warnings still clip normally. Width/theme invalidation and new partial/final component creation remain owned by the existing lifecycle. No SDK patches, history/cost changes, fixture API/test changes or activity wrappers changed.

Read the values and terminal-tool-event-workloads, terminal-interaction-lab, terminal-text-wrap-performance and sdk-large-text-block-render-fix notes first. The existing SDK wrapping optimization is already applied; its remaining Unicode work is not this patch's scope.

## Attribution before choosing the fix

Provider-free actual initialized `InteractiveMode.handleEvent` workload; history 8, burst 4, args/final targets 65536 bytes. The direct injected event burst includes late/duplicate/orphan final ordering and then nine real registered inputs, including subscribed Enter into a recording provider. This is **not** complete Bruv extension startup, transport/stream/journal proof, or terminal paint latency. Journal growth in the fixture is retained but not presented as full injected-event persistence proof.

- CPU profile (startup inclusive): `before.cpuprofile`; first scheduled expanded Unicode frame 61.662 ms, reveal 23.629 ms, burst 4.275 ms. Sampling shows native `splitIntoTokensWithAnsi`, `graphemeWidth`, width-regex work; startup dominates parts of the inclusive profile, so it is not a frame-only timing decomposition.
- Native ToolExecution + Text/Box/Markdown + registered renderCall/renderResult probe: `probe-before.json`. First actual expanded execute result component 30.085 ms / native tool render 30.241 ms / whole first scheduled frame 31.071 ms. Reveal component 13.493 ms / tool 13.516 ms / whole frame 13.984 ms. Native layout outside the preview is small in this sample. Instrumentation and utility/JIT warmth change timings: do not subtract these samples from the 61.662 ms profiled sample.
- Separate temporary function-level instrumentation: `preview-costs.json`. First expanded frame: source normalization 0.058 ms + native wrap 10.496 ms; output normalization 0.083 ms + native wrap 7.905 ms; **Bruv's final clipping map 10.378 ms** across 502 rows. Reveal: source wrap 2.818 ms, output wrap 2.768 ms, clipping 11.742 ms. Whole first/reveal frames 30.234/18.161 ms. Registered renderer callbacks are all <0.17 ms each. This is an extra pass over already laid-out visible text, not hidden code/output truncation.
- The registered execute renderer emits muted plain TypeScript, not syntax-highlighted code. Its call slot is suppressed by result-visible state, and the result slot owns the source/output preview. The actual first frame is **expanded** (InteractiveMode's initial tool state), so removing collapsed-only work would not fix this observed frame. Generic structured shape uses SDK native fallback (zero registered result renderer calls); its JSON/Text work is a separate unchanged path.

All temporary source instrumentation was reverted. Original source and the reusable method probe/matrix scripts are retained beside raw artifacts, not installed into the product.

## Serial matched evidence (unprofiled)

Seven cases before, then the identical seven after in fresh processes; no concurrent performance jobs. Two Unicode repetitions; each other row is one observation, not a percentile or budget test. These are shared-machine timings. Args/final bytes are retained in each JSON (Unicode 65576/65594; structured args 90891). Source/content/history fingerprints and full ANSI rows are retained.

| Case | Burst before→after ms | First scheduled frame before→after ms | Reveal frame before→after ms | Worst of four queued inputs before→after ms |
|---|---:|---:|---:|---:|
| unicode-1 | 2.398→2.673 | 36.002→28.028 | 21.337→6.796 | 41.453→33.914 |
| unicode-2 | 2.473→2.564 | 33.219→22.200 | 19.323→6.684 | 38.700→29.136 |
| error | 2.461→3.281 | 34.034→20.948 | 18.417→5.829 | 39.453→27.173 |
| structured | 4.443→4.823 | 17.109→15.950 | 7.105→9.957 | 25.685→24.298 |
| ascii | 2.486→2.145 | 31.721→14.121 | 13.851→5.466 | 37.985→19.897 |
| ansi | 2.607→3.652 | 14.580→9.922 | 5.161→7.596 | 20.646→17.593 |
| newline | 2.269→2.250 | 18.547→4.888 | 11.409→3.340 | 24.821→10.177 |

All seven pairs: identical event-content and history hashes; **all ten scheduled frame arrays equal byte-for-byte after normalizing only the random /tmp/bruv-tool-event-perf-XXXXXX footer path**. Full native ANSI content is compared, not just final markers. All samples retain finalSeen/finalStateMatches true, pendingAfterFinal 0, nine inputs and one recording-provider request. Intermediate updates are intentionally coalesced, not final data loss.

Structured reveal and ANSI reveal worsened in these single samples; do not claim universal speedup. Remaining native wrapping + width measurement and large SDK layout still block synchronously. Even improved Unicode cold frames and queued-input lateness remain above 8 ms. This isolated fix removes measured avoidable work; it is not the whole terminal latency goal.

## Checks and reproduction

`tests/execute-row-render-performance.test.ts` is new. It compares the previous expanded rendering pipeline to the new one for ASCII, ANSI/OSC/control normalization, CJK, emoji/ZWJ, combining/Indic/Thai/halfwidth clusters, empty/newline text, widths 0/1/2/3/12/48/100 and warnings. Functional work-count assertion: fitting Unicode expanded rows invoke **zero** native truncations (previously one per row); narrow overflow still invokes clipping. Separate checks cover cache reuse, partial/fresh final replacements, collapsed error and warning text. No hardware latency gate.

Commands from repo root:

```sh
bun install --frozen-lockfile
bun run prepare:assets
bunx tsc --noEmit
bun --cpu-prof --cpu-prof-dir=artifacts/terminal-perf/render-worker --cpu-prof-name=before.cpuprofile scripts/terminal-perf/tool-event-workloads.ts '{"shape":"unicode","historyTurns":8,"burstCount":4,"argsBytes":65536,"finalBytes":65536}' > artifacts/terminal-perf/render-worker/before-unicode.json
# probe.ts records native-shell/registered-component costs; matrix.ts swaps the
# retained original and changed preview serially, restoring changed source finally.
bun artifacts/terminal-perf/render-worker/probe.ts '{"shape":"unicode","historyTurns":8,"burstCount":4,"argsBytes":65536,"finalBytes":65536}' artifacts/terminal-perf/render-worker/probe.json
bun artifacts/terminal-perf/render-worker/instrument-preview.ts # baseline function costs, restored in finally
bun artifacts/terminal-perf/render-worker/matrix.ts
bun test tests/execute-row-render-performance.test.ts tests/execution-previews.test.ts tests/settled-execute-render.test.ts tests/terminal-perf-tool-events.test.ts
bun run build
bun test tests/execution-previews-tui.test.ts tests/long-thread-tui.test.ts tests/sdk-large-text-tui.test.ts
```

Focused combined check: 49 tests / 13654 assertions pass. Build and actual compiled PTY acceptance: 3 tests / 1111 assertions pass, covering narrow error/details, regular-mode preview, long-thread collapse/expand/resize/reopen, and complete megabyte rich text/edit/scroll. These test the compiled production wrapper stack, but are not timings for full production stream events. Afterward freshly removed this worktree's node_modules, frozen reinstalled, generated assets, reran TypeScript and the new focused tests (log retained). The strengthened final focused check passes 3 tests / 12170 assertions; TypeScript and diff checks pass. Fresh-installed SDK seam hashes match the measured files. No provider credentials/network required. Shell emits an unrelated mise-untrusted-config warning but Bun checks execute successfully.

## Raw pickup

Worktree: `/home/tnfssc/.bruv/worktrees/t3code-bbf9268f-5442693331ce-task_90e3737a`. Ignored raw files live in `artifacts/terminal-perf/render-worker/`; copy this directory separately when integrating. `summary.json` contains exact per-frame/input timing summaries, counts, row-equivalence decisions, environment, and a SHA256/size manifest of raw profiles/probes/before-after JSON and logs. Its SHA256 is `6efec6a776bca46b17e4658fab2fb51f238b777a1da7abd1b48ab4663edeeedb`. Raw before/after files are named `{before,after}-{unicode-1,unicode-2,error,structured,ascii,ansi,newline}-matched.json`. Additional preliminary samples are explicitly not substituted for the matched table. Compiled PTY screens remain in this worktree's `artifacts/tui/` directories.

Environment: {"bun":"1.4.2","platform":"linux","release":"7.0.3-1-cachyos","arch":"x64","cpu":"AMD Ryzen 9 7940HS w/ Radeon 780M Graphics"}.

Next pickup: join this small renderer change, retain raw files, rerun the parent-owned integrated serial latency comparison. If the remaining cold frame is still dominant, investigate native wrapping/width or retained-layout architecture with SDK owner rather than adding a hidden output cap or claiming coalescing solved full synchronous layout. Values unchanged: existing measured-path, visible behavior, honest boundary and durable evidence principles already cover this result.
