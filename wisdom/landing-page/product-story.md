# Landing product-story correction

## Intent and current work

The user rejected a settings capture and internal notes as the product pitch. Rendering in terminal cells was correct; the page still failed to explain why someone would use Bruv. This revision keeps one continuous Ghostty/WASM page, Vesper, real cell text/colors, hit-tested links, keyboard/touch navigation and coalesced scrolling. It changes the story, not the medium.

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_ca1b8f57
Branch: fix/landing-product-story (starts at 495a2004)
New persistent preview: http://127.0.0.1:39289/ (job task_2ff92ed4)
Only this new persistent preview was launched here. No superseded server was restarted. Temporary validation servers stop in the probe's finally block. No merge or deployment.

## Reading order

- Category first: Bruv, terminal coding agent. Hero: “Keep coding / while your agents work.” The subhead names Pi and a fix delegated to its own Git worktree; Install Bruv and Source are visible immediately at desktop, 390 and 320 widths.
- “Give the fix its own branch”: independent CSV-import fix, separate from the user's export UI work. Review the diff before bringing it back.
- “Use the time tests take”: a background test job while the conversation examines cache invalidation.
- “Pick up where you left off”: save the CSV streaming decision and remaining tests; ask the next session to read those notes. This is a useful handoff, not a claim of automatic unlimited memory.
- “Start in your repo”: source-build guide, Bun 1.4.2, model-provider setup, then cd your-project / bruv. Bring provider credentials; documented release platforms are named.

Install links point precisely to https://github.com/tnfssc/bruv#build-from-source. README currently says to use source until the accepted paired release is available, so this page does not guess at release readiness or invent an npm/curl one-liner. No FAQ, pricing, testimonials, stats or logo wall.

## Sources and illustration boundary

Grounding: README.md (category, installation, platforms/provider configuration), wisdom/worktrees/subagent-workspaces.md (explicit isolated checkout/branch, retained worktrees), project wisdom docs (file-based notes), existing shell/subagent/job behavior in the tool guidance. A bounded independent copy review agreed with the worktree + available foreground differentiation.

Reviewed existing site/assets raw help/settings and settings-cells.json, plus task-UI terminal-preparation evidence. Help/settings are real safe local captures but not a product workflow; task-UI acceptance text is fixture evidence, not a connected coding session to advertise. No paid provider or external model was invoked to manufacture a capture.

All three visible panels are **illustrative**, labeled “Example workflow”. They contain suggested user prompts and a work-split diagram, never invented assistant replies, completion states, timings or task results. They are not counterfeits of an exact Bruv UI. site/workflow.ts turns shared content into colored glyph runs; layout composes those runs directly in Ghostty cells. There are no raster overlays. Existing safe capture extraction/reflow machinery remains available and tested in site/capture.ts and scripts/extract-cells.ts, but settings are absent from the page and browser bundle.

## Writing review

Re-read the saved anti-slop SKILL and doctrine. The old “Code in your terminal” named a location, not a reason to choose Bruv; settings showed configuration, not useful work. Replaced that with a supported benefit and prompts showing the mechanism. Avoided prestige claims, a generic rhetorical triad, decorative antithesis and fake operational status. Three scenes are distinct concrete workflows, not three synonyms for productivity.

Bounded self-review: specificity 4/5, evidence fit 5/5, relation clarity 4/5, rhythm 4/5. Improved the weakest hero relation once: “Keep coding” alone was too general, so added “while your agents work.” The subhead immediately supplies isolated worktree delegation. Rewrite check: passes self-detectors; no unsupported comparative speed claim, banned fallback phrase, invented outcome or decorative closer. A new visitor can name the category, describe what gets delegated and find installation without reading internal architecture.

## Checks and visual review

From site with Bun 1.4.2: bun install --frozen-lockfile; bun run build; bun run test. Final focused gate: 9 tests, 539 assertions, plus real Chromium browser probe. Standalone strict TypeScript check passed for site runtime/build/capture/workflow/tests. Biome formatting and git diff --check checked separately.

Current evidence: validation/product-story/. Opened and inspected final desktop 1440x960, mobile 320x844 and 390x844 hero images, workflow scrolls and installation close. Desktop text sits beside panels; mobile stacks readable glyphs, with no small screenshot scaling or clipped headings. All normal visible text and controls remain terminal cells. Parent must still review the content and renders before user handoff.

Browser probe checks one canvas, expected terminal glyphs/foreground/background, no horizontal overflow, row parity and equality with a forced full reference canvas paint after scrolling and resize. Final scrolled samples verify 728 desktop, 518 mobile-390 and 493 mobile-320 colored example cells. All visible examples are checked, not only the first panel. Twelve 1px wheels remain at row zero; a 100x1px same-task burst produces one write and five rows. CDP touch drag advances ten rows, then Source tap works. Mouse/keyboard Install, Home/End/Page keys, Escape-to-HTML, no-JS and blocked-WASM fallback pass. No page errors. Install/Source navigation is intercepted by the probe, not used to call provider services. New preview returns HTTP 200 with corrected shared content; no canonical/domain is fabricated.

## Limits and values

No connected coding session is claimed. Canvas still needs its same-content semantic HTML view for screen readers, selection/find and high zoom. Physical phones, Safari/Firefox and manual screen-reader review were not run. Retained scrolling is cell-quantized and direct touch drag, without kinetic fling. No broad CLI suite was needed for this website content/layout change.

Sharpened existing value 1 rather than adding a value: matching the rendering mechanism does not excuse missing the product purpose. Check what a new visitor can understand and do. This repeat correction warranted that addition.
