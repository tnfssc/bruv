# Single page, with captures made of terminal cells

## Contract and working location

This supersedes the multi-route overview/install/workflows/live/gallery/help app and the raster compositor described in vesper-hero.md. The user explicitly asked for one page and for screenshot text/colors placed *inside* the terminal. Do not restore the gallery, route menu or PNG overlays.

- Integration worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_323db3cf
- Branch: feat/single-page-terminal-site
- Base: 29266c490ac359181dd50bc5c4853b7dd96180bb (scroll/render fixes retained)
- Independent capture worker: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_323db3cf-5442693331ce-task_d21b8d39
- Worker branch: bruv/extract-faithful-terminal-capture-cells-d21b8d39
- Persistent preview: http://127.0.0.1:33779/ (job task_bf75a429, loopback only)
- No merge or deployment.

## Design

One scroll frame: half-block headline, short Pi-based coding-agent description, repository install/source links, real local settings capture, two short paragraphs about worktrees and wisdom, and an install reminder. The fixed top only says bruv; the bottom has a scroll hint and HTML escape. No many-section navigation. Escape/A opens semantic HTML; Tab can leave the terminal. Mouse, touch and keyboard links use measured cell hit rectangles.

The whole visible main page remains Ghostty Web 0.4.0/WASM. Vesper page colors remain #101010 / white / peach / muted gray. Capture colors are preserved, not recolored to the page palette. Text and capture glyphs are composed into the same ANSI row grid and painted by the same renderer. There is only one canvas. No image-plane code, empty image reservations, gallery route, shots/*.html or PNG request remains in the shipped build.

Desktop cells are 16px; narrow cells are 14px. Layout reflows the headline, intro, links and supporting content. Captures use narrow source-derived cells, not browser scaling of a wide image. Their border uses the selected capture width. Captures scroll and clip with the same row translation as all page content.

Keep the measured scroll fixes: CellScroll fractional accumulation, pixel/line/page conversion, one document-level wheel owner, ctrl-wheel exemption, shared touch accumulator, coalesced RAF, changed ANSI rows only, and synchronous full renderer pass after writes (avoids Ghostty border-join defects). Removing images makes the second synchronization plane unnecessary.

## Copy and semantic content

Read the saved anti-slop-writing skill. Copy names concrete mechanisms: a Git checkout/branch per requested worktree, background work between turns, and decisions/checks/handoffs in wisdom/. No model transcript was invented. Local settings is labelled as such, not a connected coding session. Provenance stays in assets and this handoff rather than filling the hero.

content.ts owns the visible prose and repository links. Build emits equivalent headings/prose/capture text/links into initial no-JS HTML and the explicit text.html accessibility representation. No JS routes are required. BASE_URL semantics are unchanged: only a supplied real URL produces canonical/sitemap/robots URLs; no deployment domain invented. dist is local JS/WASM/CSS/license assets only, with no backend/CDN.

## Validation and review

Capture delegation was stopped after ten minutes without an implementation artifact. The isolated worker checkout/branch above remains, but no worker commit was integrated. Extraction was completed here in scripts/extract-cells.ts. It replays safe cli-settings.txt through Ghostty, reads buffer glyph/RGB/style data and emits settings-cells.json. Original 110×36 buffer, exact zero-based crop x=0/y=19/56×15. Narrow reflow keeps every non-space glyph and its style in order, pairs unchanged values with their labels, and wraps the original hint/description. Captions distinguish excerpt vs reflow. Full source SHA/capture history: site/assets/cli-captures.md.

Focused commands (from site, with the direct Bun 1.4.2 executable or its directory prepended to PATH):

~~~sh
bun install --frozen-lockfile
bun run assets       # replay existing safe raw ANSI; no CLI/model call
bun run build
bun run test         # unit + scripts/validate.ts Chromium probe
PORT=0 bun run preview
~~~

Strict TypeScript command from this worktree root:

~~~sh
/usr/bin/node /home/tnfssc/Code/bruv/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module Preserve --moduleResolution Bundler --lib ES2022,DOM --typeRoots /home/tnfssc/Code/bruv/node_modules/@types --types bun site/content.ts site/capture.ts site/type.ts site/layout.ts site/terminal.ts site/scroll.ts site/scripts/build.ts site/scripts/extract-cells.ts site/scripts/validate.ts site/scripts/build.test.ts site/scripts/scroll.test.ts
~~~

Checks: 8 focused unit tests / 385 assertions; real Chromium desktop 1440×960 and mobile 390/320×844; no page errors. Twelve real 1px wheels remain at row zero. A same-task 100×1px burst produces one terminal write and five rows of movement. Direct CDP touch drag advances ten rows; a later tap opens Source. Mouse and keyboard Install links, Home/End/Page keys, Escape to HTML and resize pass. No-JS and blocked-WASM show readable semantic HTML. Source/install navigation is intercepted in the probe, not allowed to call model services.

The probe reads the actual bundled terminal buffer: 840 desktop capture cells, 629 at 390px and 551 at 320px have the expected glyph/foreground/background. One canvas only. Every viewport's text matches full ANSI layout; the canvas equals a forced full reference paint after scrolling/resizing. This proves capture cells, not image overlay alignment. Unit checks prove narrow glyph/style sequence equals the source crop and raw transcript SHA matches metadata.

Historical checks and desktop/mobile screenshots are recoverable at Git revision `baf2fcd5`. Images were opened and visually reviewed: readable 29-column settings on 320px, 37-column settings on 390px, no overlapping controls or horizontal overflow; desktop supporting copy sits beside the capture. The capture scrolls behind the fixed header/footer without corrupting cells. Parent must still inspect the preview before the final user response.

Formatting and git diff --check pass. No unrelated root CLI suite or broad research was run.

Known retained limits: cell-quantized scrolling and direct touch drag without kinetic fling; Chromium emulation is not physical mobile-device coverage; Safari/Firefox and manual screen-reader review not run. Equivalent semantic HTML remains necessary for screen readers, selection/find and high zoom.

Values reviewed: requested medium/mechanism, bounded honest proof, single ownership, simple solution and handoff already cover this work. No new repeat lesson, so wisdom/values.md remains unchanged.
