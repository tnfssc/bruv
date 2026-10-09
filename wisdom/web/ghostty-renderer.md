# Ghostty workspace renderer

2026-10-09. Branch: bruv/web-ghostty-renderer.
Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_72bfd83e.
Base: 584279033618ff599626e1b3872975ee15d52841.
Parent owns publication and consolidation into the one PR64 review target.
No push, PR, merge, CLI install or finished-tree edits here.

## Decision

Reuse the site's pinned ghostty-web 0.4.0. No version change or lasting dual-renderer layer. Replace Terminal/FitAddon, not the workspace product. Keep server-owned PTY geometry, sockets, replay/gap safety, local navigation and selection, shared I/O, input ownership, command-driven /live, microphone ownership, rename/draft/focus and compact daisyUI chrome. No site scripted input path or native chat replacement.

Read values and the browser terminal/font/touch, multiplayer/replay, Vesper and spacing notes first. Read the actual compatibility report in task_f9bced5d, its ignored probe and evidence, and inspected painted desktop/phone captures. That real raw-mode Bun.Terminal PTY and two-renderer spike was not full Bruv CLI acceptance. The checks below run the compiled CLI too.

## Renderer boundaries

Load the existing Nerd Mono face before opening any pane. Load one Ghostty instance per page from /ghostty-vt.wasm. FitAddon.proposeDimensions measures available space; only server size messages resize the terminal. No fit/observeResize call or resize reply loop. Font and Vesper bytes/options stay the same.

Ghostty makes its host editable and changes its role. An inner .terminal-renderer keeps the outer tabpanel intact. Accessible output is its sibling, not a child of the editable textbox. Ghostty has no screenReaderMode; no fake option is assigned.

The active pane exposes one visually hidden current viewport read from real WASM cells. It follows scroll position, alternate screen, overwritten cells, wide/grapheme cells and invisible flags. Writes, resize and scroll refresh it; 0.4.0 declares onRender but never fires it. Refreshes coalesce per frame. Inactive/background panes clear and hide this text. No visible transcript or duplicate output history.

Touch owns a gesture from visible start through end. Hide, document hide and dispose cancel it. Capture blocks Ghostty's unconditional touchend focus; only a fresh tap focuses. Swipes accumulate measured row fractions, use normal scrollLines or alternate line-mode wheel input, and discard fractions on cancel. All four adapter listeners are removed on disposal.

## Pinned package patch

Bun patchedDependencies applies patches/ghostty-web@0.4.0.patch to both published ESM/CJS entries and types. Patch SHA-256: e29bfb5d8127eeff987c78a5e7c72ee82884a3e65ee424e22d245f49f6b814eb. The exact patch path has -whitespace in .gitattributes: its blank diff context and upstream CRLF declarations must stay intact for replay. No global event hooks in production. The parser, canvas renderer and WASM stay upstream.

- Remove host beforeinput, captured wheel and document mousedown/mouseup leaks, including failed open and disposal ordering.
- Remove delayed refocus. It stole the inline rename field after double-click. Focus stays synchronous.
- Explicit blur clears pressed buttons and wheel fractions even when an outside control already owns DOM focus. It does not invent a focus-out report. Hide blurs before hiding.
- Add actual mode-aware mouse input. Pi 1.1.0 defaults to fullscreen and enables SGR tracking; stock Ghostty sent arrows instead of scrolling that CLI. Modes 9/1000/1002/1003, SGR 1006, wheel and pane focus 1004 now work. Shift/no mouse mode keeps local selection. Disabled stdin stays gated.
- Legacy raw mouse bytes use a typed, disposable onBinary event and the existing base64 socket branch. SGR stays on onData. A real raw-mode Bun PTY receives 1b5b4d2080ff exactly, not UTF-8 replacement bytes.
- Accumulate small alternate wheel deltas against real glyph height. A reviewer reproduced twenty 10px moves producing no input in stock 0.4.0. Measured row input and cancellation now have regressions.

Unsupported mouse encodings: UTF-8 1005, urxvt 1015 and pixel-SGR 1016. They emit nothing, not an arrow fallback. Legacy coordinates cap at 223. DOM mouse buttons 0–2 are covered; extended buttons, pen mapping and window-only focus changes are not. Finger tap/swipe is handled separately by the pane adapter.

## Embedded assets

Same-origin GET-only /ghostty-vt.wasm sits under the existing exact Host guard, with application/wasm, no-store and nosniff. CSP adds only wasm-unsafe-eval, never unsafe-eval. No runtime CDN.

The package has only bundled ESM/CJS entries; both include a default base64 WASM payload. The patch removes it and requires explicit load/init paths, including types. Its text diff is large because upstream's minified UMD and embedded-WASM lines are large, not because a second VT implementation was added.

WASM: 423,045 bytes; SHA-256 d6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a. Final browser JS: 108,490 bytes. Compiled binary: 94,336,480 bytes; SHA-256 bec3a69c84d97fcb06a2346710ac64cf711e75d0364e264ab167afaf05c8bf54. Receipt: artifacts/ghostty/packaging.json. One complete raw WASM copy, zero base64 copies. Source-free runtime cwd, PATH=/nonexistent: GET 200, HEAD 405, wrong Host 403, compileStreaming succeeds. This asset check alone is not CLI acceptance.

