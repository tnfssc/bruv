# Bruv landing page — first static build

## Where this work lives

- Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_2a00126b`
- Branch: `feat/static-landing-page`
- Scope: `site/` and this wisdom directory only. Do not merge the parent as part of this task.
- [Sourced tvly research](research.md) includes exact search/extract commands, upstream links, browser/native distinction and visual references.
- [Build, preview, asset regeneration and static hosting instructions](../../site/README.md).
- [Validation results](validation/results.json), [desktop render](validation/desktop.png), [mobile render](validation/mobile.png), [keyboard focus](validation/keyboard-focus.png).

## Research/design checkpoint

Actual `coder/ghostty-web` can deliver a WASM VT parser and TypeScript canvas renderer on a static host. A fixed ANSI replay is feasible; a real Bruv session is not supplied by that library. Its live demos add a shell/PTY backend. Do not confuse native Ghostty's renderer/accessibility with ghostty-web.

Decision: **vanilla semantic HTML/CSS + a small optional scene switcher**, not a framework and not an actual ghostty-web integration. We need three readable scenes, not VT emulation. Avoiding canvas/WASM keeps the narrative crawlable, selectable and usable without JavaScript, and avoids a second output-accessibility surface. Ghostty/terminal-inspired visual treatment is not a Ghostty endorsement or an embedded terminal. No framework is justified for one page; Bun only copies files and injects optional deployment metadata.

Art direction: warm paper, deep green terminal panels, restrained lime accents, oversized sans-serif headings, modest monospace labels, generous spacing. Charm informed approachable terminal personality; Warp informed bordered code presentation and hierarchy. No borrowed screenshot, logo, testimonial, performance number or install command.

The hero is a readable, scripted HTML transcript. Three normal pressed-state buttons switch prewritten context/delegation/wisdom scenes. No fake input field, autoplay, endless typing, network connection or model call. Each scene updates one polite live region only after a user action. Native FAQ disclosures work without JS. Skip link, visible focus, reduced-motion rules, local images with dimensions/alt text, and no third-party runtime assets.

Two gallery PNGs and the social image are reproducible captures of `site/fixtures/captures.html`. Images carry their own illustration labels; captions state that they are not current application screenshots. Full-size links let small-screen visitors inspect the illustrations. These contain authored synthetic material only, not user data. Historical captures referenced by product/demo wisdom predate the external-T3 split and contain old naming and operational details, so were not repurposed. A fresh model-driven product session was not needed for this honest first static illustration; real approved CLI captures remain a follow-up, not a completed claim.

## Product grounding

Checked the current README, `src/t3/web/launcher.ts`, project/subagent wisdom and nearby product-demo lessons. Independent review also traced workspace/task/wisdom source.

- Bruv CLI is a Pi-based terminal coding agent with background jobs, sub-agents and project wisdom. Worktrees isolate independent code work; notes remain ordinary project files.
- External unmodified T3 installs separately. `bruv web` prints guidance, does not start/download a bundled web app. The FAQ links version-specific compatibility and known limitations, rather than promoting old bundled functionality.
- Live/browser audio is not advertised. Runtime credentials/models are user-configured; provider fees/access may apply.
- Get Bruv points to the existing install guide. No install script copied or invented, no claim the accepted paired release is already published. OS labels match README and defer architectures to that guide.
- Source license is MIT. No user counts, testimonials, speed promises, stars, fabricated feature outcomes or rankings.

## SEO and deployment

The title and description identify a terminal coding agent. Product copy, H1/H2/H3 hierarchy, FAQ content, links and initial demo live in initial HTML. No JS-only pitch. Open Graph and Twitter textual metadata are included; local 1200×630 social art is checked in. No structured data is emitted: nothing needs speculative entity/organization/rating claims.

`BASE_URL` is the sole public URL input. Only a configured URL adds canonical, og:url, absolute social image URLs/dimensions/alt text, sitemap and robots.txt. A subpath is preserved and normalized with a trailing slash. URL-less previews deliberately omit those URL-dependent outputs. Tests use reserved `example.test` only; it is never the default or an invented production hostname. Before publishing, use the actual final URL and rebuild after tests. Nothing is deployed and no domain was purchased.

## Validation and review

Final checks: 3 Bun tests passed (11 assertions); built-site browser validation passed on Chromium 153.0.8010.12. See machine results for exact browser checks. Build tests cover absent URL, configured subpath, and rejection of non-web/credential/query/fragment URLs. Browser validation uses built static files, not just source: 320, 390, 768 and 1440px; no horizontal page overflow; image loads; automated axe WCAG A/AA plus best practices; reduced-motion scroll; keyboard skip link, scene Enter/Space and FAQ; JavaScript-disabled narrative/default scene/disclosures; local anchors; no console errors, missing assets or third-party requests; metadata/sitemap/robots generation and removal when rebuilding without a URL.

Rendered desktop/mobile and source assets were visually inspected. Fixed mobile heading words joining when line breaks hide. Independent review found low-contrast keyboard focus on the pale demo backdrop; removed the light-accent override, kept the dark focus ring and added focused-control evidence/assertion. Browser automation does **not** establish screen-reader conformance or Safari/mobile-device parity.

Public HEAD checks returned 200 for the repository, linked develop-branch workspace and T3 guides, LICENSE and pi.dev. No external links are fetched during normal page load. Biome 2.5.15 site lint has zero errors; it retains 12 style warnings (CSS specificity/non-null test assertion) and 11 template-style suggestions. Formatting checks passed for supported source formats; HTML was formatted with Prettier 3.6.2. The root app build, package manifests/lockfile and TypeScript scope were not changed. Full app CI was not run because this is isolated static code. Site tools use their own manifest/lockfile.

Local environment: shell's mise wrapper declined the untrusted worktree config. Used the existing `~/.local/share/mise/installs/bun/1.4.2/bin/bun` executable directly; did not change trust/config. Browser generation/validation used already cached Chromium. Normal documented commands work where Bun is on PATH.

## Follow-up / user decisions

1. Choose the real public base URL and static hosting destination; rebuild, check actual social scraper fetches and indexing. No domain/hosting choice made here.
2. Review the art direction and copy. Replace illustrations with an approved, fresh, credential-free CLI capture if stronger product fidelity is desired. Inspect every frame; do not relabel illustration evidence as product proof.
3. Decide what “app inside it” means: a static visual demo, a local companion pointing to the user's own Bruv process, or a hosted interactive service. The latter two need an explicit backend/PTY/auth/isolation/lifecycle design and cost/permission decisions. No browser secrets or public unauthenticated shell. Existing external T3 is a separate product integration, not automatically this service.
4. Only if actual terminal fidelity is wanted, prototype a pinned ghostty-web ANSI replay as optional enhancement, retain the visible HTML transcript, and check WASM delivery, fonts, keyboard, mobile and screen readers. Not needed to ship this page.
5. Before public launch, manually check Safari, Firefox and a screen reader, plus host-specific headers/cache behavior. This first pass validates Chromium only; no SEO ranking or Core Web Vitals claim.

## Values check

Read values before work and again at the end. Existing values 2 (honest proof), 7 (simplest working approach), 8 (human surfaces/show reality) and 10 (durable handoff) already cover the lessons. No new general repeat lesson; `wisdom/values.md` is intentionally unchanged.
