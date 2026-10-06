# Terminal text wrapping: less repeated layout work

## Scope and evidence

Follow-up to [large-text block rendering](sdk-large-text-block-render-fix.md), [painted activity anchors](activity-anchor-painted-geometry.md), [tool mutation probes](tool-interaction-mutation-probes.md), and [send workloads](terminal-send-workloads.md). Read values before making changes. The integrated block-regex fix removes the ~1 s stall; it does not make complete megabyte-message layout cheap.

Reviewed the parent's full `large-text-worker/{send-final-before-1,send-final-after-1,tool-final-before,tool-final-after}.json`, `tool-wrap-trace.json` and `final-call-trace.json`. The latter attributes 118.24 ms to Markdown.render / 126.17 ms to doRender; tool reveal recorded 421 segment calls, 98,576 input code units and 73,961 grapheme yields. Source inspection confirms Pi **already** fast-paths printable ASCII in tokenization and ordinary width calculation. The remaining long-word helper still builds an object per grapheme, and a Unicode line's wrap-fit check measures the entire line before tokenizing it again.

Owned changes: only `pi-tui/dist/utils.js` patch hunks, focused SDK tests, and this feature-local note/evidence. No coding-agent, scanner, editor, ScrollView, shared fixtures/harness or shared-note changes.

## Patch

- Printable ASCII classification uses a bounded native character-class scan. Pure ASCII width is its code-unit length; tabs/ANSI/control/Unicode keep the existing width path.
- A wrap-fit width measurement stops once it exceeds the width. Partial measurements are **never cached**. The exported visibleWidth still measures the complete string.
- Long-word wrapping consumes non-ANSI grapheme spans as a stream instead of retaining a second array. Printable ASCII spans copy line-sized slices, preserving tracker state, underline resets and OSC-8 close/reopen behavior. A single plain ASCII word bypasses character-by-character token assembly.
- Unicode spans retain Intl.Segmenter, Pi's width calculation and exact original wrap boundaries. The printable-only shortcut cannot split combining sequences, emoji or wide graphemes. ANSI recognition, rich rendering, full content/history and cache ownership are unchanged. This removes work from the same synchronous layout call; nothing was moved ahead of doRender or deferred to a later callback.

## Measurements (informational, shared machine)

Bun 1.4.2 / Linux x64, AMD Ryzen 9 7940HS. Small **sequential** samples, not a clean budget run or timing gates. End-to-end probes use real SDK objects, 1000 history rows/turns, actual generic structured-argument and registered execute renderers, production disk send, and the same payloads before/after. Mutation, action dispatch and doRender are separate; do not add inclusive intervals together.

Final unprofiled matched pair (ms):

| case | cold setup mutation before→after | cold frame before→after | reveal mutation before→after | reveal frame before→after |
|---|---:|---:|---:|---:|
| Unicode single line | 18.97→21.46 | 25.20→28.99 | 26.63→29.09 | 5.89→7.27 |
| SDK generic JSON args | 13.60→12.86 | 11.96→12.56 | 3.21→3.59 | 6.94→7.75 |
| ANSI | 7.86→10.43 | 9.52→10.20 | 12.39→13.29 | 5.98→5.89 |
| short | 10.70→13.99 | 7.15→11.81 | 1.99→1.64 | 10.63→5.80 |

Large send: paste dispatch 5.39→6.16; Enter dispatch 1.48→1.20; doRender 96.19→90.02. Both acknowledged the complete 1,048,590-character submitted message; payload, history, output and work hashes match. Raw acknowledgment screen hashes differ **only** in the fixture's random temporary cwd footer. All 40 tool-stage screen/output/document/work hashes match exactly.

An earlier profiled-before / unprofiled-after sample had Unicode reveal 28.72→22.97 ms, but the final unprofiled pair above did **not** show an end-to-end tool speedup. Do not substitute the favorable sample for this mixed result. Parent must rerun the authoritative suite after the separately owned selector/scanner pieces are joined.

Stable work evidence: real Unicode single-line reveal drops 73,961→49,440 yields (24,521 fewer); ANSI remains 49,667, short remains 76, structured args remains zero. Focused actual SDK Text rendering of 32 KiB ASCII drops at least 32,768 yields to **zero**. This is avoided CPU work, not hidden/truncated output or a stall shifted to mutation.

