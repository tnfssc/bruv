# Landing page — terminal-rendered hero

## Current contract

The entire main visible website remains an **actual Ghostty Web/WASM terminal**, with working cell-based mouse, keyboard and touch controls. A monospace DOM website or CSS card layout is not a substitute. The latest correction also requires a composed marketing hero, Vesper and inline product images. The previous sparse terminal menu and outbound-only gallery were insufficient.

Current implementation: original half-block cell headline, specific Pi/worktree pitch, filled peach install CTA and source link, an inline real CLI settings capture, and supporting worktree/wisdom sections. All normal text and controls are ANSI terminal cells. One pointer-transparent raster canvas draws local images in blank reserved cells using the same viewport, metrics and clip. This is an honest application compositor, not an unsupported claim of native Kitty/Sixel graphics support. The gallery also renders images inline; full-size HTML viewers remain optional.

This is a static landing website, not a running Bruv session or shell. Self-contained local JS, WASM and PNGs need no backend/CDN. Equivalent semantic/no-JS HTML and metadata use shared content, not crawler-only content. Capture provenance and product limits remain in appropriate notes, without crowding the hero.

## Active work and handoff

- Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_ea236d26
- Branch: feat/terminal-vesper-hero
- Preview: http://127.0.0.1:4187/
- [Full implementation, exact research, commands, copy review, proof and limits](vesper-hero.md)
- [Ghostty image API and official Vesper source research](image-theme-research.md)
- Current screenshots/check results: validation/vesper/
- Parent must visually review; no merge or deploy performed.

## Resume

Run from site: bun install --frozen-lockfile, bun run build, bun run test. PORT=0 bun run preview chooses a free loopback port. Set BASE_URL only to a real deployment URL for canonical/sitemap metadata; without it no production domain is invented. On this host the untrusted mise shim was bypassed with the installed /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun executable; no trust configuration changed.

The strict focused type check covers the changed runtime/build/validation modules. The unchanged capture-real.ts browser-eval fixture has separate existing type errors if included in an ad-hoc all-site check. Chromium desktop/mobile, DPR2 touch, inline pixel drawing, image/cell alignment and hitboxes, scrolling/resize, static subpath assets, no-JS parity and blocked-WASM fallback were exercised. Physical phones and Safari/Firefox remain untested. Canvas reading/selecting/find relies on the semantic view; axe is not a manual screen-reader audit.

## History and source continuity

- The original DOM landing builds were rejected. Their screenshots directly under validation/ and research.md are historical, not acceptance guidance.
- The prior real-terminal foundation was /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_be951855, branch feat/real-terminal-website. Its screenshots are validation/terminal/. That build's outbound-only image decision is superseded by the inline compositor.
- terminal-research.md retains the original Ghostty 0.4.0 API investigation; image-theme-research.md and vesper-hero.md refine image support and implementation.
- Existing safe captures remain in site/assets with reproducible provenance. No connected coding interaction was fabricated.
- writing-sources/ retains the full requested anti-slop skill/doctrine and their provenance. They were re-fetched and matched the stored versions. The new copy pass is in vesper-hero.md.

Values were reviewed and left unchanged: requested mechanism, honest proof, real UI checks and useful handoffs already cover the lesson. Version-specific image/Vesper facts belong in feature wisdom.
