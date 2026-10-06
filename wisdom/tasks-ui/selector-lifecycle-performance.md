# Selector lifecycle performance (pinned coding-agent 1.0.3)

## Ownership and result

This change owns the coding-agent patch, an isolated production count helper, its CLI installation, independent local behavior tests and retained probe evidence, and this note/evidence. It does not change pi-tui, the shared navigation/action/render harness, shared fixtures/tests, dependencies, or shared notes. The parent combines the pi-tui large-text work separately.

Useful reductions, **not a complete frame-budget fix**:

- TreeList built full-tree visual geometry, then immediately rebuilt visible geometry. It also reconstructed entry lookup maps for the active path, selection, and filtering. The patch builds one entry projection/active ancestor path, orders active branches from that path, computes geometry only for the filtered view, and reuses entry/visible lookups. All work still completes synchronously before the selector action returns.
- renderInitialMessages replayed every full journal body through getEntries merely to count compactions. New SDK getEntryCountByType(type) preserves the existing total getEntryCount() API. Bruv's isolated installSelectorLifecycle hook answers typed counts from the owned disk index; native/in-memory managers retain the native body-backed fallback. Counting includes inactive-branch compactions, just as the original notice did.
- Maps belong to one selector snapshot and disappear with its component. No session-wide object cache, history truncation, serialization change, deferred building, timer-based chunking, or shifting projection CPU to the next frame. Search, label edits, collapse/expand, active-branch ordering, nearest-visible-ancestor selection, accept/cancel and visible geometry remain unchanged.

## Evidence and boundaries

Read [values](../values.md), [interaction lab](terminal-interaction-lab.md), [navigation probes](navigation-main-thread-probes.md), and [action profiler](terminal-action-profiler.md). Parent baseline raw spans are under /home/tnfssc/.t3/worktrees/bruv/t3code-bbf9268f/artifacts/terminal-perf/navigation-worker-baseline/navigation/2589aac8/compiled-interactive-1000.json: showTreeSelector 24.093ms, following doRender 6.276ms. Other evidence locations and limitations are in navigation-main-thread-probes.md.

The historical `scripts/terminal-perf/selector-lifecycle-probe.ts` at combined source `134f7bcd` (not extracted into this production layer) imports the unchanged integrated runOfflineNavigationSdkProbe. It measures getTree, flattenTree, active-path, filtering/geometry/selection, body replay, typed count, and UI rebuild phases. A real initialized InteractiveMode resumes disk history, opens a real selector at a999, and sends Enter through its TreeList.handleInput -> actual constructor onSelect callback. Only the probe skips the summary prompt; production summary behavior is unchanged. This actually chooses another leaf and rebuilds all 2,000 messages. It is not just an SDK navigateTree call or a synthetic replacement UI.

Input dispatch and individual synchronous methods are wall-clock CPU-work observations, including instrumentation/scheduling effects. Nested spans overlap; do not add them. observedPeakSyncMs is the longest **observed** synchronous action/API prefix/method span, not complete async continuation CPU. This metric excludes frame durations: evidence additionally records post-init frame maxima and the maximum of action/frame CPU samples. Initial/cold frames are separate. Awaited lifecycle elapsed includes waits and is not CPU. The augmented resume elapsed also includes the extra choose flow and two explicit 40ms capture drains, so it is not comparable to the unmodified harness's resume elapsed.

The chosen frame is a real doRender span. Only **after** its capture, a separate verification render hashes the full chat output; that verification is excluded from lifecycle/frame CPU. Provider and fetch guards from the integrated probe remain active throughout choose; all eight final runs report providerCalls=0 and fetchCalls=0. No Bruv extension startup, PTY, clipboard/provider integration, terminal paint, or comprehensive async-continuation CPU coverage is claimed.

### Final pinned serial samples

[Committed evidence](evidence/selector-lifecycle/pinned-evidence.json) contains exact action/method spans, frame samples, hashes, fingerprints and absolute raw artifact locations. Only pinned-* runs are final evidence. Earlier exploratory artifacts include discarded count-API experiments and must not be presented as acceptance.

Three compiled before/after pairs ran sequentially, never concurrently. Each process has fresh runtime/session creation; deterministic history creation is outside measurement. Process cold/init spans and disk open/context spans remain separately identifiable, not folded into selector latency. Single source runs are also retained.

Compiled medians (ms; only three noisy samples, not a universal speedup estimate):

| Observation | Before | After |
| --- | ---: | ---: |
| showTreeSelector synchronous dispatch | 13.809 | 8.327 |
| subsequent selector frame | 5.712 | 3.141 |
| resume renderInitialMessages | 12.393 | 5.721 |
| actual accepted-choice renderInitialMessages | 13.655 | 6.112 |
| fork renderInitialMessages | 12.740 | 6.448 |
| actual Enter synchronous prefix | 21.902 | 13.940 |
| largest observed synchronous action/span | 35.153 | 15.561 |
| actual accepted-choice frame | 45.173 | 30.445 |

