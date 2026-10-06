# Pi editor paste preprocessing

## Observed seam

The real Pi 1.0.3 `Editor.handlePaste` path decodes CSI-u Ctrl sequences, normalizes CRLF/CR and tabs, then cleaned content with `split("").filter(...).join("")`. That creates a one-element-per-UTF-16-code-unit array, then split the cleaned paste again into a line array solely to count lines; the array also supported a single-line branch whose insertion body matched the multiline branch. The large paste still must be retained for marker expansion and submission.

The pinned patch `patches/@earendil-works%2Fpi-tui@1.0.3.patch` replaces only those redundant operations: a regex removes exactly C0 code units 0x00–0x1f except LF (same code-unit acceptance as before), and a linear LF count provides the exact line count without per-character/per-line arrays. Normalization, CSI-u decoding, path spacing, marker threshold/label, paste map, insertion/undo and marker expansion remain on their original path. The unrelated frame-local ScrollView/layout hunks in this Pi TUI patch were preserved.

## Evidence

Matched command: `bun scripts/terminal-perf/send-workloads.ts normal 1000 1048576 bruv-disk > run.json`. Before measurements recorded for the real fixture had `editor.handlePaste` at 42.11–66.16 ms; after the patch a fresh run measured 3.32 ms in `editor.handlePaste` and 5.26 ms total paste dispatch (Enter dispatch 1.84 ms). The patch targets this pre-render preprocessing only.

That same final run submitted/journaled 1,048,591 UTF-8 bytes; provider message SHA-256 `420d70c00743532c68332fa17a7141a180789ca50928e02e8dddcaa4cf393b3c`, history SHA-256 `8365f2dc320374eb28a9624196756eda5388612ba0249665c6428e651f4e713a`, journal growth 1,091,486 bytes. Screen SHA-256 `5e1b6cabf301bed369733b3ffb1d450f5298ff55d82a966bd37775c2b644b496`; output SHA-256 `9908f9e077946834ae00f1f214d6617a3567b9b44573dae499104c5c4f784005` (4,160 bytes).

Do not mistake paste CPU for the remaining first-frame work: `tui.doRender` was 1,065.83 ms and the controlled 10 ms provider timer had 1,056.23 ms callback lateness with 1,065.83 ms observed synchronous overlap; network wait was 0 ms. Large-message frame/rendering remains a separate problem and is not fixed by this patch. The workload JSON records all timings and fingerprints; capture to a file because it includes full content/screen evidence.

## Checks

- `bun install --frozen-lockfile` (patch applies at pinned Pi 1.0.3)
- `bun test tests/editor.test.ts` (8 tests, including control/newline/tab/Unicode acceptance and large marker content + undo)
- `bun run check`
- `bun run build`
- `bun scripts/terminal-perf/send-workloads.ts normal 1000 1048576 bruv-disk > run.json`

Values unchanged: this is a local performance recipe/evidence note; it does not establish a new general value.