Direct SDK cold/cache/resize comparison also retains complete identical line hashes. A 1 MiB plain ASCII word rendered through the actual Text component takes 192.20/158.27 ms before vs 6.45/4.75 ms after; width-46 rebuild 182.23/165.34 vs 8.72/7.90 ms. Cached tails stay ~0.001–0.006 ms. The first Unicode-line layout is 18.82→6.98 ms; subsequent new components share the utility width cache, so their “cold component” times are **not cold utility** evidence. A 1 MiB many-short-lines Markdown comparison is mixed (77.16/46.14 before vs 58.08/49.66 after), not proof of a send budget win. Generic pretty-JSON Text layout is ~0.5–1.3 ms in later samples; it is not the remaining 80–149 ms send bottleneck. SDK generic formatting still serializes structured arguments synchronously; coding-agent changes are another owner's scope.

CPU sampling of the direct SDK comparison finds original breakLongWord at 212 self samples and original ASCII width scans at 33+17+15+14 samples. After the grapheme-array fix, ASCII token assembly remains at 42 samples; the single-word bypass removes that assembly too. Sampling is attribution, not exact milliseconds. Remaining many-line send work still includes full Markdown parsing/inline rendering, padding and complete line construction. This patch does not solve that architectural cold-layout cost; scanner review and selector work remain separate. Retained block/layout reuse may be the next measured investigation, not content truncation or discarding old history.

## Reproduce and check

Never overwrite shared hardlinked installed files in place. Experiments used private temporary files followed by atomic rename. Final verification unlinked only this worktree's node_modules and freshly applied the checked-in Bun patch:

```sh
rm -rf node_modules
bun install --frozen-lockfile
bun run prepare:assets  # generates prompt hooks; required before tsc
bunx tsc --noEmit
bun test tests/sdk-text-wrap-performance.test.ts tests/sdk-markdown-blocks.test.ts \
  tests/terminal-perf-tools.test.ts tests/terminal-perf-send.test.ts
bun run build
bun test tests/long-thread-tui.test.ts tests/sdk-large-text-tui.test.ts
```

Final clean reinstall, assets, TypeScript and paired build passed. Focused SDK/probe suite: **33 tests / 60,989 assertions**. Compiled acceptance: **2 tests / 1,053 assertions**. The real built CLI checks 100 saved turns / 1000 tools, history navigation, draft echo, detail reveal/collapse, resize and **regular screen** details; the large-message case checks a complete megabyte message, oldest/end navigation, rich bold style, width-46 rendering, editor input and full saved content. Captured screens show actual tool code/results and the large-message start/end, not just “frame happened.” These are correctness acceptance tests, not input-echo latency measurements.

The new focused test reverses only the installed utility patch into a private temporary reference module. It compares actual SDK Text/Markdown cold output, cached tails, invalidation and resize, plus utility outputs for ANSI/OSC/APC, invalid escapes, tabs, controls, Unicode marks/emoji/wide characters and deterministic mixed inputs. It gates output/work counts, never wall-clock budgets.

## Raw evidence

Full matched JSON bytes and reproduction scripts are archived in [terminal-text-wrap-performance-evidence.json.gz](terminal-text-wrap-performance-evidence.json.gz), a gzip-compressed JSON map of filename → original file text. Uncompressed bundle SHA256: `4e7587d463ab99dba1f078c452368de31fe71e33cca66e7973ff3a7a1ff07ca3`; compressed size 83,358 bytes. Includes final-before/final-after, complete grapheme-count records, direct SDK measurements, probe/benchmark scripts and the exact reference utility. The count-run full screen JSON and CPU profiles remain under `artifacts/terminal-perf/text-wrap-worker/` in this worktree; they are not timing samples. The archive retains all matched payload/screen/work fields, not just the favorable numbers.

Extract into `artifacts/terminal-perf/text-wrap-worker/`; run `bun artifacts/terminal-perf/text-wrap-worker/sdk-bench.ts` for the SDK comparison, or `bun artifacts/terminal-perf/text-wrap-worker/probe.ts <output.json> [--counts]` for current real action/mutation/frame evidence. Run counts separately from timing. Baseline action probes were taken in fresh processes with only utils.js atomically replaced by reference-utils.js, then restored to the patched bytes. Baseline utility hash `6c187576b9a2f29b156a0f6cf140fdf6617a5606203db2769760a32a01f3d595`; patched hash `6c239049e5b851f9e951a82abd1d5888228325d5907a0e11e8b0dea174ecb9b1`.
