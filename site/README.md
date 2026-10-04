# Bruv landing page

One scrolling page rendered inside the actual Ghostty Web/WASM terminal, using Vesper for the site. Headings, links, three animated Bruv UI mockups and their controls are all character cells. No PNG/video/CSS overlay, agent backend or CDN.

## Run

Bun 1.4.2:

~~~sh
cd site
bun install --frozen-lockfile
bun run build
PORT=0 bun run preview
bun run test
bun scripts/animation.ts
~~~

Preview binds to loopback. BASE_URL configures the real deployment URL and path prefix for canonical/sitemap metadata; unset means no invented domain. Deploy the self-contained dist/ directory.

## Content and rendering

- content.ts: shared product story and install/source links.
- demos.ts: three source-backed scripted conversations, fixed-height glyph/color timelines and static transcripts. Delegation, background tests plus continued conversation, and wisdom-file reuse each get their own sequence. Outcomes/timing are illustrative, not connected runs.
- layout.ts / type.ts: responsive terminal-cell composition, headline and hit regions.
- playback.ts / terminal.ts: one visible-panel clock feeding the coalesced RAF/dirty-row renderer. Panels pause offscreen or hidden and loop after a six-second final hold. Reduced motion starts at the final state with explicit opt-in.
- scroll.ts: retained measured wheel accumulation; one wheel owner.
- html-animation.ts / html-cells.ts: semantic HTML enhancement using the same timeline, playback and colored cell runs; full no-JS transcripts remain in the document.
- scripts/build.ts: same-story semantic HTML, local bundles, WASM and tiny source-backed prompt-icon font.

Hover or focus a terminal panel to reveal its pause control; click/tap the panel to toggle playback. Tab then Enter/Space also operates playback. HTML uses one hover/focus control with a reachable touch target. Wheel/swipe, arrow keys, Page Up/Down and Home/End scroll. Escape or A opens animated semantic HTML with full transcripts; Tab beyond terminal controls reaches the ordinary HTML link. No shell connection or keyboard trap.

Mobile uses 14px cells, reflowed transcripts and condensed footer candidates, not a scaled-down desktop screen. Desktop uses 16px cells. The demo UI preserves Bruv/Pi source colors, within Vesper page chrome. Editor/footer/code previews are condensed to teach the interaction; a shared note identifies the scripted demos.

## Checks and limits

bun run test covers frame bounds, animated and no-JS HTML, shared loop timing, playback state, cell colors, full-paint parity, tiny wheels/coalescing, desktop/mobile, keyboard/pointer links, touch scrolling, resize and no-JS/WASM fallback. scripts/animation.ts separately samples complete real-time loops into screenshots and exercises mouse/keyboard/touch playback, reduced motion, offscreen pause and the visibility signal. Evidence: ../wisdom/landing-page/validation/polish/.

HTML provides headings, selectable text and ordinary links. The canvas is not itself a semantic document; no manual screen-reader audit is claimed. Physical phones and Safari/Firefox are untested. Scrolling is cell-quantized and direct touch drag, without kinetic fling.

Current handoff: ../wisdom/landing-page/polish-checkpoint.md. Earlier settings/gallery/raster designs and the deliberately stopped product-story WIP are historical.
