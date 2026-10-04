# Logo in the public site (2026-10-04)

User approved the parent's custom black-and-white bruv wordmark, then asked to
combine it with public-site PR #28. No new PR, develop merge, or deployment.
The earlier mint tile was rejected. Only the replacement belongs here.

## Source and fit

One source home: site/assets/brand/. Root README refers there. This keeps static
hosting from needing files outside its configured site root. SVG variants share
paths. PNG is a white-background sharing export. bruv-icon.svg is the favicon;
the old unrelated site favicon is removed.

Main terminal page still renders through Ghostty cells. brand.ts selects 24-, 28-, or
48-column half-block rows from wordmark-cells.json. Generate from the SVG with
bun scripts/generate-wordmark.ts in site/. It needs system librsvg/ImageMagick
only when making the checked-in asset; not for ordinary builds.

HTML/no-JS view uses the white SVG. The h1 keeps real Bruv text for assistive
tech; the picture is decorative. The old block-font type.ts is unused and gone.
Animations, installer, scrolling, colors, and feature copy are unchanged.

## Work and checks

Worktree: /home/tnfssc/.bruv/worktrees/bruv-public-site-logo
Local branch: t3code/public-site-logo
Push target: origin/feat/landing-copy-loop-polish, PR #28.
Base: 5977d419c6fff5e9a1e0641e4d3695c6a9b797b0.
Source logo commit: 0f4a1368 on t3code/add-logo. Combined the final assets rather
than cherry-picking rejected-design commits or overwriting the site's README.

Frozen site install and static build passed. Focused tests and the full validator
hit old blanket no-img assertions. Updated those to allow exactly the wordmark
while keeping the demos as text/cells. Chromium visual review passed at 1280px
desktop, 320px terminal, and 390px HTML. Logo loaded; no horizontal overflow.
The 320px browser has 29 terminal columns and 25 content columns, so its logo
uses a 24-column render; wider phones use 28 and desktop uses 48.
Final full site checks passed: 31 tests and the Chromium validator, including
mouse/keyboard/touch, cell rendering, no-JS content, and startup failure.
Desktop/mobile/HTML review images are in validation/logo/. Auto-written older
test captures were restored to avoid rewriting unrelated proof.
No deployment or Safari/Firefox test.

Values unchanged. Existing single-source and real-path proof guidance applies.

## Final merge requested

User merged logo PR #29, then asked to merge this public-site PR and use the
logo where needed. Merged origin/develop into the site branch. README was the
only conflict: retained the shared installer, the site source path, and current
paired binary/launcher build details. Removed identical root logo copies.
Added a 1200 × 630 social-preview export from the same SVG paths and BASE_URL
metadata. No third-party T3/Pi logos or quiet terminal startup were changed.
Found and fixed the installer's outdated connector --version probe; product
pair checking now uses --bruv-version. See install-script.md.
Final combined checks passed: 31 site tests, Chromium validator, static build,
metadata subpath checks, and installer fixtures with the real version-flag split.
Social card rendered and reviewed. No live installer execution or deployment.
User authorized the public-site merge. Values unchanged: existing
single-source and real-path checks covered these fixes.
