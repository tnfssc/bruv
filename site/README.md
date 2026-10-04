# Bruv website

One static landing page, with two views:

- `/`: Ghostty Web renders the page and demos as terminal cells.
- `/text.html`: semantic HTML with the same copy and animated demos. Without JavaScript, the full transcripts stay readable.

Both use Vesper. There is no agent backend, PTY, runtime CDN, or hosted shell. The build produces ordinary files in `site/dist/`.

## Run locally

Use Bun **1.4.2**, the version checked for this repo. From the repository root:

```sh
cd site
bun install --frozen-lockfile
bun run build
bun run preview
```

Open http://127.0.0.1:4173/ or http://127.0.0.1:4173/text.html.
The preview serves built files; it does not watch source changes. Run `bun run build` after edits, then refresh. Use `PORT=0 bun run preview` for a free port, or set a specific port. Stop it with Ctrl-C.

The site has its own package.json and bun.lock. You do not need to build or run the Bruv CLI to work on the page.

## Where to edit

| File | What it owns |
| --- | --- |
| `content.ts` | Copy shared by both views. Bruv is an **opinionated coding agent**; the added features support that pitch. |
| `demos.ts` | Mock conversations, colored UI cells, stages and timing. Each feature has its own demo. |
| `layout.ts` / `type.ts` | Terminal layout, hit regions and large BRUV lettering. |
| `terminal.ts` / `scroll.ts` | Mouse, keyboard, touch, scrolling and coordinated rendering. |
| `playback.ts` | Shared timing, final hold, looping and pause rules. |
| `html-animation.ts` / `html-cells.ts` | HTML animation and colored text. |
| `styles.css` | HTML layout, terminal host and local font. Main terminal text is not CSS content. |
| `index.html` / `scripts/build.ts` | Template, metadata, no-flash startup, semantic content and static bundles. |
| `install-command.ts` | The GitHub installer URL and command used by both views. |

Edit shared content or demo data first, not generated HTML or `dist/`. Reflow narrow panels instead of shrinking a desktop screenshot. Check both views after shared changes.

Demos loop after a final hold. Controls appear on hover/focus; tapping a terminal panel toggles playback. Offscreen panels and hidden tabs stop advancing. Reduced motion starts on a still final frame, with explicit playback available. Preserve those rules and the coalesced scroll/render path.

The UI mockups are scripted. Keep them grounded in source and save provenance in [feature notes](../wisdom/landing-page/animated-features.md), rather than adding disclaimers or diagnostics to the landing page.

## Check changes

Browser tests need Chromium. Install the matching version or set `CHROMIUM_BIN` to an existing executable:

```sh
bunx playwright-core@1.63.0 install chromium
bun run test
```

Focused commands:

```sh
bun run test:html
bun run test:animation
bun run test:scroll
bun run test:install
```

The full site test checks layout, playback, scrolling, startup fallback and installer/copy behavior. Animation checks take longer because they sample complete loops. Browser checks write evidence under `wisdom/landing-page/validation/`; review changed captures before committing them.

Inspect desktop plus 320px and 390px layouts. Check a full loop, header links, hover/focus/touch controls, and HTML. Tests use Chromium; physical phones, Safari/Firefox and manual screen-reader review remain separate checks. Installer tests use fixtures, not a real installation.

## Build for a host

From `site/`:

```sh
bun install --frozen-lockfile
BASE_URL=https://your-real-domain.example bun run build
```

Replace the example with the actual public URL. `BASE_URL` is optional locally. It supplies canonical URLs, `og:url`, `robots.txt` and `sitemap.xml`. Subpaths work; credentials, queries and fragments are rejected. Without it, domain-specific metadata is omitted. Rebuild when the public URL changes.

Publish **the contents of `site/dist/`**, including `ghostty-vt.wasm`, fonts, scripts and licenses. Do not run the preview server in production. No SPA catch-all rewrite is needed: `text.html` and assets must resolve as files. Serve WASM as `application/wasm`. Avoid long immutable cache rules for these unhashed filenames.

## Vercel, if that is the host

Import this repository and configure:

| Setting | Value |
| --- | --- |
| Root Directory | `site` |
| Framework Preset | **Other** |
| Install Command | `bun install --frozen-lockfile` |
| Build Command | `bun run build` |
| Output Directory | `dist` |

Check the build log's Bun version; local validation uses 1.4.2. This is static output: do not select a Bun server preset or configure Vercel Functions. No Vercel-specific file is required for the settings above.

Set `BASE_URL` in **Production** to the domain you choose. Leave it unset for previews until you decide their canonical/indexing policy; use Vercel's preview protection as appropriate. Do not use a localhost or sample URL in production settings.

After deploying, check `/`, `/text.html`, `/ghostty-vt.wasm`, the installer link and metadata on that host. These settings are a guide, not a tested Vercel deployment. Any static host can serve this build.

Reference: [Vercel build settings](https://vercel.com/docs/builds/configure-a-build).

## Shared installer

The only source is [scripts/install.sh](../scripts/install.sh). The root README and website use:

```sh
curl -fsSL 'https://raw.githubusercontent.com/tnfssc/bruv/develop/scripts/install.sh' | sh
```

The script must exist on GitHub's `develop` branch before publishing this command. Pushing a feature branch does not make that URL live. Check it before deploying. There is no site-hosted duplicate; `BASE_URL` does not change the command.

The installer pins one release, verifies the matched CLI/connector checksums and versions, and installs their notices. Keep these checks. Tests run in isolated fixtures. See [installer notes](../wisdom/landing-page/install-script.md) and [shared-source decision](../wisdom/landing-page/shared-installer-readme.md).

## Handoff

[Landing-page wisdom](../wisdom/landing-page/README.md) records decisions and checks. Old gallery, raster and multi-page screenshots are historical. The `assets` command replays an old settings capture; it is not part of the normal build or current animated demos.
