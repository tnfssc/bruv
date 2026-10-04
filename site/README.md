# Bruv terminal website

The default website is a Ghostty Web 0.4.0 canvas terminal. ANSI text, borders, navigation, links and the pager are terminal cells. It is a static website: no PTY, shell, agent backend, provider call or runtime CDN.

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
- layout.ts: viewport-aware cell/ANSI layout and hit regions; no DOM layout components.
- terminal.ts: Ghostty lifecycle, measured cell-coordinate pointer hit testing, hash navigation, keyboard and touch scrolling. Writes static content only.
- scripts/build.ts: browser bundle, WASM, semantic index fallback and explicit text.html. Both HTML views use the same data; no crawler detection.

Click/tap green controls. Tab focuses controls, Enter opens them; Tab beyond either end focuses the accessible HTML link outside the canvas. Keys 1–6 select pages, ? opens help, arrows/Page Up/Page Down/Home/End scroll, Escape uses browser Back, and A opens the text view. Touch swipe and footer arrow controls scroll. Internal navigation uses URL hashes. Image links intentionally open static full-size viewer pages outside the terminal; browser Back returns.

## Accessibility and limits

Canvas output is not a semantic document. Screen readers, browser text search/copy and high-zoom reading are better served by the visible-in-focus HTML switch, terminal HTML control or A shortcut. The equivalent HTML view has headings, normal links and selectable commands. It is available to everyone, is rendered initially for no-JS users, and remains available if WASM initialization fails. Automated axe checks cover the explicit text view, not a claim of canvas accessibility or a manual screen-reader audit.

Verified in Chromium 153 on Linux at desktop/mobile viewport sizes and DPR 2 touch emulation. Physical phones and Safari/Firefox have not been tested. Small terminal targets remain less comfortable than HTML links. No inline image protocol is claimed: ghostty-web's inspected browser renderer did not expose Kitty/Sixel image support.

## Real CLI captures

See assets/cli-captures.md. Settings and --help captures come from the source-built Bruv 0.16.0 with a synthetic HOME, empty workspace, no credentials and disabled network. Actual output was replayed in Ghostty; the settings screenshot is cropped and help is an excerpt. These do not demonstrate a connected coding session. Raw transcripts and the reproducible capture scripts are retained. The old synthetic illustrations and their generator have been removed.

Full research, writing-skill provenance and visual evidence: ../wisdom/landing-page/.
