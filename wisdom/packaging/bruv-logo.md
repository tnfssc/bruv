# bruv logo (2026-10-04)

## Current design

User rejected the first mint tile and terminal-prompt b. Asked the parent to
make it, not delegate again. Parent drew this replacement directly.

Custom lowercase wordmark. Heavy strokes, cut corners, forward lean. Black and
white. No terminal symbol, stock font, colored tile, or external resource.
The separate b icon uses the same geometry as the wordmark.
User approved this replacement ("sexy") and asked to combine it with the
public-site PR #28.

- assets/brand/bruv-wordmark.svg: dark ink on transparent background.
- assets/brand/bruv-wordmark-light.svg: identical paths in white for dark pages.
- assets/brand/bruv-icon.svg: standalone b; changes ink with color scheme.
- assets/brand/bruv-wordmark.png: 1060 × 376 white-background sharing export.
- README.md: 318 × 113 wordmark, picture source picks the dark-page variant.
  Product heading and prose stay intact.

SVG paths are the source. PNG is a render, not another design.
To refresh it: render the dark wordmark at width 1060 with rsvg-convert,
then flatten transparency on white with ImageMagick.

## Work and proof

Current work: /home/tnfssc/.t3/worktrees/bruv/t3code-49177b47,
branch t3code/add-logo. No child used for this replacement.
First attempt remains on bruv/add-bruv-logo-41b7b567 in
/home/tnfssc/.bruv/worktrees/t3code-49177b47-5442693331ce-task_41b7b567.
That design is superseded. Do not restore it as the accepted logo.

Parent rendered and inspected both wordmark variants and the icon at 32 px.
Python XML checks passed for titles, descriptions, paths, matching variant
geometry, and README references. git diff --check passed.
No runtime code changed. No full build needed. Browser preview is off for this
thread, so no claim of browser or GitHub rendering acceptance.

Values unchanged. This is specific design feedback, not a new general rule.

## Public-site integration

Work moved to /home/tnfssc/.bruv/worktrees/bruv-public-site-logo, branch
t3code/public-site-logo. Target is origin/feat/landing-copy-loop-polish (PR #28).
Combined version owns the assets in site/assets/brand/ for self-contained site
builds. See wisdom/landing-page/logo.md on that branch for implementation/checks.

Confirmed pushed commit 7c01eae4251bf59660f3be0733d3fdee09d05779 to the site
PR branch. PR #28 now contains the accepted logo in terminal, HTML/no-JS,
favicon, and README. All 31 site tests and Chromium validator passed.
PR body updated. No new PR, merge, deployment, or CI success claimed.