Notices preserve Coder, Ghostty, uucode/Unicode, Zig and upstream width-reference attribution. The review and pinned source revisions are in licenses/third-party/ghostty-web/README.md. The exact upstream WASM compiler version is unrecorded; no upstream rebuild claim. Notice generation: 213 production packages, 749,888 bytes. Packaging fixtures include the WASM and notice inputs.

## Checks

Use TMPDIR=/var/tmp: /tmp is full. Final functional runs are headless Linux Chromium.

export TMPDIR=/var/tmp HEADLESS=1
export PLAYWRIGHT_CORE=/home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs
export CHROMIUM_BIN=/home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome

- bun run check; bun run build: pass.
- TMPDIR=/var/tmp bun test tests/web tests/dependencies/ghostty-web-patch.test.ts tests/packaging/prepare-assets.test.ts tests/packaging/generate-third-party-notices.test.ts tests/release/release-workflows.test.ts: 157 pass, 1,307 assertions, 16 files.
- Root bun install --frozen-lockfile: pass. Fresh minimal install and frozen replay of the final patch: 26 pass / 106 assertions across ESM/CJS, real WASM with isolated fake DOM. Fixture: .tmp/ghostty-final-replay/. It matches installed patched bytes.
- bun run generate:notices; bun scripts/web/browser-assets-proof.mjs: pass.
- Changed-file biome format and biome lint, plus git diff --check: pass. Logs: .tmp/format-final.log and .tmp/lint-final.log. Lint reports 98 warnings and 209 infos, including control-byte fixtures; no zero-warning claim. biome check additionally reports import-order assists in old files; that is not the repo format/lint gate.

Browser commands (with the environment above):

for p in smoke font-smoke theme-smoke multiplayer-smoke workspaces-smoke workspace-design recovery-design ghostty-lifecycle ghostty-mouse; do
  bun scripts/web/browser-$p.mjs || exit
done
bun scripts/web/browser-audio-probe.ts

Ignored evidence: artifacts/ghostty/logs/*-final.log, font/measurements.json, cli-render.json, lifecycle/results.json, mouse/results.json and painted captures. The tracked browser-assets-proof.mjs writes the source-free receipt to artifacts/ghostty/packaging.json.

The compiled CLI paints desktop and phone output, accepts keys/paste/resize, shares one PTY across browsers, and keeps navigation local. The four-CLI workspace proof checks cwd/output isolation, shell work surviving switch/reload, close cleanup, microphone ownership and explicit /live mic-check. Rename, draft, double-tap, overflow, drawer, empty/error forms and focus assertions remain. Inspected the actual captures; blank failures are not acceptance evidence.

Glyphs M/i/0 and four Nerd icons measure 8.399963px at 14px. Ghostty uses measured 9×15 cells. Font fixture/server agreement: desktop 91×43, phone 39×41; no hard-coded old xterm counts. Theme proof checks all 16 ANSI colors and RGB. These specimens use real raw-mode PTYs; the separate CLI captures show Bruv itself.

The mouse proof uses a local no-provider command to create native CLI content. Real SGR wheel packets change its visible rows instead of editor history; click/release packets reach the same CLI. Lifecycle proof checks shared Unicode paste, late canceled touch with no input/focus steal, one active AX output region, cleared inactive output, disposed canvas/textarea/output DOM, document listeners back to baseline and reaped closed PID. A >2 MiB replay gap pauses the lost renderer while the same CLI finishes its work; another browser can still input.

AX proof includes StaticText containing the unique actual PTY draft browser PTY input, not just a folder name or unnamed canvas. Fake voice proof: 8 captures / 5,120 bytes, stop/reconnect, observer safety, owner retained, injected permission denial/provider failure retry, coding PID alive, zero provider calls. Backend voice code is unchanged. Fake devices/provider and injected denial are labeled, not audible speech.

Final independent review found no concrete blockers in the renderer, active output, touch lifecycle, mode-aware mouse/focus/disposal patch or WASM route. No files changed in that review. Earlier review findings (small wheel deltas, delayed rename focus and blur fractions) were fixed and covered before the final gate.

## Probe repairs and limits

Kept behavioral assertions. Canvas draw calls/pixels and bounded output state replace xterm DOM rows. Design focus checks now target Ghostty's actual editable host inside the active panel, not the old textarea tag. Home queues a reveal; its paint settles before a later manual-scroll assertion. Wide renamed tabs are scrolled into view before close, not forced through hidden actions.

Websocket ready is not native CLI input ready. Pi draws before managed-tool setup installs submit. The labeled voice fixture emits an ignored OSC from session_start, after that handler is installed; probes wait for that real PTY marker. No production ready protocol changed. Shell macros no longer send unnecessary Escape before Enter; Pi can combine those raw keys into Alt+Enter. Other macros separate the keys. The first mouse fixture also had a quoting error and skipped the fixture trust dialog; final proof fixes both, trusts only its owned fixture for this session, and waits for its actual draft. One early combined source run had a CLI startup timeout; it passed alone and the complete final gate passed.

No physical phone/IME, Safari/iOS, physical microphone, audible speech, paid-provider, or real screen-reader UX claim. Accessibility is current viewport only with polite atomic updates. Live announcements, cursor/editing and NVDA/VoiceOver use still need human review. No full repository suite or hosted CI here; parent validates the published PR64 head.

Values unchanged. Real-path proof, clear ownership, bounded use, work preservation and honest limits already cover this change. The pinned API/packaging recipe belongs here, not in a new general rule.
