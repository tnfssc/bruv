# Terminal scroll responsiveness / OpenTUI investigation

## Handoff

- Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_6d7369a4
- Branch: fix/terminal-site-scroll
- Persistent preview: http://127.0.0.1:45001/ (loopback, free port selected by Bun)
- Commit: see this note's Git commit; worktree only, no merge or deployment.

The visible site is still the real Ghostty Web 0.4.0/WASM terminal, Vesper cell text/controls and a raster-only cell-aligned image plane. No CSS imitation, DOM marketing replacement, backend, capture edits or copy rewrite. Semantic/no-JS HTML, metadata and local static assets remain.

## OpenTUI decision and sources

Research used **tvly CLI**, its help, two searches and extraction of current official runtime/pipeline/scrollbox docs, then inspected primary upstream code and published packages. [Full source/version report](opentui-sources/research.md), [tvly search](opentui-sources/tvly-browser.json), [port search](opentui-sources/tvly-wasm-port.json), [official docs extract](opentui-sources/tvly-docs.json), [bounded browser build failure](opentui-sources/browser-probe.txt).

Checked @opentui/core, @opentui/react and @opentui/solid **0.5.14**, upstream **de8dc97080e4c404d9018d9e6a485036aeaef7d2**. Core has retained renderables/Yoga layout/cell buffers and native diff/output. Zig builds a dynamic native library, called via bun:ffi or node:ffi; published exports choose native Bun/Node implementations, not a browser renderer. React's reconciler and Solid's universal renderer both target Core/CliRenderer, not DOM or browser canvas. Included grammar WASMs are not a renderer WASM.

