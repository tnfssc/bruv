# Ghostty workspace renderer

Use the site's pinned ghostty-web 0.4.0 for the real CLI terminal, not the site's scripted input. Keep server-owned PTY geometry, replay gaps, local navigation and command-owned voice. See [ownership](browser-terminal.md) and the [operator guide](../../src/web/README.md).

## Pane lifecycle

Load the embedded Nerd Mono face before opening panes, then one Ghostty instance per page from `/ghostty-vt.wasm`. FitAddon proposes available dimensions; only server size messages resize the terminal. Do not add local fit/observeResize calls or a resize reply loop.

Ghostty makes its host editable. Keep an inner renderer so the outer tabpanel retains its role. Accessible output is a sibling, not a child of the editable textbox. There is no `screenReaderMode` option.

Only the active pane exposes a bounded, hidden current viewport read from real WASM cells. Follow scroll position, alternate screen, overwritten cells, wide/grapheme cells and invisible flags. Refresh on writes, resize and scroll, coalesced per frame: 0.4.0 declares onRender but does not fire it. Clear and hide inactive output. This is current cell state, not a chat transcript or another output history.

Touch belongs to the visible connected pane from start to end. Reject hidden/disconnected gestures. Hide, document hide and disposal cancel the gesture and row fractions; hide then show cannot revive it. Block Ghostty's unconditional touchend focus so only a fresh tap focuses. Normal-buffer swipes use scrollLines; alternate-buffer swipes use mode-aware wheel input. Remove all adapter listeners on disposal.

## Package patch

[patches/ghostty-web@0.4.0.patch](../../patches/ghostty-web@0.4.0.patch) patches the shipped ESM entry and its types through Bun's patchedDependencies. The exact path has `-whitespace` in [.gitattributes](../../.gitattributes): preserve blank diff context and upstream CRLF declarations for replay. Parser, canvas renderer and WASM remain upstream; no global production event hooks.

Bruv imports the ESM entry. The unused CommonJS distribution stays upstream; we do not maintain or test a second renderer fork. Compiled asset checks verify that the browser bundles the patched entry with no embedded default WASM.

The patch exists for these regressions:

- Remove host beforeinput, captured wheel and document mouse listener leaks, including failed open and disposal ordering.
- Remove delayed refocus that stole the inline rename field. Explicit blur clears pressed buttons and wheel fractions without inventing a focus-out report; hide blurs before hiding.
- Support modes 9/1000/1002/1003, SGR 1006 and pane focus 1004. The fullscreen CLI needs mouse packets, not editor-history arrows. Shift/no mouse mode keeps local selection; disabled stdin stays gated.
- Send legacy raw mouse bytes through typed, disposable onBinary and the existing base64 transport. SGR uses onData. Do not UTF-8 encode binary mouse bytes.
- Accumulate small alternate wheel deltas against measured glyph height; cancel fractions with the gesture. Small moves must not vanish merely because each is less than a row.
- Remove the bundled default base64 WASM and require explicit load/init paths. The diff is large because upstream bundles contain minified and embedded-WASM lines, not a spare VT implementation.

UTF-8 1005, urxvt 1015 and pixel-SGR 1016 mouse encodings emit nothing, not fallback arrows. Legacy events beyond cell 223 are dropped. A pending drag release uses its last reported cell; SGR retains full coordinates. DOM buttons 0–2 are covered; extended buttons, pen mapping and window-only focus changes are not.

Output writes emit protocol replies synchronously at this pin. The browser tags those batches with the output sequence; TerminalSession accepts each batch once. Replayed output can complete an unanswered query but cannot send a second answer. Human input follows a separate path. Check this boundary when updating Ghostty.

Native clipboard input goes through `Terminal.paste()`: 0.4.0's input-handler paste listener bypasses bracketed-paste mode. The browser captures that event before the handler. Human input is framed below the server byte limit without splitting surrogate pairs; binary mouse bytes stay binary. Normal-buffer swipes use wheel input when `hasMouseTracking()` is true, otherwise they scroll history.

## Assets and updates

[Build preparation](../../scripts/build/web-assets.ts) and [asset imports](../../src/web/assets.ts) embed JS, CSS, font and one raw WASM copy. No runtime CDN or font download. The GET-only WASM route has the exact Host guard, application/wasm, no-store and nosniff. CSP allows wasm-unsafe-eval, never unsafe-eval.

Keep [Ghostty/Unicode/Zig provenance and notices](../../licenses/third-party/ghostty-web/README.md) and [Nerd Font provenance, conversion and licenses](../../licenses/third-party/jetbrains-mono-nerd-font/README.md). Font/icon grants do not grant trademark rights. The published WASM's exact compiler version is unrecorded; do not claim a reproducible upstream rebuild.

When changing the pin or patch:

1. Update the package pin, lock and the ESM entry and types together. Review provenance and license inputs when the dependency changes.
2. Run `bun install --frozen-lockfile` and `bun test tests/dependencies/ghostty-web-patch.test.ts`. Check fresh patch replay, not only already-patched node_modules.
3. Run `bun run check`, `bun run build`, `bun run generate:notices` and `bun test tests/web tests/packaging/prepare-assets.test.ts tests/packaging/generate-third-party-notices.test.ts tests/release/release-workflows.test.ts`.
4. Check the compiled binary with the browser commands below. Compare real cells and inspected populated captures; asset hashes and canvas ink alone do not prove current CLI output. Historical draw calls can survive erasures.

```sh
export CHROMIUM_BIN=/path/to/chrome
export PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs
bun scripts/web/browser-assets-proof.mjs
bun scripts/web/browser-font-smoke.mjs
bun scripts/web/browser-theme-smoke.mjs
bun scripts/web/browser-ghostty-lifecycle.mjs
bun scripts/web/browser-ghostty-mouse.mjs
bun scripts/web/browser-recovery-design.mjs
```

Use the operator guide's compiled CLI, workspace, multiplayer and audio checks too. Keep mouse/focus/disposal, late canceled touch, same-PID replay gap, real-cell accessibility and voice handoff assertions. Browser fixtures must wait for actual CLI submit readiness, not just WebSocket ready. Send real keyboard input; filling an editable host does not prove PTY input. Keep Escape and Enter separate where the CLI could combine them as Alt+Enter.

Chromium accessibility-tree checks do not prove screen-reader use. Polite atomic viewport updates still need human review for announcements, cursor/editing and NVDA/VoiceOver. Physical phone/IME, Safari/iOS, microphone, audible speech and paid-provider use are separate acceptance. Fake devices/providers and phone emulation do not cover them.
