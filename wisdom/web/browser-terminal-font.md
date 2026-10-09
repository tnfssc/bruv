# Embedded browser terminal font

## Choice and source

One regular JetBrainsMono Nerd Font Mono face. Official Nerd Fonts 3.5.1
release, JetBrains Mono 2.304. The full text and icon font remains intact:
12,226 mapped code points, fixed-pitch flag set, all nonzero advances 600 units.
WOFF2 is **1,083,072 bytes**. SHA-256:
2b777374f6ba42c46919fb5f8bb1f607ccff116bf54d44c7a453ebeb70b794a8.

Source URL, archive/TTF hashes and the pinned conversion recipe are in
licenses/third-party/jetbrains-mono-nerd-font/README.md. The font is OFL-1.1;
JetBrains copyright 2020, Nerd Fonts copyright 2014 Ryan L McIntyre.
The complete OFL, Nerd Fonts root license and icon notices are retained there
and copied into release THIRD_PARTY_LICENSES.txt by the notice generator.
Font Logos' upstream 1.3.0 LICENSE is Unlicense, despite Nerd Fonts' stale
“unlicensed” label. Brand glyphs do not grant trademark rights.

## Integration

Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_1a389c2a
Branch: bruv/web-nerd-font. Base: c3cfb741 (approved workspace design).

src/web/fonts/ holds only the regular WOFF2. scripts/build/web-assets.ts copies
bytes to dist/runtime-assets/web/; assets.ts imports them with Bun type:file.
No build or runtime downloads. No base64 font text or new package dependency.
terminal-font.css declares the same-origin face; it is appended to built CSS.
xterm uses it with ui-monospace/monospace fallbacks. Startup loads the face
before opening any terminal. A failed load logs a warning and starts fallback.

The public /fonts/JetBrainsMonoNerdFontMono-Regular.woff2 route matches existing
static routes: no terminal token needed, exact Host check, GET only, no-store,
nosniff, font/woff2. CSP already allows only same-origin fonts and is unchanged.
No palette or xterm theme edits. No other agent worktrees touched.

Linux x64 Bun 1.4.2 compiled bruv: 93,971,936 bytes, versus 92,886,496 for the
base commit using the same installed dependencies/runtime assets. Delta:
**+1,085,440 bytes**. The tiny connector launcher does not embed a second font.

## Evidence and limits

- bun run check and bun run build: passed.
- Focused tests: 64 passed, 0 failed, 756 assertions. tests/web,
  tests/release/release-workflows.test.ts and both t3 web launcher test files.
- generate:notices: 213 packages, 726,893 bytes, including font/icon notices.
- browser-font-smoke.mjs: passed in Chromium at 1100×720 and 390×680.
  A compiled fixture ran from a source-free temporary cwd, with real Bun PTYs.
  Exact served font hash/MIME/CSP checked. A held font response proved no xterm
  opened before font readiness. One font request per page. Text M/i/0 and four
  Nerd icons measured 8.399963px at 14px. xterm cell geometry matched within
  0.02px; PTY and browser agreed on 101×36 desktop and 43×34 phone. Keyboard
  input and a later unchanged resize passed. No page errors or page overflow.
- Existing browser-smoke.mjs: passed with the actual compiled bruv TUI and
  strict CSP, keyboard input and fake-microphone relay. No provider calls.
- Opened and inspected final desktop/phone font specimens and compiled CLI
  screenshots. Folder, terminal, gear and Powerline icons rendered, not tofu;
  regular columns aligned. These are font proofs, not theme acceptance.

Ignored evidence is under this worktree's artifacts/font/: desktop.png,
phone.png, measurements.json and logs. Actual compiled CLI frames are
artifacts/web-terminal-wide.png and web-terminal-narrow.png.
No Safari/iOS/physical phone claim. No paid providers or full repo suite.

The browser proof initially sampled an early fit while the connecting status
still occupied height. It now waits for connected layout before comparing the
PTY and DOM; the font response hold separately checks the font-measurement gate.

Expected parent integration overlap: browser.ts fontFamily beside the theme
agent's xterm options, plus its final startup block beside microphone wiring;
tests/web/browser.test.ts mock now awaits font loading. Retain both agents'
changes. browser.css and browser-audio.ts were not edited. Values unchanged:
existing shipped-path and visual-proof values cover this work.
