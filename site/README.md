# bruv website

One static landing page, with two views:

- `/`: Ghostty Web draws the page and its demos as terminal cells.
- `/text.html`: plain HTML with the same copy and animated demos. Without JavaScript, the full transcripts stay readable.

Both use Vesper. There is no backend, PTY or hosted shell. The build writes ordinary files to `site/dist/`,
including `install.sh`, a copy of [scripts/install.sh](../scripts/install.sh), so
`curl -fsSL https://bruv.sharath.page/install.sh | sh` works.

## Run locally

Use Bun 1.4.2. The site is a Bun workspace of the repo, so install from the repo root, then work in `site/`:

```sh
bun install --frozen-lockfile   # at the repo root; one lockfile for everything
cd site
bun run build
bun run preview
```

Open http://127.0.0.1:4173/ or http://127.0.0.1:4173/text.html. The preview serves built files and doesn't
watch for changes: run `bun run build` after edits, then refresh. `PORT=0 bun run preview` picks a free port.

## Where to edit

| File | What it holds |
| --- | --- |
| `content.ts` | Copy shared by both views. |
| `demos.ts` | Scripted conversations, cell colors, stages and timing. One demo per feature. |
| `layout.ts` / `brand.ts` | Terminal layout, click areas and the logo cells. |
| `assets/brand/` | The SVG logo, its PNG export, the social card and the generated logo cells. |
| `terminal.ts` / `scroll.ts` | Mouse, keyboard, touch, scrolling and rendering. |
| `playback.ts` | Shared timing, final hold, looping and pause rules. |
| `html-animation.ts` / `html-cells.ts` | The HTML view's animation and colored text. |
| `styles.css` | HTML layout, terminal host and the local font. |
| `index.html` / `scripts/build.ts` | Template, metadata, no-flash startup, HTML content and bundles. |
| `install-command.ts` | The install command shown in both views. |

Edit content and demo data, not generated HTML or `dist/`. Check both views after changes.

The demos are scripted, not recorded. Each one copies bruv's real UI: tool lines, the work board, check results,
the receipt frame, the editor and the footer (sources are listed at the top of `demos.ts`). When that UI changes,
change the demos with it.

Demos loop after a final hold. Controls appear on hover or focus; tapping a panel toggles playback. Panels off
screen and hidden tabs stop advancing. Reduced motion starts on the final frame, and playback is still available.

## Logo

The wordmark lives in `assets/brand/`. Keep the dark and light SVG paths identical. The standalone b is the
favicon. The HTML view uses the light SVG; the terminal view uses half-block cells made from the dark SVG.

After a shape change, run `bun scripts/generate-wordmark.ts` from `site/`. It also redraws the social card
(`bruv-social.png`). It needs `rsvg-convert` (librsvg) and `magick` (ImageMagick); normal builds don't. Format the
generated JSON with Biome before committing.

## Check changes

Browser checks need Chromium. Install it, or point `CHROMIUM_BIN` at one you have:

```sh
bunx playwright-core@1.63.0 install chromium
bun run test            # unit, build, HTML, scroll, startup, installer UI, then a full browser pass
bun run test:animation  # plays complete loops; slower
```

CI runs only the checks that need no browser: `bun run test:site` from the root (`bun run test:unit` here) and
`bun run check`, which type-checks the site with `site/tsconfig.json`. Browser checks write evidence to the ignored `artifacts/landing-page/`
folder at the repo root. Look at desktop, 390px and 320px, a full loop, hover, focus and touch controls, and the
HTML view.

## Deploy (Cloudflare Workers Builds)

| Setting | Value |
| --- | --- |
| Root directory | `/` (the repo root, where the lockfile is) |
| Build command | `bun run --cwd site build` |
| Deploy command | `npx wrangler deploy -c site/wrangler.jsonc` |
| Build environment variable | `BUN_VERSION=1.4.2` |

All site packages are dev dependencies, so `pi install` from git doesn't download them.
[wrangler.jsonc](wrangler.jsonc) names the Worker `bruv` and serves `./dist`. The build adds canonical URLs,
`og:url`, `og:image`, `robots.txt` and `sitemap.xml` for https://bruv.sharath.page. Set `BASE_URL` to build for
another address, or to an empty value to leave them out. Serve `ghostty-vt.wasm` as
`application/wasm`. After deploying, check `/`, `/text.html`, `/install.sh` and `/ghostty-vt.wasm`.
