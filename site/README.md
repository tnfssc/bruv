# Bruv static landing page

A standalone, framework-free site. No app build, backend, WASM, analytics, cookies, third-party fonts, or runtime packages. All browser requests stay on the static host until a visitor follows an external link. The terminal and images are **labeled illustrations**, not the current Bruv UI or a running shell.

## Build and preview

From the repository root, with Bun 1.4.2:

a) Build (no dependency installation needed):

```sh
cd site
bun run build
bun run preview
```

Open http://127.0.0.1:4173. Set `PORT` to choose another local preview port. The preview binds loopback only and is not a production server.

b) When the real public URL is chosen, supply it at build time:

```sh
BASE_URL="$PUBLIC_SITE_URL" bun run build
```

`PUBLIC_SITE_URL` must be the actual HTTP(S) site URL; a subpath is supported. A trailing slash is normalized. Without it the build deliberately emits **no canonical, og:url, social image URLs, sitemap or robots.txt**. Textual social tags remain present. With it the build emits absolute social image URLs, a canonical, sitemap and robots.txt. No production domain is assumed. Preview builds are not a substitute for checking the final URL before publication.

Upload **only the contents of `site/dist/`** to any ordinary static host. Serve index.html as the directory index; no SPA fallback or server runtime is needed. The deployed page uses relative asset paths. Do not deploy fixtures, tests, node_modules or wisdom. Nothing has been deployed by this change.

## Test and regenerate captures

```sh
cd site # if starting from repository root
bun install --frozen-lockfile
# One-time browser install, unless the matching browser is already cached:
bun node_modules/playwright-core/cli.js install chromium
bun run assets
bun run test
```

Tests use the locked Playwright Chromium and axe-core. If using an existing Chromium, set `CHROMIUM_BIN` to its executable. Build/preview themselves need no browser or npm dependencies. The tests write review screenshots/results to `wisdom/landing-page/validation/` and leave a clean URL-less preview build. Use the configured-URL build **after** testing for deployment.

- Edit copy/markup in `index.html`, styles in `styles.css`, optional prewritten scenes in `demo.js`.
- Edit `fixtures/captures.html`, then run `bun run assets` to recreate two 1200×760 PNG illustrations and a 1200×630 social PNG. They are browser captures of designed fixtures, not fabricated product screenshots. They use only synthetic public text, no credentials, real chats or personal paths.
- Pixel output depends on Chromium and system fonts. Assets checked in here were generated with Chromium 153.0.8010.12 on Linux; use the locked browser and same font environment for pixel equality.
- Header/favicon marks are local original artwork, not Ghostty branding.

Research, factual evidence, design decisions, limitations and exact worktree provenance: [landing wisdom](../wisdom/landing-page/README.md).
