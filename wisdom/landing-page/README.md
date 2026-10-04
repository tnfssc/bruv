# Landing page — corrected rendering contract

## Current intent (supersedes both rejected builds)

The user asked for **the entire visible website inside an actual browser terminal renderer**. A monospace DOM page, CSS grid/cards, marketing sidebar or canned transcript is not an acceptable substitute. The default entry now uses Ghostty Web's WASM terminal and canvas. Visible chrome, panes, prose, navigation and controls are ANSI/character-cell output. Mouse/touch actions use measured renderer cell coordinates. No invisible DOM links overlay the canvas.

This remains a client-side static landing website, not the running Bruv app, a PTY or shell. Product screenshots are real captures linked from the terminal gallery to intentional static image pages. Accessible/no-JS HTML uses shared content, is available to all users, and is not crawler-only cloaking.

## Work and continuation

- Implementation worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_be951855
- Branch: feat/real-terminal-website
- Copy/research worker: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_be951855-5442693331ce-task_cf67dd63; branch bruv/terminal-website-copy-and-source-researc-cf67dd63; source commit baa1a7e3007161784282f6b299157b3b05812279.
- Capture worker: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_be951855-5442693331ce-task_4363a3ac; branch bruv/capture-safe-real-cli-screenshot-4363a3ac; source commit 394f5bd7486089a65235c338a78ee051379a11cb.
- Worker commits were cherry-picked into this feature worktree; nothing was merged into another branch or deployed.

## Implementation

site/ owns dependencies, lockfile, runtime and build. Ghostty Web 0.4.0 is pinned. Ghostty.load receives a module-relative local WASM URL; build bundles JavaScript and copies that package's WASM, images and MIT notices into dist. Static deployment needs no CDN or backend. The terminal uses its alternate screen, explicit rows/columns, ANSI cursor positioning and palette, a viewport pager, hash routes and a desktop quick-start pane. Narrow screens reflow the nav and prose. Keyboard commands, real canvas cell hit testing and touch swipes dispatch only fixed navigation actions.

See [terminal research](terminal-research.md) for tvly-sourced API, static packaging, mouse, image-protocol and license findings. Earlier [research](research.md) is historical context; its DOM-only design decision was rejected and must not be reused as acceptance guidance.

[Writing sources](writing-sources/provenance.md) pin the requested anti-slop skill, full doctrine and rewrite patterns; [copy review](writing-sources/review.md) records the changes. Shared site/content.ts supplies both terminal and semantic HTML. README-backed commands/features replace generic slogans. No invented installer, ranking claim, user count or productivity metric.

## Run and check

```sh
cd /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_be951855/site
bun install --frozen-lockfile
bun run build
bun run test
env PORT=0 bun run preview
# Production metadata only when the actual URL is known:
env BASE_URL=https://your-domain.example/bruv/ bun run build
```

In this host the untrusted mise shim was not used; commands ran with /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun. This is an environment workaround, not an app change. The preview URL/port is recorded below after launch.

## Evidence and observed fixes

Current visual proof lives in validation/terminal/: desktop.png, mobile-320.png, mobile-390.png, gallery.png, no-js.png and results.json. Earlier PNGs directly in validation/ are evidence of the rejected DOM implementation, not this site. Parent inspected the actual current browser screenshots and both CLI PNGs.

Browser checks load the built self-contained bundle and WASM, assert a canvas with no visible semantic marketing page, activate cell hit regions, exercise keyboard/hash/history, resize across 320/390/768/1440 widths, scroll content, test DPR 2 touch swipe/tap, open both real screenshot viewers, follow the install/source destination through an intercepted navigation, and compare no-JS HTML with shared data. Explicit HTML gets axe checks. A deployment subpath also loads JS/WASM. Metadata is checked with and without BASE_URL. The root application build is unchanged; it was not re-run for this site-only feature.

Observed and fixed: hash navigation could move focus to the hidden semantic section; the terminal now restores focus and handles keys at document capture within its own focus scope. Native touch handling does not reliably synthesize click, so touch activation uses real pointer-up cells and suppresses duplicate clicks. Alternate-screen output plus a custom wheel handler prevents Ghostty scrollback competing with the website pager. A hanging no-JS axe injection was a test setup issue; no-JS parity is checked separately and axe runs on the explicit text view with an ordinary browser context.

## Limits

- Canvas is not screen-reader document semantics. HTML switch/shortcut and no-JS view mitigate that; no manual screen-reader audit claimed.
- Chromium desktop and emulated mobile/touch only. No physical-phone, Safari or Firefox verification. Terminal-sized touch targets are small; HTML is the alternative.
- No supported browser image plane was found. Gallery opens intentional static HTML/PNG views rather than faking inline graphics.
- Screenshots prove source-built local settings/help only. No provider, live audio, delegated task or connected coding interaction was captured. Details and transcripts: site/assets/cli-captures.md.
- Production domain not supplied; URL-specific metadata stays omitted until configured. No search ranking promise.

## Values review

Sharpened value 1 rather than adding a value: the user's requested rendering medium and interaction are acceptance requirements. Passing tests for a simpler visual imitation do not meet that request. This failure repeated twice; it was a contract substitution, not a styling disagreement.

## Saved preview and final checks

Preview started 2026-10-04: **http://127.0.0.1:46583/** (loopback only), parent job task_5d97e658. It serves the final site/dist build. Restart with PORT=0 if this process is gone.

Final focused gates: 3 Bun tests passed; browser suite passed on Chromium 153.0.8010.12; strict isolated TypeScript check passed; git diff --check passed for the integration diff. See validation/terminal/results.json for the exact browser checks. Source-built CLI raw transcript files retain original terminal bytes, including trailing blank lines. Root tsconfig includes src/scripts/integrations/tests, not site/.
