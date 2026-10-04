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
- playback.ts / terminal.ts: one visible-panel clock feeding the coalesced RAF/dirty-row renderer. Panels pause offscreen or hidden, play once, and hold the final state. Reduced motion starts at the final state.
- scroll.ts: retained measured wheel accumulation; one wheel owner.
- scripts/build.ts: same-story semantic HTML, bundle, WASM and tiny source-backed prompt-icon font.

Click/tap Play/Pause or Replay. Tab then Enter/Space also operates playback. Wheel/swipe, arrow keys, Page Up/Down and Home/End scroll. Escape or A opens static HTML transcripts; Tab beyond terminal controls reaches the ordinary HTML link. No shell connection or keyboard trap.

Mobile uses 14px cells, reflowed transcripts and condensed footer candidates, not a scaled-down desktop screen. Desktop uses 16px cells. The demo UI preserves Bruv/Pi source colors, within Vesper page chrome. Editor/footer/code previews are condensed to teach the interaction; the labels disclose scripted demos.

## Checks and limits

bun run test covers frame bounds, static HTML, playback state, cell colors, full-paint parity, tiny wheels/coalescing, desktop/mobile, keyboard/pointer links, touch scrolling, resize and no-JS/WASM fallback. scripts/animation.ts separately samples real-time playback, records review video and exercises mouse/keyboard/touch playback, reduced motion, offscreen pause and the visibility signal. Evidence: ../wisdom/landing-page/validation/animated-features/.

HTML provides headings, selectable text and ordinary links. The canvas is not itself a semantic document; no manual screen-reader audit is claimed. Physical phones and Safari/Firefox are untested. Scrolling is cell-quantized and direct touch drag, without kinetic fling.

Current handoff: ../wisdom/landing-page/animated-features.md. Earlier settings/gallery/raster designs and the deliberately stopped product-story WIP are historical.
