# Bruv terminal website

The default website is a Ghostty Web 0.4.0 canvas terminal. The Vesper hero headline, prose, borders, navigation, filled install CTA and pager are terminal cells. A raster-only canvas compositor draws local captures into reserved cells inside that surface. It is a static website: no PTY, shell, agent backend, provider call or runtime CDN.

## Build / preview

```sh
cd site
bun install --frozen-lockfile
bun run build
env PORT=4173 bun run preview
```

Use Bun 1.4.2. Set PORT=0 to ask for a free loopback port; read the printed URL. The preview server is only a development file server. Publish the contents of site/dist on any static HTTP host, including a subpath. The build copies the installed package's ghostty-vt.wasm beside terminal.js, all image assets and MIT notices. No app build or root package changes are needed.

```sh
env BASE_URL=https://your-domain.example/bruv/ bun run build
bun run test
```

BASE_URL is a deployment setting, not a shipped placeholder. Without it, canonical, og:url, robots/sitemap URLs are omitted. The title, description and Open Graph description are always present. Configured builds generate canonical URLs and sitemap entries for the terminal and plain HTML views. This does not promise search ranking.

Browser checks use Playwright Chromium. An existing browser can be supplied with CHROMIUM_BIN, otherwise use Playwright's matching installed browser. The site owns its dependencies and lockfile.

## Files and controls

- content.ts: one source for product prose, link destinations and installation commands.
- gallery.ts: real capture metadata. Build emits static shots/*.html image viewers.
- layout.ts / type.ts: viewport-aware cell/ANSI composition, bitmap headlines, image reservations and hit regions; no DOM layout components.
- image-plane.ts: local PNG decode and a clipped, DPR-aware raster canvas aligned with Ghostty cell metrics. No text or DOM controls.
- terminal.ts: Ghostty lifecycle, measured cell-coordinate pointer hit testing, hash navigation, keyboard and touch scrolling. Writes static content only.
- scripts/build.ts: browser bundle, WASM, semantic index fallback and explicit text.html. Both HTML views use the same data; no crawler detection.

Click/tap peach controls. Tab focuses controls, Enter opens them; Tab beyond either end focuses the accessible HTML link outside the canvas. Keys 1–6 select pages, ? opens help, arrows/Page Up/Page Down/Home/End scroll, Escape uses browser Back, and A opens the text view. Touch swipe and footer arrow controls scroll. Internal navigation uses URL hashes. Images are visible inline in the hero and gallery. Selecting one optionally opens a static full-size viewer and transcript; browser Back returns.

## Accessibility and limits

Canvas output is not a semantic document. Screen readers, browser text search/copy and high-zoom reading are better served by the visible-in-focus HTML switch, terminal HTML control or A shortcut. The equivalent HTML view has headings, normal links and selectable commands. It is available to everyone, is rendered initially for no-JS users, and remains available if WASM initialization fails. Automated axe checks cover the explicit text view, not a claim of canvas accessibility or a manual screen-reader audit.

Verified in Chromium 153 on Linux at desktop/mobile viewport sizes and DPR 2 touch emulation. Physical phones and Safari/Firefox have not been tested. Small terminal targets remain less comfortable than HTML links. Inline images use our small cell-anchored compositor, not a native Kitty/Sixel protocol claim. The shipped 0.4.0 handler/source and direct browser probes did not render those image sequences. The compositor shares layout/scroll/resize/clipping and hit coordinates with the ANSI frame.

## Real CLI captures

See assets/cli-captures.md. Settings and --help captures come from the source-built Bruv 0.16.0 with a synthetic HOME, empty workspace, no credentials and disabled network. Actual output was replayed in Ghostty; the settings screenshot is cropped and help is an excerpt. These do not demonstrate a connected coding session. Raw transcripts and the reproducible capture scripts are retained. The old synthetic illustrations and their generator have been removed.

Vesper colors come from Rauno Freiberg’s official theme (MIT); source, role mapping and notice are recorded in licenses/ and ../wisdom/landing-page/image-theme-research.md. Real capture pixels keep their original CLI colors.

Full implementation/probe details, writing-skill pass and current visual evidence: ../wisdom/landing-page/vesper-hero.md and validation/vesper/. Run `bun scripts/probe-images.ts` for the bounded upstream-protocol browser probe.
