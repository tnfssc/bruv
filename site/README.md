# Bruv landing page

One scrolling page, rendered by the actual Ghostty Web/WASM terminal. The Vesper headline, links and real CLI capture glyphs all live in the same character grid. No PNG/canvas image overlay, route menu, agent backend or CDN.

## Run


environment: Bun 1.4.2

~~~sh
cd site
bun install --frozen-lockfile
bun run build
PORT=0 bun run preview
bun run test
~~~

The preview binds only to loopback. Set BASE_URL to the real deployment URL (including any path prefix) for canonical URLs, sitemap and robots. With no BASE_URL, no production domain is invented. Deploy the self-contained dist/ directory.

## Layout and controls

- content.ts: concise copy and repository/install links shared with HTML.
- layout.ts / type.ts: responsive cell composition, headline, real capture runs and hit regions.
- capture.ts / assets/: source-derived terminal glyph/style data and responsive selection.
- terminal.ts / scroll.ts: Ghostty, measured hit testing, accumulated wheel distance and one coalesced row-diff paint.
- scripts/build.ts: static bundle, WASM and equivalent semantic/no-JS HTML.

Click or tap links, or use Tab and Enter. Wheel/swipe, arrow keys, Page Up/Down and Home/End scroll the same page. Escape or A opens the HTML version. Tab beyond terminal controls reaches the ordinary HTML link outside the canvas. There is no terminal keyboard trap and no shell connection.

Narrow screens use readable 14px terminal text and a narrow capture, not a scaled-down wide image. Desktop uses 16px cells. The capture is a static view of local settings, not a connected agent chat. Source bytes and regeneration/provenance live under assets/.

## Validation and limits

bun run test runs focused unit and real Chromium checks, including terminal-buffer glyph/color comparison, full-paint parity, tiny wheel deltas, coalesced bursts, desktop/mobile layout, links, resize and no-JS/WASM fallback. Evidence: ../wisdom/landing-page/validation/single-page/.

The accessible HTML page provides headings, selectable text and normal browser links. Canvas text is not a semantic document; no claim of a manual screen-reader audit. Physical phones and Safari/Firefox remain untested. Scrolling stays cell-quantized, with direct touch drag rather than kinetic fling.

Current decisions and handoff: ../wisdom/landing-page/single-page-cells.md. Earlier gallery/raster design notes are historical, not instructions to restore that UI.
