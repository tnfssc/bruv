# Vesper terminal landing hero

## Contract and continuation

The latest correction was to make a landing-page hero **inside the real terminal**, including inline images and Vesper. The previous build satisfied the terminal mechanism but looked like a sparse documentation menu and sent every image out to HTML. That is not the current acceptance target.

- Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_ea236d26
- Branch: feat/terminal-vesper-hero
- Preview: http://127.0.0.1:4187/ (loopback Bun development file server; no backend app)
- Review server PID: 3166998; log: /tmp/bruv-vesper-preview-4187.log. Started with setsid so it survives this worker handoff. After review, stop that owned preview with kill 3166998 (verify the PID if resuming much later).
- Parent must visually review before merge/deploy. Neither was performed here.
- Research and review workers were read-only in the shared worktree; the orchestrator owns integration. No independent worker code branches to collect.

## What changed

The hero uses an original bitmap alphabet emitted as Unicode half-block **terminal cells**. A Pi/worktree-specific pitch and peach install/source controls sit beside it on wide screens, then stack on mobile. The real local settings capture appears directly below, with side-by-side worktree and wisdom panes further down the same scrolling cell document (stacked on narrow grids). The gallery also displays both captures inline. Full-size viewers and transcripts are optional, not the default image experience.

All normal text, borders, filled buttons, navigation, captions and focus indicators are ANSI written through Ghostty Web 0.4.0/WASM. No DOM hero text, links, buttons or cards sit over it. The hidden semantic fallback and text.html share content.ts, heading copy, captures and destinations. A visible-on-focus HTML switch preserves the active route, including keyboard escape from the terminal tab sequence.

The unmodified PNGs are real Bruv 0.16.0 local settings/help output from the prior safe capture procedure (assets/cli-captures.md). They do not show a connected model response or delegated coding work. Their original CLI colors are retained; they have not been recolored to masquerade as Vesper CLI output. On narrow grids the image compositor shows the left 660px of the settings PNG, retaining option names and values; the original full capture stays one click away. At 320px the image continues below the fold and scrolls normally.

## The image mechanism, exactly

See [bounded upstream/library research](image-theme-research.md). Native Ghostty capability is not evidence that this browser package implements a graphics protocol. The installed 0.4.0 renderer exposes cells/graphemes and CSS-pixel cell metrics, but no image-draw API. The pinned WASM handler ignores APC and DCS paths. The shipped JS has no image drawing path. These findings justified a small browser compositor, **not a claim that browser terminals cannot show images**.

scripts/probe-images.ts runs a fresh browser terminal with direct-display Kitty PNG and Sixel red-image sequences. In this installed build both left the canvas unchanged; historical result artifacts are recoverable at Git revision `baf2fcd5`. These are basic display probes, not a complete protocol conformance suite.

site/image-plane.ts owns one transparent canvas inside #terminal, over the Ghostty canvas, with pointer-events:none. It only calls drawImage for decoded local PNGs. layout.ts reserves blank image cells and returns image placements, clipped image hit rectangles and a shared content clip. Each application redraw (scroll, keyboard, pointer, route, resize) maps those same cells through renderer.charWidth/charHeight. The plane uses getCanvas().getBoundingClientRect(), CSS-pixel dimensions, and a DPR-scaled backing buffer; its clip excludes the fixed header/footer. The settings crop is a source rectangle in drawImage, not a replacement asset. No full-page raster screenshot substitutes for terminal text.

The website uses its own virtual document scroll and Ghostty's alternate screen with zero scrollback. It does not need a second scroll owner or scrollback image registry. We deliberately do not rely on onRender (declared but not emitted by this version), buffer.active.viewportY/baseY (stubs), or painting once into Ghostty's continuously repainted canvas. Input reaches the real Ghostty canvas below the pointer-transparent image plane, then uses the same measured cell grid for hit testing.

## Vesper sources and license

Official source at revision 9043f3849b776949445f0cd4990365959cca35a3:
https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/themes/Vesper-dark-color-theme.json

Used exact source colors: background #101010, foreground/headline #FFFFFF, peach links/CTA #FFC799, muted text #A0A0A0, border/line-number tone #505050, CTA text #000000. The source also defines peppermint #99FFE4, errors #FF8080 and hover #FFCFA8; we did not add neon accents just to use every color. Role mapping is our website adaptation: the source does not define a complete terminal ANSI palette or cursor scheme.

MIT, Copyright (c) 2023 Rauno Freiberg. Full notice is site/licenses/vesper.txt and is copied into dist. The semantic footer credits Vesper. A copy of the consulted theme source is in writing-sources/vesper-theme.jsonc. Existing Ghostty/Web and Bruv notices are retained.