Source singleton selector dispatch: 14.166 -> 8.869ms; resume rebuild: 16.743 -> 5.794ms.

**Do not attribute all wall improvements to this patch.** Unchanged getTree disk/materialization phases vary markedly (compiled before 4.490–9.941ms, after 4.593–4.804ms); host load changes throughput. Earlier serial exploratory runs also had post-patch action peaks around 34ms. In the comparable-throughput second pinned pair, getTree is 4.490 -> 4.804ms, while selector dispatch is 9.275 -> 8.327ms. Its non-nested projection phases are 4.371 -> 3.072ms, and selection lookup is 0.471 -> 0.004ms. Removed traversals/maps and the metadata count are the causal, reproducible findings; not every apparent disk or frame speedup is causal.

Counting during a rebuild changes from another complete body replay to a metadata scan (post-patch per-rebuild counts 0.044–0.144ms in that pair). Existing footer/cache-notice reads outside this count still appear as getEntries spans and are not hidden.

### Equivalence and remaining blockers

All eight pinned runs retain identical history contentHash, final 2,000-message contextHash (353e081494a86c0af10bd7847ef8eeb165c6b748c1b9237c011d3920e734095e), and full accepted-chat output hash (bc04ff2783433cdbd1e9f1b5e2aa6016aba5533617a2d90048adf2a4110e6ead). Accepted leaf is a999 and chat child count is unchanged. Raw app screen/output hashes contain temporary cwd/session paths and are not claimed identical.

The focused original-versus-patched selector comparison matches 14 state snapshots including 80/20-column visible output and every node's geometry; golden SHA-256 is 285c955d33fdedc527cc7faccd560f1bc630fc097a7049161806197b4aeff685. It covers real registered branch fold/unfold keys, search/clear/empty results, all five filters, label edits, hidden ancestors/current tool-only leaf, accept and cancel. Count tests prove native total-count semantics, inactive-branch counts, append/reopen correctness, preservation of old bytes, and no getEntries body replay on the owned count path.

Remaining blockers: disk getTree materializes all nodes; navigate/resume/fork repeatedly materialize branch/context bodies and still have budget misses under load. Actual accepted-choice frames remain 27–34ms in final samples, independently over budget. No fix for those frames is claimed; the parent owns renderer work. A general mutable-object context cache was not added: the adapter deliberately reparses cached bytes to give defensive bodies, and sharing them across consumers would need mutation/lifetime proof, not optimistic caching.

## Reproduce / validate

- bun install --ignore-scripts --frozen-lockfile
- bun test scripts/terminal-perf/selector-lifecycle.test.ts tests/history-projection-parity.test.ts tests/history-storage-lifecycle.test.ts tests/history-sdk-099.test.ts

The historical timing probe depends on the first-layer navigation harness. To reproduce after stacking, restore `scripts/terminal-perf/selector-lifecycle-probe.ts` from `134f7bcd`, then run it with argument `1000` or compile it as described in the first-layer navigation guide. It is not required by the production regression tests. The retained [pinned evidence](evidence/selector-lifecycle/pinned-evidence.json) remains the source timing record.

Baseline: registry @earendil-works/pi-coding-agent 1.0.3 plus the pre-task coding-agent patch from parent commit 2daa123b; helper is disabled automatically if getEntryCountByType is absent. Build separate before/after binaries with exactly the same probe, then run sequential pairs. Do not run long timing matrices concurrently.

Frozen installation was essential: initial node_modules contained an unrecorded buildSessionInfo stream-cleanup edit. A patch made against that shadow source landed at wrong line offsets when Bun reinstalled the registry package. The final patch was regenerated against the exact registry tarball, passes git apply --check there, survives frozen install byte-for-byte, and intentionally excludes that unrelated stream edit. It preserves the existing initial-message grammar patch.

Validation: frozen install succeeds without package.json/bun.lock edits; six tests / 47 assertions pass (three new focused tests plus three existing history regressions). Full tsc after the clean frozen install is blocked by four **unowned** existing onUserMessageCreated declaration errors in scripts/terminal-perf/send-workloads.ts and src/claude-compat/runtime.ts. Initial node_modules also had an unrecorded AgentSession callback hook; final pinned agent declarations do not contain it. The parent must make that hook reproducible in its separately owned patch, not rely on shadow node_modules. No related file was edited here.

## Wisdom / values

New local feature note/evidence only. Shared values are unchanged: existing measured-proof, honest-boundary, data-loss protection and useful-isolated-work guidance already applies.

## Stacked extraction setup

The SDK count addition changes session-manager.js. This layer preserves the coherent original/adapted digest pair in scripts/pi-host-adaptation.ts; no unrelated host adaptation changes. Frozen install must be followed by prepare:assets before check/build. See [stacked pickup](terminal-optimization-stack-pickup.md) for current extraction checks and clean-cache setup, rather than the historical worker validation above.

The production-owned files under scripts/terminal-perf are selector-lifecycle.test.ts and selector-lifecycle-behavior.ts; keep both in the second PR, not the measurement PR.
