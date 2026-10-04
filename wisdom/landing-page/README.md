# Bruv terminal-grid website — corrected direction

## Intent (2026-10-04)

The user clarified: **“its no bruv app. its just a termial looking app but a real website. basically webisite shows termial like grid. clicking and stuff will workin the terminal. etc”**

The entire website is the terminal-looking grid. It is a marketing website **about Bruv**, not Bruv running in a browser and not a conventional marketing page with a terminal demo embedded. This replaces the initial build’s interpretation. There is no open product question about a hosted shell or emulator, and no backend decision blocking the requested site.

## Where to continue

- Branch: `feat/terminal-grid-website`
- Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_fff300d2`
- Starting commit: `33f55f932dace089aec5500bedf34cd8a939444e` (first static build).
- Scope: `site/` and `wisdom/landing-page/` only. No merge into the original checkout and no deployment.
- Local preview for this revision: http://127.0.0.1:4174/ (loopback only; restart command below).
- [Build/hosting and asset instructions](../../site/README.md). [Previous sourced research](research.md), with its old recommendation explicitly superseded.

## What changed and why

One continuous, square-edged dark grid encloses the brand/title strip, section index, overview, image/content panes, workflow cells, installation/FAQ panes and bottom status strip. The same monospace/character-cell language runs throughout. Desktop splits panes; narrow layouts stack them and turn the index into a compact horizontal row. No fixed terminal width, canvas or hidden horizontal overflow masks content. Status chrome contains website identity and actual links, not invented operational status. Marketing copy and get-started links remain prominent.

Semantic HTML is the implementation, not an accessibility overlay on a terminal. A real nav links to real section IDs; browser Back and new-tab gestures keep working. Headings, landmarks, copy and local images are present in the original HTML. FAQ uses native details/summary. Optional `site.js` enhances image anchors into a native modal dialog with Close, Escape, focus return, inert background and a link to the original. Without JS, those same anchors open the image normally. No synthetic transcript scenes, fake shell prompt/input, terminal control tabs, autoplay or live-region narration remain. The old `demo.js` is deleted, not retained alongside a new implementation.

DOM grid was chosen over ghostty-web because the requested interaction is **browsing a website**, not parsing ANSI or emulating terminal input. Existing research establishes a canvas emulator’s different purpose; it is not needed for this visual design. We did not add an emulator, framework, client router, backend or runtime dependency.

The original two 1200×760 product concept illustrations and social asset remain. Each gallery pane visibly says it is an illustration, not an application screenshot; captions and alt text describe the synthetic concepts. Their fixture source and regeneration instructions remain in `site/fixtures/captures.html` and the site README. Real current product screenshots were not invented or claimed.

## Factual copy and SEO

Rechecked current repository README: Bruv is a Pi-based terminal coding agent with background jobs, sub-agents, optional Herdr integration and project wisdom; independent work can use Git worktrees. Linux, Apple Silicon macOS and Android Termux labels retain supported-architecture guidance. Install links go to the repository’s current paired-release/source-build instructions rather than inventing an install command or claiming publication. Credentials/models are configured at runtime and provider costs/access may apply.

The optional external T3 frontend is a product FAQ with its version-specific setup link, not a description of this website. T3 installs separately; `bruv web` prints setup guidance. The irrelevant “is this running Bruv in my browser?” FAQ is gone.

Existing title, description, Open Graph and Twitter text remain truthful. `BASE_URL` still configures canonical, absolute social image URLs, sitemap and robots at build time, including subpaths. A URL-less preview omits URL-specific output. No production URL, ratings or analytics claims were invented.

## Focused research for the correction

A read-only research worker used tvly for terminal-grid discovery and primary-source extraction. Findings: CSS Grid can express page/pane placement; semantic nav and named landmarks preserve ordinary web navigation. Discovery did **not** establish a strong specific terminal-grid marketing-site reference; visual decisions here are ours, not claimed to be copied/proven by Ghostty. Useful sources:

- [MDN CSS Grid](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout)
- [MDN nav](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/nav)
- [WAI landmark guidance](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/)

Exact commands:

```sh
~/.local/bin/tvly search "terminal grid website design CSS pane layout marketing site terminal aesthetic DOM" --depth advanced --max-results 6 --json
~/.local/bin/tvly search "semantic HTML navigation landmarks headings links keyboard accessible single page website MDN" --depth advanced --max-results 5 --json
~/.local/bin/tvly extract https://developer.mozilla.org/en-US/docs/Web/HTML/Element/nav https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/ https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout --extract-depth advanced --format markdown --json
```

Worker provenance (research only, no edits/commits to integrate): branch `bruv/terminal-grid-design-research-7781472f`, worktree `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_fff300d2-5442693331ce-task_7781472f`.

## Run and review

```sh
cd /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_fff300d2/site
bun install --frozen-lockfile # only needed for tests/asset generation
bun run build
PORT=4174 bun run preview
# In another terminal, from site/:
bun run test
# When a real public URL is selected, build AFTER tests:
BASE_URL="$PUBLIC_SITE_URL" bun run build
```

Build and preview themselves require no npm dependencies. Tests use cached Playwright Chromium or `CHROMIUM_BIN`. If needed, install the matching browser with `bun node_modules/playwright-core/cli.js install chromium`. This environment’s mise hook rejects the untrusted worktree config; used existing `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun` explicitly, without changing trust settings.

### Evidence

- [Desktop, 1440px](validation/desktop.png), [mobile, 390px](validation/mobile.png), [narrow mobile, 320px](validation/mobile-narrow.png).
- [Keyboard focus](validation/keyboard-focus.png), [image viewer](validation/image-viewer.png), [no-JS mobile](validation/no-js.png).
- [Machine-readable browser checks](validation/results.json).

The captures are of the built static website. Desktop, narrow mobile and the viewer were visually inspected, not inferred from test output. Gallery images load before evidence capture (initial exploratory full-page capture showed the lazy image before it loaded; final evidence waits for decoding).

Build metadata tests: 3 pass / 11 assertions. Browser: Chromium 153.0.8010.12. Browser checks exercise widths 320, 390, 768, 1024, 1440; no horizontal clipping; images; axe WCAG A/AA and best-practice checks; reduced motion; keyboard skip-to-main, anchors and browser history; visible focus; both illustrations, Ctrl/Cmd-click new-tab behavior and dialog controls; no-JS navigation/copy/disclosures/full-size images; absence of simulator/canvas; local links; no browser errors, failed page assets or third-party requests. Production-URL metadata emission and removal are tested against the built output. Automated checks do not establish full accessibility conformance. Biome site lint exits successfully with zero errors; 12 advisory warnings (CSS specificity, reduced-motion important rules, test non-null assertion) and 15 template-style suggestions remain. Supported-source formatting and HTML Prettier checks pass.

An initial axe run found the decorative sidebar mark had insufficient contrast; its color now uses the readable muted token. The native dialog permits tabbing to browser chrome, as a browser dialog should; tests check its actual internal controls, background inertness and focus restoration, not a custom JavaScript focus trap. The root app’s CI is intentionally not run: application code, root dependencies and build scope are unchanged.

## Remaining gaps

- No production domain or host selected; no deployment, live social scraper/indexing or host-header/cache acceptance performed.
- Images are still concept illustrations. Replacing them with approved current CLI screenshots is optional follow-up, not completed proof.
- Browser validation is desktop Chromium automation at mobile dimensions, not physical-device Safari acceptance or a manual screen-reader audit. No SEO ranking/Core Web Vitals claim.
- Small gallery text is naturally small on mobile; the adjacent HTML captions summarize it and original-image links support full-resolution browser viewing/zoom.

## Values check

Read `wisdom/values.md` at the start and checked again at handoff. Values 1 (finish the actual user need), 2 (honest proof), 7 (simplest approach), 8 (real human surfaces) and 10 (durable handoff) apply. The correction is local product intent and art direction, not a new general value. `wisdom/values.md` is unchanged.
