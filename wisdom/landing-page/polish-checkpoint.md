# Approved layout: copy and playback polish

User approved 9d2a44b4's visual design. This work keeps its continuous actual Ghostty/Vesper terminal and faithful per-feature UI, with a focused writing/playback pass. No redesign, merge or deployment.

## Current handoff

- Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0f2604c1
- Branch: feat/landing-copy-loop-polish
- HTML worker: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0f2604c1-5442693331ce-task_fa49bfa4; branch bruv/animate-semantic-html-feature-demos-fa49bfa4; original commit a533a546, integrated as 68819174.
- ONE new persistent preview: http://127.0.0.1:45339/
- Animated semantic HTML: http://127.0.0.1:45339/text.html
- Preview job: task_0ebc5703. Old previews were not restarted. All test preview servers stop on completion.

## What changed

Read the full saved anti-slop-writing skill and doctrine; [before/after review](writing-sources/polish-review.md) records deletions, concrete substitutions and self-detectors. Deleted redundant category/number/title stacks, per-panel disclaimers, stage captions and permanent playback rows. One shared scripted-demo note remains, with short playback instructions. Useful features and install/provider/platform guidance stay.

Terminal demos loop with a six-second hold added after their script endpoint (roughly eight seconds on the final outcome in total). Hover/focus reveals a control on the border; panel tap/click or focused Space/Enter toggles playback. Tab leaves the terminal. Offscreen/document-hidden panels stop consuming time. Reduced motion starts at the final state, with explicit playback opt-in. Row-diff ANSI writes and coalesced scrolling remain.

HTML uses local JS to animate the same glyph/color frames and shared playback function in semantic pre/span elements. Full transcripts remain crawlable, screen-reader readable and visible with JS off. No canvas/Ghostty/GIF/video/CDN/backend in this alternate. Hover/focus reveals a pause control; touch gets a reachable 44px control on the border. During visual review, fixed computed-font measurement and moved the control clear of transcript text; mobile demo text stays 14px.

## Checks actually run

Use /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun (mise's repo config is untrusted; trust settings were not changed).

- site: bun run build — passed.
- site: bun run test — 20 tests passed plus Chromium source-cell/scroll/input validation. The default command now includes HTML animation tests.
- site: bun run test:animation — all three terminal demos traversed full real-time loops; sampled typing/progress/final hold/reset. Verified keyboard pause/resume and exit, touch play/pause, reduced-motion static state, offscreen pause and hidden-document signal handling. Zero page errors.
- Shared timeline tests: stable geometry/cell bounds; final frame stays fixed throughout hold; reset goes back to frame zero; both renderers consume the same advance/demoFrame functions.
- HTML browser tests: actual DOM text progression, complete loop after final hold, stable height, offscreen/hidden pause, keyboard opt-in, coarse-pointer control, full no-JS transcript parity.
- Desktop 1440x960 and 390/320x844 renders inspected for both surfaces; no horizontal overflow. Actual Bruv UI colors, editor, task rows and footer are retained.
- Coalesced scroll regression: 100 same-turn 1px wheel events produced one terminal write and five rows; twelve individual 1px events stayed below one row. Checked 1,564 desktop, 1,295 mobile390 and 986 mobile320 demo cells against source glyph/color runs.
- Install/source and HTML navigation exercised (external destinations intercepted, not a remote GitHub availability test). All referenced local HTML links/assets returned 200. Main WASM/font path exercised by renderer startup; no missing asset errors.
- Axe HTML scans at 1440/390/320: zero violations after adding proper view-navigation landmarks and removing the alternate's redundant self-link. Not a manual screen-reader audit.
- Historical screenshots and JSON results (recoverable at Git revision `baf2fcd5`) were reviewed for full final outcomes and loop reset/typing samples: stable panel borders, complete outcomes before reset, no sampled chopped lines or transient blank-page flash.

## Limits

Chromium automation and screenshots, not physical-device testing. Safari/Firefox and a manual screen-reader session were not run. Visibility tests dispatch the document-hidden signal; offscreen tests use actual scrolling. Loop samples are not a claim that every frame on every device was inspected. Demo conversations/outcomes/timing/footer values are authored examples, never real provider-run evidence. No CLI source recapture or model/provider calls were needed. Canonical/sitemap metadata still requires a real BASE_URL; none invented for the local preview.

Values unchanged: existing values already cover requested medium, evidence scope, shared ownership, responsive rendering and safe handoff. See animated-features.md for implementation/source references.