Primary pinned code: [FFI](https://github.com/anomalyco/opentui/blob/de8dc97080e4c404d9018d9e6a485036aeaef7d2/packages/core/src/platform/ffi.ts), [native build](https://github.com/anomalyco/opentui/blob/de8dc97080e4c404d9018d9e6a485036aeaef7d2/packages/native/build.zig), [ScrollBox](https://github.com/anomalyco/opentui/blob/de8dc97080e4c404d9018d9e6a485036aeaef7d2/packages/core/src/renderables/ScrollBox.ts). Official [runtime requirements](https://opentui.com/docs/getting-started/runtime-support) and [pipeline](https://opentui.com/docs/core-concepts/rendering-pipeline).

A direct createCliRenderer import, installed at the pinned version in a throwaway probe, failed Bun's browser build on node:url/fileURLToPath and node:os exports. Parent independently repeated that build failure and inspected native linkage and fractional scroll accumulation. This establishes that the published entry is not a proven static-browser path, not that a future WASM port is impossible. A native producer streamed to a browser needs a backend; a full Zig/FFI port is speculative and outside this task. opentui-browser.dev runs a browser *inside native OpenTUI*; opentui.vercel.app labels itself an independent DOM experiment with WASM future work. Neither satisfies this website's contract.

**Keep Ghostty.** Transfer the useful ideas: fractional input accumulation, coalesced invalidation, dirty rows, shared committed geometry, and reuse of unchanged raster work. No new OpenTUI runtime dependency.

## Observed causes and changes

1. **Distance was discarded.** The old wheel handler did sign(deltaY) × 3, ignoring deltaMode and magnitude. In real Chromium, twelve 1px wheel events reached the bottom (32 rows). New input converts pixel/line/page deltas to physical distance and retains sub-cell remainder. Whole rows advance only when enough distance arrives. Direction reversal discards the old fractional remainder; bounds/navigation/resize clear it. Horizontal-only input does not move or consume vertical remainder.
2. **Two wheel owners.** Ghostty installs a capturing listener on the host *before* our old host listener. In 0.4.0, returning **true**, not false, from attachCustomWheelEventHandler suppresses its processing; it still preventDefaults first. The old false hook allowed alternate-screen arrow generation (no onData backend, so no second app scroll, but redundant handling). App wheel capture now runs on document, scoped to the terminal, before Ghostty. Normal wheel is non-passive/prevented exactly there. Ctrl-wheel bypasses both app scroll and Ghostty cancellation so browser pinch/zoom remains available. A failing browser assertion exposed the listener-order issue; the final fix is checked.
3. **Event-rate full writes.** Every wheel/touch/hover event rebuilt and wrote the whole screen, even at a bound. All invalidations now share one on-demand RAF, latest state only. No input queue or tween. Layout returns self-contained ANSI rows; only changed rows are written. Resize invalidates all rows and executes in the same commit.
4. **Separate text/image paints.** Verified shipped Ghostty writeInternal writes WASM *synchronously*; only its optional write callback is scheduled with RAF. Its normal canvas loop is a separate RAF. Previously the image plane moved immediately after the write, before the normal text paint. The app now explicitly calls the public renderer.render(wasmTerm, true) within its commit, before composing images and publishing geometry. Ghostty's own idle loop remains; we do not patch private scheduling. Paints, image clip and hits use the same frame.
5. **Repeated canvas allocation.** The image plane set width and height every event, clearing/reallocating backing storage. It now resizes only on actual dimension changes, resets the transform, clears/reuses storage, and skips unchanged placements/geometry (including hover-only frames). Images decode once before readiness; no repeated decode was found in scroll. No speculative image-cache layer was added.
A bounded sparse-canvas probe found a Ghostty row-join artifact: 16 differing pixels at the vertical image-border glyph joins (saved as probe-dirty-row-seam.png and probe-full-canvas-reference.png). Rather than fork Ghostty or tolerate broken joins, each changed application frame does one full **canvas** pass. ANSI input remains row-diffed and images remain cached/coalesced. Final browser checks require exact canvas parity with a forced reference paint. This trades a little canvas work for correctness without restoring event-rate work.

6. **Touch lost remainder.** Previously each accepted move truncated rows then replaced its origin, dropping the fractional tail. Touch now shares the distance accumulator, retains pointer capture, distinguishes swipe from tap, and uses the same coalesced commit. No artificial fling or inertia was added; reduced motion needs no separate animated path.

## Bounded evidence and checks

Saved evidence is separate from the existing hero/capture artifacts: [validation/scroll/](validation/scroll/). Chromium 153.0.8010.12 on Linux. probe-scroll.ts loads the real minified bundle and WASM; a test-only route hook instruments its Terminal instance (nothing shipped). Actual page.mouse.wheel and CDP touch input exercise Chromium input. A separately labelled dispatched 100-event burst models events arriving in one task. Samples, write times/bytes and selected screenshots during the wheel sequence are retained.

Baseline revision: 380add833b4644e1abdc749c90e8f60090bf3941. Final after evidence comes from the implementation in this commit.

Before/after, identical desktop 1440×960, 18px cells:

| Input/work | Before | After |
| --- | --- | --- |
| Twelve real 1px wheel events | 3,6,9,…32 rows | stays at row 0; 12px retained below one 18px cell |
| Four +24px, four −24px wheels | 3,6,9,12,9,6,3,0 | 1,2,3,5,4,3,2,0 |
| 100 × 1px same-task burst | 100 writes, 100 image draws, 200 backing-size assignments; row 32 | 1 write, 1 draw, 0 size assignments; row 5 |

Screenshots were inspected: baseline tiny input skips the headline/image almost entirely; updated small steps retain the headline and move the real image and its terminal border together. Motion frames show fixed header/footer clipping. This is bounded functional/per-frame evidence, not a cross-device FPS benchmark. Timing varies with screenshot overhead and host load; no latency percentile claim.

Commands (from site; this host uses installed /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun to avoid the untrusted mise shim; no trust config changed):

~~~sh
bun test scripts/build.test.ts scripts/scroll.test.ts
bun scripts/probe-scroll.ts   # builds, uses its own free loopback server, closes it
PORT=0 bun scripts/preview.ts # separate persistent review server above
~~~

Final checks: **7 unit tests passed, 1,435 expectations**; focused Chromium run passed with no page exceptions. Real touch moved 160px → 10 rows at DPR2, then a separate tap navigated. Pixel/line/page/horizontal/ctrl wheel behavior, Home/End/arrows, keyboard navigation, mouse install, route-preserving HTML escape, mobile/desktop live resize, reduced motion, no-JS and blocked-WASM fallback all passed. Terminal buffer text matches full layout; terminal canvas equals a forced full reference paint; image placements/pixels match the cell plane. Probe recorded **zero image-before-text paints** in the measured sequence.

Across the measured wheel sequence and burst, writes dropped **122 → 9**, image composites **122 → 9**, image backing-size assignments **244 → 0**. Total write-call time in these bounded runs was **40.4ms → 1.8ms** (parsing/write work, not end-to-end latency). Raw metrics’ bytes field records JS string length, not UTF-8 network bytes. Changed runtime/test paths pass strict TypeScript checking; formatting and git diff --check pass. No unrelated CLI tests or legacy full-browser matrix were rerun.

## Limits and values review

Scrolling stays cell-quantized (18px desktop / 16px narrow here), not subpixel DOM scrolling. Touch has direct drag but no added kinetic fling. Ghostty retains its own idle RAF; this task coalesces application work, not a fork of the library. Physical trackpads/phones and Safari/Firefox are untested. Canvas accessibility still uses the semantic HTML alternate; no new manual screen-reader audit. Existing static subpath/metadata/axe matrix is not repeated; changed scroll/render/resize/input paths receive focused proof. No agent backend was introduced.

Reviewed values 1 (requested mechanism), 2 (bounded honest proof), 3 (one wheel owner), 7 (simple solution), 8 (real interaction) and 10 (handoff). They already cover this lesson; values.md stays unchanged.