Research used tvly search and extract, then exact raw source inspection rather than search-snippet inference. Commands include:

```sh
tvly search "site:github.com/coder/ghostty-web kitty sixel renderer image" --depth advanced --max-results 3 --json
tvly search "site:github.com/raunofreiberg/vesper colors license" --depth advanced --max-results 3 --json
tvly extract https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/themes/Vesper-dark-color-theme.json https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/LICENSE.md --extract-depth advanced --json
```

## Copy pass

Used the full requested anti-slop-writing SKILL.md and adjacent doctrine already pinned in writing-sources. Both raw main URLs were fetched again and byte-equal to those local copies. The hero names Pi and the worktree mechanism instead of making a general productivity promise. The supporting copy explains the default shared checkout and the user's request to record handoff notes. No invented usage metrics, connected-session screenshot claims, generic slogan or rule-of-three feature filler was added.

Verdict: revise the former documentation-first overview.
Slop tells: low specificity in the opening; no product hierarchy.
Specificity missing: what delegation changes for a person staying in the terminal.
Inflated claim: none retained.
Flow break: image experience was an outbound gallery instead of part of the landing page.
Concrete rewrite: “Run a Pi-based coding agent in your project. Delegate a change in its own Git worktree while you keep working in your terminal.”
Rewrite check: passes self-detectors; actor/action/mechanism named; no metrics, prestige adjective, antithesis or repeated three-beat cadence.
Remembered line: “Give a task its own worktree.” The linked docs supply that mechanism.

## Validation and evidence

Run from site with Bun 1.4.2:

```sh
bun install --frozen-lockfile
bun test scripts/build.test.ts
bun scripts/probe-images.ts
bun scripts/validate.ts
PORT=4187 bun scripts/preview.ts
```

The host's mise worktree config was untrusted. Commands used /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun directly; no trust or toolchain config was changed. The preview port was free and the server remains running for parent review.

Browser checks cover actual local WASM; two canvases and no visible DOM marketing; decoded local images producing nontransparent pixels; frame-aligned image geometry, clipping and click regions; route clicks, Tab/Enter, keyboard HTML escape with route preservation, arrow/wheel/Home/End scrolling; live resize across the font breakpoint without reload; 320/390/768/1440 layouts; DPR2 touch swipe/tap and image selection; optional full-size viewers; source navigation (destination intercepted only by the test); no-JS parity; blocked-WASM HTML fallback; axe on semantic HTML; configured/unconfigured metadata; and a /bruv/ static subpath with local images/WASM.

Resize evidence reads dimensions, image placement and pixels in one browser evaluation. The first version of the test made separate round trips and sometimes compared different ResizeObserver frames. Making the snapshot atomic fixed that test race without relaxing the equality or pixel checks.

The inspected historical browser proof (including desktop/mobile layouts, touch, features, image clipping, gallery, subpath, no-JS and protocol probes) is recoverable at Git revision `baf2fcd5`. Earlier DOM screenshots are historical rejected designs, not current proof. The implementing agent and review worker inspected actual screenshots rather than relying only on assertions. The review found and prompted a route-preserving HTML escape fix, removal of a stale Back-control help reference, and a stronger worktree-specific pitch before the large settings capture.

Final focused run: 4 unit tests passed (1,419 expectations), browser validation passed on Chromium 153.0.8010.12 with no page exceptions, and both bounded protocol probes recorded unchanged canvases. Visual inspection confirmed the headline/CTA hierarchy, inline image pixels and composed feature panes, including the narrower 320px source CTA.

Changed runtime/build/test modules pass a focused strict TypeScript check with DOM/Bun types. A broader site/*.ts + scripts/*.ts check also reaches the unchanged capture-real.ts browser-eval fixture and reports its pre-existing implicit-any and /ghostty-web.js type-resolution errors; that script was not rewritten. Formatting and git diff --check cover changed code. Root CLI tests were not run because no CLI runtime changed.

## Remaining limits

Chromium on Linux and touch emulation were exercised; physical phones, Safari and Firefox were not. The terminal remains a canvas, so semantic reading, selection and browser find use the HTML view; automated axe is not a manual screen-reader audit. Small header/footer cell controls are less generous touch targets than the three-row main CTA. Captures are honest settings/help only. This compositor is application-specific raster composition, not generalized Kitty/Sixel support. No backend, CDN, shell or provider connection was added.

Values reviewed: 1 (requested mechanism), 2 (proof scope), 7 (simple solution), 8 (real UI) and 10 (handoff) already cover the repeated lessons. values.md is unchanged; the image-plane/version/theme details belong here, not in general values.
